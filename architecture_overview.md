# Mini-RAFT Architecture & Implementation Details

This document explains the core architecture of the Mini-RAFT distributed drawing board project, including how the different components communicate, where state is maintained, and the granular purpose of each file and critical function.

## 1. System Overview

The project is built on three main pillars:
1. **The Gateway (`services/gateway`)**: A single entry point that manages all WebSocket connections with clients (the frontends/dashboards) and intelligently routes drawing "strokes" to the dynamically elected RAFT Leader.
2. **The Replicas (`services/replica`)**: A group of nodes (usually 3) maintaining distributed consensus using an implementation of the RAFT protocol. They ensure every drawing stroke is redundantly logged and committed.
3. **The Shared Library (`@mini-raft/shared`)**: Contains common TypeScript interfaces and utility functions used by both the Gateway and the Replicas.
4. **The Dashboard (`dashboard/`)**: The frontend client that connects via WebSocket to the Gateway to stream drawings.

### Core Flow of a "Stroke":
- Client draws a line and sends a JSON WebSocket message (`WsClientEvent`) to the **Gateway**.
- Gateway pauses the stroke in a `pending` state and issues an HTTP `POST /stroke` to the **Replica Leader**.
- The Replica Leader creates a local `LogEntry`, pushes it to its array, and issues `POST /append-entries` to its peers using `replicateEntry()`.
- Once a **Quorum** (majority) of peers respond successfully, the entry is "Committed".
- The Leader notifies the **Gateway** via a `POST /commit-notify`.
- The Gateway then **Broadcasts** the committed stroke to all connected WebSockets.

---

## 2. Gateway (`services/gateway/src/index.ts`)

The Gateway is a lightweight Express + WebSocket Node.js server. Its primary job is connection multiplexing and bridging the synchronous RAFT cluster to the asynchronous streaming connections of the frontend.

### Key Variables
* `clients`: A `Set<WebSocket>` storing all active UI connections.
* `replicaMap`: A record detailing node URLs (e.g. `replica1 -> http://replica1:4001`).
* `currentLeaderId`: The Gateway's cached pointer for the cluster leader.
* `committedEntries`: A simple array keeping track of all strokes that have been permanently ratified by RAFT.

### Critical Functions
* `forwardStroke(ws, localId, message)`: The heart of the Gateway.
  * Attempts to HTTP POST the stroke to the current known leader.
  * If the request fails (e.g. timeout, died node, or 409 mismatch), it inspects the error response for a `leaderHint`.
  * If a hint is present, it dynamically updates `currentLeaderId` and immediately retries the stroke toward the new hint.
  * If no hint is available or the network failed completely, it invokes `doProbeStr()` to poll all nodes for a heartbeat (`GET /status`).
  * If probing reveals a leader, it resets the connection and fires the stroke there. If not, it requeues the stroke to retry in exactly 500ms using `setTimeout()`.

* `app.post("/leader-change")`: An internal endpoint used by a Replica *immediately* upon an election victory to alert the Gateway of the new topology.

* `app.post("/commit-notify")`: Invoked by the Replica Leader whenever quorum is reached. It permanently stores the stroke in `committedEntries` and loops over `clients.forEach(...)` to broadcast the final result.

---

## 3. Replica Consensus Node (`services/replica/src/raftNode.ts`)

`raftNode.ts` is the heavy lifter. It encapsulates the core RAFT leader election and log replication algorithm.

### Key Variables
* `state`: Can be `"follower"`, `"candidate"`, or `"leader"`.
* `currentTerm`: The monotonic election cycle counter mapping to RAFT theory.
* `log`: An array of `LogEntry` objects (the strokes).
* `commitIndex`: The highest index known to be safely replicated across the quorum.

### Critical Functions
* `beginElection()`:
  * Transitions state to `"candidate"` and bumps the `currentTerm`.
  * Casts a self-vote.
  * Asynchronously fires `POST /request-vote` to all peers.
  * If the function tallies enough `voteGranted: true` responses to reach a **Quorum** (majority), it immediately invokes `becomeLeader()`.
  
* `becomeLeader()`:
  * Triggers transition to `"leader"`.
  * Drops the random `electionTimer` and initiates the scheduled `heartbeatTimer`.
  * Asynchronously shoots a `notifyGatewayLeaderChange()` alert so the Gateway seamlessly knows where to route strokes.

* `sendHeartbeats()`:
  * Periodically triggered (usually every 150ms). Proves to peers that the leader is alive via `POST /heartbeat`.
  * If any peer responds with a higher `term`, the node recognizes a newer leader exists and immediately degrades back to `"follower"`.

* `appendStroke(stroke)`:
  * Handles the ingress of new drawing strokes from the Gateway. Only runs if `isLeader()`.
  * Packages the stroke into a `LogEntry`, pushes it to the local array, and asks `replicateEntry()` to synchronize it with peers.

* `replicateEntry(entry)`:
  * Executes a parallel map (`Promise.all` style) calling `POST /append-entries` to followers.
  * Resolves **instantly** the moment `successCount === quorum` is reached. It intentionally does not block or wait for dead/unresponsive peers as long as a working majority exists.
  * If a peer responds with `success: false` (indicating a desynchronized or lagging log), it subsequently fires `syncFollower(...)` to overwrite their log history.

* `onAppendEntries(req)`:
  * The ingestion handler for follower nodes.
  * Verifies that the `term` is strictly `>= currentTerm`.
  * Cross-checks `prevLogIndex` against its internal log. If out of bounds or the `prevLogTerm` fails to match (suggesting an uncommitted split-brain branch), it rejects the heartbeat with `success: false`, triggering the Leader to overwrite it later.

---

## 4. Replica Express Routes (`services/replica/src/index.ts`)

This file mounts the HTTP endpoints that accept requests (both from the Gateway and from Peer Replicas) and routes them rigidly into the `.ts` methods of the `MiniRaftNode` instance.

### Critical Routes
* `POST /stroke`: Interfaced by the Gateway.
  * Rejects with `HTTP 409` format `{ success: false, leaderHint: "replicaX" }` if the receiving node is a Follower, forcing the Gateway to fallback to `replicaX`.
  * Otherwise, accepts the payload and triggers `appendStroke`.
* `POST /request-vote`: Triggered by nodes firing `beginElection()`.
* `POST /append-entries`: Handled by `onAppendEntries()`. Serves as the actual data payload carrier for replication.
* `POST /heartbeat`: Simple, empty packet verifying cluster liveliness.

---

## 5. Replica Configuration (`services/replica/src/config.ts`)

Parses the environment (`.env` or Docker Compose args) to dictate RAFT timing. RAFT functions reliably *only* if carefully tuned randomized timeouts prevent split-brain deadlocks.
* `electionTimeoutMinMs` -> `electionTimeoutMaxMs`: The jitter window. If no heartbeats arrive within this random interval, the follower revolts and calls `beginElection()`.
* `gatewayNotifyTimeoutMs`: Adjusts how patient the Replica should be when talking to the Gateway, useful during Docker bridge network hiccups.
