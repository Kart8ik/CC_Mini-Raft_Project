export type NodeState = "follower" | "candidate" | "leader";

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  points: Point[];
  color: string;
  width: number;
}

export interface LogEntry {
  term: number;
  index: number;
  stroke: Stroke;
}

export interface RequestVoteRequest {
  term: number;
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
}

export interface RequestVoteResponse {
  term: number;
  voteGranted: boolean;
}

export interface AppendEntriesRequest {
  term: number;
  leaderId: string;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: LogEntry[];
  leaderCommit: number;
}

export interface AppendEntriesResponse {
  term: number;
  success: boolean;
  logLength: number;
}

export interface HeartbeatRequest {
  term: number;
  leaderId: string;
}

export interface HeartbeatResponse {
  term: number;
  success: boolean;
}

export interface SyncLogRequest {
  fromIndex: number;
  entries: LogEntry[];
}

export interface SyncLogResponse {
  success: boolean;
  newLogLength: number;
}

export interface StrokeIngressRequest {
  clientId: string;
  stroke: Stroke;
}

export interface StrokeIngressResponse {
  accepted: boolean;
  committed: boolean;
  leaderHint?: string;
  logIndex?: number;
}

export interface CommitNotifyRequest {
  logIndex: number;
  stroke: Stroke;
}

export interface LeaderChangeRequest {
  newLeaderId: string;
  term: number;
}

export interface WsClientStrokeEvent {
  type: "stroke";
  stroke: Stroke;
  localId: string;
}

export interface WsServerInitEvent {
  type: "init";
  entries: LogEntry[];
}

export interface WsServerCommittedEvent {
  type: "committed";
  logIndex: number;
  stroke: Stroke;
  localId?: string;
}

export interface WsServerPendingEvent {
  type: "pending";
  localId: string;
}

export type WsClientEvent = WsClientStrokeEvent;
export type WsServerEvent = WsServerInitEvent | WsServerCommittedEvent | WsServerPendingEvent;

export interface ReplicaStateSnapshot {
  replicaId: string;
  state: NodeState;
  currentTerm: number;
  votedFor: string | null;
  commitIndex: number;
  logLength: number;
}

export function parseReplicaMap(value: string): Record<string, string> {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, pair) => {
      const [id, url] = pair.split("=");
      if (id && url) {
        acc[id.trim()] = url.trim();
      }
      return acc;
    }, {});
}
