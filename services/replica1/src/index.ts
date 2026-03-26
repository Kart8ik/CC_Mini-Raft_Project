import express from "express";
import {
  AppendEntriesRequest,
  HeartbeatRequest,
  RequestVoteRequest,
  StrokeIngressRequest,
  SyncLogRequest,
} from "@mini-raft/shared";
import { loadConfig } from "./config";
import { MiniRaftNode } from "./raftNode";

const config = loadConfig();
const node = new MiniRaftNode(config);

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ...node.getSnapshot() });
});

app.get("/status", (_req, res) => {
  res.json(node.getStatus());
});

app.get("/debug/log", (_req, res) => {
  res.json({ entries: node.getLog() });
});

app.post("/request-vote", async (req, res) => {
  const body = req.body as RequestVoteRequest;
  const response = await node.onRequestVote(body);
  res.json(response);
});

app.post("/heartbeat", async (req, res) => {
  const body = req.body as HeartbeatRequest;
  const response = await node.onHeartbeat(body);
  res.json(response);
});

app.post("/append-entries", async (req, res) => {
  const body = req.body as AppendEntriesRequest;
  const response = await node.onAppendEntries(body);
  res.json(response);
});

app.post("/sync-log", (req, res) => {
  const body = req.body as SyncLogRequest;
  const response = node.onSyncLog(body.fromIndex, body.entries);
  res.json(response);
});

app.post("/stroke", async (req, res) => {
  const body = req.body as StrokeIngressRequest;
  if (!node.isLeader()) {
    const hint = node.getLeaderHint();
    return res.status(409).json({
      success: false,
      leaderHint: hint === "unknown" ? null : hint,
    });
  }

  const result = await node.appendStroke(body.stroke);
  return res.json({
    accepted: true,
    committed: result.committed,
    logIndex: result.index,
  });
});

app.listen(config.port, () => {
  node.start();
});
