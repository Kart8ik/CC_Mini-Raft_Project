import express from "express";
import fs from "fs";
import path from "path";
import { LogEvent, ReplicaStatus } from "@mini-raft/shared";

type ReachableNode = ReplicaStatus & {
  reachable: true;
  url: string;
};

type UnreachableNode = {
  replicaId: string;
  reachable: false;
  url: string;
};

type NodeStatus = ReachableNode | UnreachableNode;

const app = express();
const port = Number(process.env.DASHBOARD_PORT || "3001");
const replicaUrls = (process.env.REPLICA_URLS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function resolveDir(candidates: string[], marker?: string): string {
  if (marker) {
    const found = candidates.find((c) => fs.existsSync(path.join(c, marker)));
    if (found) return found;
  }
  return candidates.find((c) => fs.existsSync(c)) || candidates[0];
}

const publicDir = resolveDir(
  [path.resolve(process.cwd(), "public"), path.resolve(process.cwd(), "dashboard/public"), path.resolve(__dirname, "../public")],
  "index.html",
);

const clientDir = resolveDir(
  [path.resolve(process.cwd(), "dist/client"), path.resolve(process.cwd(), "dashboard/dist/client"), path.resolve(__dirname, "../dist/client")],
  "board.html",
);

const seenEventKeys = new Set<string>();
const seenEventQueue: string[] = [];
const MAX_SEEN_EVENTS = 5000;

function parseReplicaId(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function rememberEventKey(key: string): void {
  if (seenEventKeys.has(key)) {
    return;
  }

  seenEventKeys.add(key);
  seenEventQueue.push(key);

  if (seenEventQueue.length > MAX_SEEN_EVENTS) {
    const removed = seenEventQueue.shift();
    if (removed) {
      seenEventKeys.delete(removed);
    }
  }
}

function eventKey(event: LogEvent): string {
  return `${event.timestamp}|${event.replicaId}|${event.event}`;
}

const REPLICA_STATUS_TIMEOUT_MS = 600;

async function fetchReplicaStatus(url: string): Promise<NodeStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REPLICA_STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/status`, { signal: controller.signal });
    if (!response.ok) {
      return {
        replicaId: parseReplicaId(url),
        reachable: false,
        url,
      };
    }
    const data = (await response.json()) as ReplicaStatus;
    return {
      ...data,
      reachable: true,
      url,
    };
  } catch {
    return {
      replicaId: parseReplicaId(url),
      reachable: false,
      url,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAllStatuses(): Promise<NodeStatus[]> {
  return Promise.all(replicaUrls.map((url) => fetchReplicaStatus(url)));
}

app.use(express.static(publicDir));
app.use(express.static(clientDir));

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/api/status", async (_req, res) => {
  const nodes = await fetchAllStatuses();
  res.json({
    nodes,
    fetchedAt: new Date().toISOString(),
  });
});

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const streamNewEvents = async () => {
    const statuses = await fetchAllStatuses();
    const reachableNodes = statuses.filter((node): node is ReachableNode => node.reachable === true);

    const combinedEvents: LogEvent[] = [];
    for (const node of reachableNodes) {
      combinedEvents.push(...node.recentEvents);
    }

    combinedEvents.sort((left, right) => left.timestamp.localeCompare(right.timestamp));

    for (const event of combinedEvents) {
      const key = eventKey(event);
      if (seenEventKeys.has(key)) {
        continue;
      }

      rememberEventKey(key);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  const interval = setInterval(() => {
    void streamNewEvents();
  }, 800);

  void streamNewEvents();

  req.on("close", () => {
    clearInterval(interval);
    res.end();
  });
});

app.listen(port, () => {
  process.stdout.write(`[dashboard] [${new Date().toISOString()}] [STARTUP] Dashboard listening on :${port}\n`);
});
