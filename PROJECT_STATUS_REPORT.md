# Project Status Report
## Distributed Real-Time Drawing Board with Mini-RAFT Consensus

**Date:** March 25, 2026  
**Prepared for:** Project Team  
**Status:** Partially Complete (Core Consensus Flow Working; Frontend + Observability Layers Expanded; Requirement Gaps Remaining)

---

## 1) Executive Summary

The project now has a functional mini distributed drawing system with:
- Gateway service (WebSocket ingress + commit broadcast)
- Three replica services implementing Mini-RAFT election/heartbeat/replication
- Frontend with optimistic drawing, pending/committed rendering, and multi-tool UI
- Observability layer with structured logs, replica `/status`, and dashboard UI

The core distributed flow is stable for demo use. Full SRS/SAD compliance remains partial, primarily due to simplified failover handling, in-memory durability limits, and limited production-grade verification.

### Update Since Last Report

Newly confirmed in implementation:
- Frontend collaboration enhancements: `undo`, `redo`, `clear`, shape tools, fill toggle, export, shortcuts.
- Shared logger utility added (`packages/shared/src/logger.ts`) with:
  - standardized event types,
  - stdout structured format,
  - circular buffer (last 100 events).
- Replica `GET /status` endpoint added with live state + recent events.
- Dashboard service added on port `3001` with:
  - `GET /api/status` aggregated node state,
  - `GET /api/events` SSE stream with deduplicated events,
  - node cards and live event feed.
- RAFT protocol timing is unchanged from baseline expectations:
  - heartbeat interval: `150ms`,
  - election timeout: `500–800ms`.
- Log noise reduction implemented without changing consensus behavior:
  - heartbeat/unreachable logs throttled to ~`3–5s` cadence via `HEARTBEAT_LOG_INTERVAL_MS`.

Net effect:
- UX and demo value improved.
- Operational visibility improved significantly.
- Core RAFT behavior remains unchanged.

---

## 2) Current Implementation Scope (Done)

### 2.1 Architecture and Runtime

✅ Implemented
- Monorepo with shared package + gateway + replica services + dashboard service
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
- Leader forwarding via `POST /stroke`
- Commit handling via `POST /commit-notify`
- Leader updates via `POST /leader-change`
- Structured event logging for connect/disconnect/forward/broadcast/leader-change/unreachable

### 2.4 Replica / Mini-RAFT

✅ Implemented
- Roles: follower/candidate/leader
- Election timeout randomization (500–800 ms)
- Heartbeat loop (150 ms)
- AppendEntries replication + quorum commit
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
- **Fault tolerance under realistic failures:** Moderate
- **Operational readiness / observability:** Moderate
- **Strict SRS conformance:** Partial

### 3.2 Functional Requirement Status

| Area | Status | Notes |
|---|---|---|
| Frontend freehand + optimistic rendering | ✅ Met | Core behavior implemented |
| Frontend shape + eraser tooling | ✅ Implemented (Scope Extension) | Beyond baseline minimum |
| Frontend undo/redo/clear collaboration | ✅ Implemented (Scope Extension) | Command-style committed events |
| Pending vs committed visualization | ✅ Met | Clear visual distinction |
| Gateway WS client management | ✅ Met | Client pool + broadcast |
| Gateway forwards writes to leader | ✅ Met | Uses leader map and `/stroke` |
| Explicit leader change handling | ✅ Met | `/leader-change` updates leader |
| Replica state machine + elections | ✅ Met | Quorum voting and transitions |
| Heartbeats and follower suppression | ✅ Met | Leader periodic heartbeats |
| Quorum commit behavior | ✅ Met | Majority-based commit |
| Catch-up synchronization path | 🟡 Partial | Present but simplified semantics |
| Replica live status endpoint (`/status`) | ✅ Met | Exposes live state + recent events |
| Structured event logging | ✅ Met | Shared format + event model |
| Dashboard status + event stream | ✅ Implemented (Scope Extension) | Improves operational visibility |
| Hot reload bind-mount workflow (FR-D02) | ❌ Not Met | Compose does not provide required mode |

---

## 4) Detailed Gaps and Missing Items

### 4.1 2-Node Cluster Replication Timeout & State Desync

**Observed:**
- When 1 node dies in a 3-node cluster, the system becomes a 2-node cluster (maintaining a 2/3 quorum).
- The leader's `replicateEntry` function blocks on a `700ms` `axios` timeout when attempting to send `AppendEntries` to the dead node.
- This `700ms` penalty pushes the leader's stroke response time dangerously close to the Gateway's `800ms` forwarding timeout. The Gateway frequently drops the connection and fails to gracefully fallback or inform the frontend client. Commits are logged by the replica but drop at the gateway layer.
- Followers only receive the leader's newly updated `commitIndex` when the *next* stroke is transmitted via `AppendEntries` (heartbeats do not carry `leaderCommit`). Thus, replicas appear one commit behind the leader.
- If the remaining nodes die and are replaced, or the leader shuts down, the follower with the lagging `commitIndex` wins the election and overwrites uncommitted logs, permanently breaking the system.

**Impact:**
- Commits appear successful on the replica but inconsistently reach the frontend.
- Single-node failures eventually destabilize the consensus graph and break follower recovery.

### 4.2 Gateway Failover Behavior Still Simplified

**Observed:**
- Gateway relies primarily on explicit `/leader-change` updates.
- No robust gateway-side discovery/retry strategy for unknown/stale leader.

**Impact:**
- Temporary forwarding failures can occur during leader transitions.

### 4.3 In-Memory Durability Gap

**Observed:**
- Gateway committed state and replica logs are in-memory.

**Impact:**
- Restart scenarios can lose state and weaken fault-tolerance claims.

### 4.4 Commit-Safety Hardening Still Limited

**Observed:**
- Core conflict handling exists, but committed-prefix invariants are not strongly guarded with explicit safety checks/tests.

**Impact:**
- Edge-case confidence remains limited.

### 4.5 Observability Improved But Still Basic

**Observed:**
- Structured logs, status endpoint, and live dashboard are implemented.

**Impact:**
- Debugging and demos are much better.
- Still missing persistent log storage, metrics, alerting, and historical analysis.

### 4.6 Hot-Reload Workflow Requirement Gap

**Observed:**
- Dev execution uses `tsx`, but compose lacks bind-mounted hot-reload path expected by FR-D02 narrative.

**Impact:**
- Workflow does not fully align with SRS/SAD hot-reload expectations.

### 4.7 NFR Validation Still Pending

**Observed:**
- No embedded automated benchmarks for latency/recovery targets.

**Impact:**
- NFR claims remain unproven.

### 4.8 Shared Contract Coverage Gap for Command Tools

**Observed:**
- Runtime uses command tools (`undo`/`redo`/`clear`) in stroke payload behavior.
- Shared `DrawingTool` currently models only drawing tools.

**Impact:**
- Type-model drift risk remains.

---

## 5) Risk Assessment (Current)

| Risk | Severity | Likelihood | Why It Matters |
|---|---|---|---|
| Forwarding failure during leader turnover | High | Medium | Impacts reliability perception |
| Data loss on full restart | High | Medium | In-memory-only resilience limit |
| Dashboard blind spots during multi-node outage | Medium | Medium | No persistent event replay |
| Requirement mismatch for hot reload rubric | Medium | High | Impacts grading/compliance |
| Unverified latency/recovery targets | Medium | Medium | Readiness claims remain weak |
| Schema drift for command tools | Medium | Medium | Runtime/type inconsistency risk |

---

## 6) Suggested Action Plan (Prioritized)

### Priority 1 — Reliability and Failover
1. Add gateway-side retry/fallback on failed leader forwarding.
2. Add leader discovery fallback when forwarding fails.
3. Improve non-leader responses with actionable `leaderHint`.

### Priority 2 — Safety and Correctness
4. Add explicit committed-prefix safety guards.
5. Strengthen sync semantics against committed-prefix invariants.

### Priority 3 — Observability Maturity
6. Add persistent structured-log sink/export strategy.
7. Add lightweight metrics and threshold alerting (election rate, commit latency, heartbeat freshness).

### Priority 4 — SRS Workflow Compliance
8. Add optional bind-mount + hot-reload compose mode (if required by rubric).
9. Document run profiles (demo mode vs hot-reload mode).

### Priority 5 — Verification
10. Add scenario-based validation checklist:
   - leader crash/election recovery,
   - follower restart/sync catch-up,
   - quorum behavior with one node down,
   - end-to-end latency sampling.
11. Add UI-level parity checks for drawing tools.
12. Align shared types with collaborative command operations.

---

## 7) Definition of “Done” for Next Milestone

Next milestone is complete when:
- Forwarding/failover handling avoids user-visible stroke loss for single-node failures.
- Safety invariants are explicit and test-backed.
- Observability includes persistent logs + basic metrics, not only live dashboard.
- Hot-reload workflow is either implemented or formally scoped out in requirements.
- NFR latency/recovery targets are measured and repeatable.

---

## 8) Final Project Status Statement

**Current project status:**
- **Functionally viable demo:** Yes
- **Core Mini-RAFT logic operational:** Yes
- **Live observability dashboard available:** Yes
- **Fully compliant with attached SAD/SRS:** No (partial)
- **Ready for final acceptance without further work:** Not yet

The project is in a strong intermediate state with solid core flow and materially improved observability. Remaining work is focused on robustness hardening, strict requirement conformance, and verification depth.