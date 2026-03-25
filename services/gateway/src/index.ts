import express from "express";
import axios from "axios";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import {
  CommitNotifyRequest,
  createLogger,
  LeaderChangeRequest,
  LogEntry,
  StrokeIngressRequest,
  WsClientEvent,
  WsServerCommittedEvent,
  WsServerEvent,
  parseReplicaMap,
} from "@mini-raft/shared";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

app.use(express.json({ limit: "1mb" }));

const gatewayPort = Number(process.env.GATEWAY_PORT || "3000");
const replicaMap = parseReplicaMap(process.env.REPLICA_MAP || "");
let currentLeaderId: string | null = Object.keys(replicaMap)[0] ?? null;
const logger = createLogger("gateway");

const clients = new Set<WebSocket>();
const committedEntries: LogEntry[] = [];

function sendJson(ws: WebSocket, payload: WsServerEvent): void {
  ws.send(JSON.stringify(payload));
}

function broadcast(payload: WsServerEvent): void {
  const data = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

async function forwardStroke(ws: WebSocket, localId: string, message: StrokeIngressRequest): Promise<void> {
  let attemptLeaderId = currentLeaderId;

  const tryPost = async (leaderId: string) => {
    const leaderUrl = replicaMap[leaderId];
    return axios.post(`${leaderUrl}/stroke`, message, { timeout: 800 });
  };

  const doProbeStr = async () => {
    const probePromises = Object.entries(replicaMap).map(async ([id, url]) => {
      try {
        const res = await axios.get(`${url}/status`, { timeout: 500 });
        if (res.data?.state === "leader") {
          return id;
        }
      } catch {
        return null;
      }
      return null;
    });
    const results = await Promise.all(probePromises);
    return results.find((id) => id !== null) || null;
  };

  if (!attemptLeaderId || !replicaMap[attemptLeaderId]) {
    attemptLeaderId = await doProbeStr();
  }

  if (attemptLeaderId && replicaMap[attemptLeaderId]) {
    try {
      await tryPost(attemptLeaderId);
      logger.log("STROKE_FORWARDED", `Stroke forwarded to ${attemptLeaderId}`);
      currentLeaderId = attemptLeaderId;
      return;
    } catch (error: any) {
      const hint = error.response?.data?.leaderHint;
      if (hint && replicaMap[hint]) {
        logger.log("NODE_UNREACHABLE", `Leader hint received -> ${hint}`);
        try {
          await tryPost(hint);
          logger.log("STROKE_FORWARDED", `Stroke forwarded to ${hint} (via hint)`);
          currentLeaderId = hint;
          return;
        } catch (hintError) {
          // hint failed, fall through to probe
        }
      }

      logger.log("NODE_UNREACHABLE", `Leader ${attemptLeaderId} unreachable - probing network`);
      const probedLeader = await doProbeStr();
      if (probedLeader) {
        logger.log("LEADER_CHANGE", `Leader discovered via probe -> ${probedLeader}`);
        currentLeaderId = probedLeader;
        try {
          await tryPost(probedLeader);
          logger.log("STROKE_FORWARDED", `Stroke forwarded to ${probedLeader} (via probe)`);
          return;
        } catch (e) {
          // probe failed, fall to re-queue
        }
      }
    }
  }

  logger.log("NODE_UNREACHABLE", "No leader found - queuing for retry in 500ms");
  sendJson(ws, { type: "pending", localId });
  setTimeout(() => {
    forwardStroke(ws, localId, message).catch(() => {
      logger.log("NODE_UNREACHABLE", "Leader unreachable after queued retry");
    });
  }, 500);
}

wss.on("connection", (ws) => {
  clients.add(ws);
  logger.log("CLIENT_CONNECT", `Client connected | Total: ${clients.size}`);

  sendJson(ws, {
    type: "init",
    entries: committedEntries,
  });

  ws.on("message", async (raw) => {
    try {
      const event = JSON.parse(String(raw)) as WsClientEvent;
      if (event.type !== "stroke") {
        return;
      }

      sendJson(ws, { type: "pending", localId: event.localId });
      await forwardStroke(ws, event.localId, {
        clientId: event.localId,
        stroke: event.stroke,
      });
    } catch (error) {
      logger.log("NODE_UNREACHABLE", "Leader unreachable while processing client stroke");
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    logger.log("CLIENT_DISCONNECT", `Client disconnected | Total: ${clients.size}`);
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    currentLeaderId,
    clients: clients.size,
    committedEntries: committedEntries.length,
  });
});

app.get("/state", (_req, res) => {
  res.json({ currentLeaderId, replicaMap });
});

app.get("/status", (_req, res) => {
  res.json({
    replicaId: "gateway",
    state: "gateway",
    currentTerm: 0,
    votedFor: null,
    logLength: committedEntries.length,
    commitIndex: committedEntries.length,
    leaderId: currentLeaderId,
    msSinceLastHeartbeat: 0,
    recentEvents: logger.getRecentEvents(50),
  });
});

app.post("/leader-change", (req, res) => {
  const body = req.body as LeaderChangeRequest;
  if (!body?.newLeaderId || typeof body.term !== "number") {
    return res.status(400).json({ ok: false, message: "Invalid leader change payload" });
  }

  if (!replicaMap[body.newLeaderId]) {
    return res.status(400).json({ ok: false, message: "Unknown leader id" });
  }

  currentLeaderId = body.newLeaderId;
  logger.log("LEADER_CHANGE", `Leader updated -> ${body.newLeaderId} | Term: ${body.term}`);
  return res.json({ ok: true });
});

app.post("/commit-notify", (req, res) => {
  const body = req.body as CommitNotifyRequest;
  if (!body || typeof body.logIndex !== "number" || !body.stroke) {
    return res.status(400).json({ ok: false, message: "Invalid commit payload" });
  }

  if (committedEntries.some((entry) => entry.index === body.logIndex)) {
    return res.json({ ok: true, duplicate: true });
  }

  const entry: LogEntry = {
    index: body.logIndex,
    term: 0,
    stroke: body.stroke,
  };
  committedEntries.push(entry);

  const payload: WsServerCommittedEvent = {
    type: "committed",
    logIndex: body.logIndex,
    stroke: body.stroke,
  };
  broadcast(payload);
  logger.log("BROADCAST", `Committed stroke broadcast | Index: ${body.logIndex} | Clients: ${clients.size}`);

  return res.json({ ok: true });
});

server.listen(gatewayPort, () => {
  logger.log("STARTUP", `Gateway listening on :${gatewayPort}`);
});
