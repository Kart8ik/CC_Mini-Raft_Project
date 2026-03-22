import express from "express";
import axios from "axios";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import {
  CommitNotifyRequest,
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

async function forwardStroke(message: StrokeIngressRequest): Promise<void> {
  if (!currentLeaderId || !replicaMap[currentLeaderId]) {
    throw new Error("No leader known by gateway");
  }

  const leaderUrl = replicaMap[currentLeaderId];
  await axios.post(`${leaderUrl}/stroke`, message, { timeout: 800 });
}

wss.on("connection", (ws) => {
  clients.add(ws);

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
      await forwardStroke({
        clientId: event.localId,
        stroke: event.stroke,
      });
    } catch (error) {
      console.error("Gateway failed to process websocket message", error);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
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

app.post("/leader-change", (req, res) => {
  const body = req.body as LeaderChangeRequest;
  if (!body?.newLeaderId || typeof body.term !== "number") {
    return res.status(400).json({ ok: false, message: "Invalid leader change payload" });
  }

  if (!replicaMap[body.newLeaderId]) {
    return res.status(400).json({ ok: false, message: "Unknown leader id" });
  }

  currentLeaderId = body.newLeaderId;
  console.log(`Gateway switched leader to ${body.newLeaderId} term=${body.term}`);
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

  return res.json({ ok: true });
});

server.listen(gatewayPort, () => {
  console.log(`Gateway listening on :${gatewayPort}`);
});
