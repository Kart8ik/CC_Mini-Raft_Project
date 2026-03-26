# Project Status Report
## Distributed Real-Time Drawing Board with Mini-RAFT Consensus

**Date:** March 26, 2026  
**Prepared for:** Project Team  
**Status:** Functional — Core Consensus, Failover, and Observability All Operational

---

## 1) Executive Summary

The project is a fully functional distributed drawing system with robust single-node fault tolerance:
- Gateway service (WebSocket ingress + inline commit broadcast + multi-tier failover)
- Three replica services implementing Mini-RAFT election/heartbeat/replication
- Frontend with optimistic drawing, pending/committed rendering, and multi-tool UI
- Observability layer with structured logs, replica `/status`, and dashboard UI

All critical failover issues identified in the previous report have been resolved. The system now maintains normal operation (stroke drawing, commitment, and WebSocket broadcast) when any single node in the 3-node cluster is killed, and recovers cleanly when the dead node restarts.

### Changes Since Last Report

- **Quorum-based early resolution:** `replicateEntry` and `beginElection` now resolve immediately upon reaching majority quorum instead of waiting for all peers.
- **Election timer safety:** `becomeLeader()` clears the election timer before starting heartbeats, preventing phantom self-elections.
- **Per-peer heartbeat isolation:** Heartbeats are dispatched independently per peer with per-peer in-flight tracking. A dead peer's 500ms timeout no longer blocks heartbeats to live peers.
- **Heartbeat commit sync:** Heartbeats now carry `leaderCommit`, so followers update their `commitIndex` every heartbeat cycle (~150ms) without needing a new stroke.
- **Async commit notification:** `notifyGatewayCommit` is fire-and-forget (`void`), so the replica responds to the gateway instantly after quorum.
- **Inline gateway broadcast:** The gateway now broadcasts committed strokes immediately from `forwardStroke` when the replica returns `committed: true`, rather than depending on a separate async callback.
- **Smart probe skip:** The gateway excludes the just-failed leader from status probes, cutting probe latency from ~500ms to ~5ms.
- **In-flight stroke dedup:** A `pendingStrokes` set prevents the gateway from processing duplicate retries of the same stroke.
- **Leader hint fallback:** Non-leader replicas return a `leaderHint` in their 409 response, enabling instant gateway rerouting.
- **Nodemon hot reload completed:** Gateway, replicas, and dashboard now run watch-mode dev scripts with automatic restart on TypeScript changes.
- **Compose volume fix completed:** Services now bind-mount the monorepo root with isolated `/app/node_modules` to support stable Docker-based hot reload.
- **Per-replica workspace split completed:** Replica service was split into `services/replica1`, `services/replica2`, `services/replica3` with unique workspace package names to avoid npm duplicate-workspace conflicts.

---

## 2) Current Implementation Scope (Done)

### 2.1 Architecture and Runtime

✅ Implemented
- Monorepo with shared package + gateway + replica services + dashboard service
- Three independent replica workspaces (`@mini-raft/replica1`, `@mini-raft/replica2`, `@mini-raft/replica3`) for isolated hot-reload behavior
- 1 gateway + 3 replicas + 1 frontend + 1 dashboard topology
- Docker Compose orchestration on shared network

### 2.2 Frontend

✅ Implemented
- Canvas drawing with pointer support
- Optimistic pending overlay and committed rendering
- Multi-tool support: pen, line, rectangle, circle, eraser
- Collaborative command actions: undo, redo, clear
- Fill toggle, size/color controls, PNG download, keyboard shortcuts

### 2.3 Gateway

✅ Implemented
- WebSocket client pool management
- Multi-tier leader forwarding: direct → leaderHint → parallel probe → 500ms requeue
- Inline commit broadcast on successful `POST /stroke` response
- Fallback commit handling via `POST /commit-notify` (with dedup)
- Leader updates via `POST /leader-change`
- In-flight stroke dedup via `pendingStrokes` tracking
- Structured event logging

### 2.4 Replica / Mini-RAFT

✅ Implemented
- Roles: follower/candidate/leader
- Election timeout randomization (500–800 ms)
- Per-peer heartbeat dispatch (150 ms) with `leaderCommit` synchronization
- `Promise.allSettled`-based replication with early quorum resolution
- `leaderHint` responses from non-leader `/stroke` handlers
- Sync endpoint for lagging follower catch-up
- Structured RAFT event logs
- `GET /status` endpoint exposing live diagnostics

### 2.5 Observability Dashboard

✅ Implemented
- Dashboard service on `3001`
- Aggregated node status API (`/api/status`)
- SSE event stream (`/api/events`)
- Live node cards with state coloring, heartbeat freshness, and lag indicator

---

## 3) Requirement Alignment Snapshot (SRS + SAD)

### 3.1 Overall Compliance Score (Qualitative)

- **Core distributed workflow:** Strong
- **Fault tolerance under realistic failures:** Strong (single-node failure fully handled)
- **Operational readiness / observability:** Moderate
- **Strict SRS conformance:** Partial

### 3.2 Functional Requirement Status

| Area | Status | Notes |
|---|---|---|
| Frontend freehand + optimistic rendering | ✅ Met | Core behavior implemented |
| Frontend shape + eraser tooling | ✅ Implemented | Beyond baseline minimum |
| Pending vs committed visualization | ✅ Met | Clear visual distinction |
| Gateway WS client management | ✅ Met | Client pool + broadcast |
| Gateway forwards writes to leader | ✅ Met | Multi-tier failover with hints + probes |
| Gateway inline commit broadcast | ✅ Met | Instant broadcast on committed response |
| Explicit leader change handling | ✅ Met | `/leader-change` updates leader |
| Replica state machine + elections | ✅ Met | Quorum voting, timer safety |
| Heartbeats and follower suppression | ✅ Met | Per-peer isolation, commitIndex sync |
| Quorum commit behavior | ✅ Met | Early resolution, majority-based |
| Catch-up synchronization path | ✅ Met | `/sync-log` with awaited sync |
| Replica live status endpoint | ✅ Met | Exposes live state + recent events |
| Structured event logging | ✅ Met | Shared format + event model |
| Single-node failover tolerance | ✅ Met | Tested with `docker stop` |

---

## 4) Remaining Gaps

### 4.1 In-Memory Durability Gap

- Gateway committed state and replica logs are in-memory.
- Restart scenarios can lose state.

### 4.2 NFR Validation Still Pending

- No embedded automated benchmarks for latency/recovery targets.

### 4.3 Hot-Reload Workflow Requirement Gap

- ✅ Resolved. Docker Compose and workspace scripts now support hot reload via nodemon across gateway, replicas, dashboard, and shared package edits.

---

## 5) Risk Assessment (Current)

| Risk | Severity | Likelihood | Why It Matters |
|---|---|---|---|
| Data loss on full restart | High | Medium | In-memory-only resilience limit |
| Unverified latency/recovery targets | Medium | Medium | Readiness claims remain weak |
| Hot reload instability on some Docker hosts | Low | Low | May require polling watcher flags on certain host FS setups |

---

## 6) Final Project Status Statement

**Current project status:**
- **Functionally viable demo:** Yes
- **Core Mini-RAFT logic operational:** Yes
- **Single-node failover working:** Yes
- **Live observability dashboard available:** Yes
- **Strokes appear correctly during node failure:** Yes
- **Hot reload via nodemon in Docker Compose:** Yes
- **Fully compliant with attached SAD/SRS:** Partial (in-memory durability + pending NFR benchmark validation)

The project is in a strong functional state with all core distributed consensus, replication, and failover mechanisms working correctly under single-node failure scenarios.