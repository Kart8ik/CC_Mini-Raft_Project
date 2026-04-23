import express from "express";
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
const pendingStrokes = new Set<string>();

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

async function forwardStroke(ws: WebSocket, localId: string, message: StrokeIngressRequest, isRetry = false): Promise<void> {
  if (!isRetry) {
    if (pendingStrokes.has(localId)) return;
    pendingStrokes.add(localId);
  }

  let attemptLeaderId = currentLeaderId;

  const tryPost = async (leaderId: string) => {
    const leaderUrl = replicaMap[leaderId];
    const res = await fetch(`${leaderUrl}/stroke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err: any = new Error(`HTTP ${res.status}`);
      err.responseData = body;
      throw err;
    }
    return res.json();
  };

  const handleCommitted = (data: any, leaderId: string) => {
    if (data?.committed && typeof data.logIndex === "number") {
      if (!committedEntries.some((e) => e.index === data.logIndex)) {
        const entry: LogEntry = { index: data.logIndex, term: 0, stroke: message.stroke };
        committedEntries.push(entry);
        const payload: WsServerCommittedEvent = {
          type: "committed",
          logIndex: data.logIndex,
          stroke: message.stroke,
        };
        broadcast(payload);
        logger.log("BROADCAST", `Committed stroke broadcast | Index: ${data.logIndex} | Clients: ${clients.size}`);
      }
    }
    logger.log("STROKE_FORWARDED", `Stroke forwarded to ${leaderId}`);
    currentLeaderId = leaderId;
    pendingStrokes.delete(localId);
  };

  const doProbeStr = async (skipId?: string) => {
    const probePromises = Object.entries(replicaMap)
      .filter(([id]) => id !== skipId)
      .map(async ([id, url]) => {
        try {
          const res = await fetch(`${url}/status`, { signal: AbortSignal.timeout(500) });
          if (!res.ok) return null;
          const data = await res.json();
          if (data?.state === "leader") {
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
      const response = await tryPost(attemptLeaderId);
      handleCommitted(response, attemptLeaderId);
      return;
    } catch (error: any) {
      const hint = error.responseData?.leaderHint;
      if (hint && replicaMap[hint]) {
        logger.log("NODE_UNREACHABLE", `Leader hint received -> ${hint}`);
        try {
          const response = await tryPost(hint);
          handleCommitted(response, hint);
          return;
        } catch (hintError) {
          // hint failed, fall through to probe
        }
      }

      logger.log("NODE_UNREACHABLE", `Leader ${attemptLeaderId} unreachable - probing network`);
      const probedLeader = await doProbeStr(attemptLeaderId);
      if (probedLeader) {
        logger.log("LEADER_CHANGE", `Leader discovered via probe -> ${probedLeader}`);
        currentLeaderId = probedLeader;
        try {
          const response = await tryPost(probedLeader);
          handleCommitted(response, probedLeader);
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
    forwardStroke(ws, localId, message, true).catch(() => {
      logger.log("NODE_UNREACHABLE", "Leader unreachable after queued retry");
      pendingStrokes.delete(localId);
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
    // clean up any pending strokes from this client if needed
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
