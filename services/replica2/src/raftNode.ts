import axios from "axios";
import {
  AppendEntriesRequest,
  AppendEntriesResponse,
  createLogger,
  HeartbeatRequest,
  LogEntry,
  NodeState,
  RequestVoteRequest,
  RequestVoteResponse,
  ReplicaStatus,
  ReplicaStateSnapshot,
  Stroke,
} from "@mini-raft/shared";
import { ReplicaConfig } from "./config";

export class MiniRaftNode {
  private readonly config: ReplicaConfig;
  private readonly logger: ReturnType<typeof createLogger>;
  private lastHeartbeatSentLogAt = 0;
  private lastHeartbeatReceivedLogAt = 0;
  private lastUnreachableLogAtByPeer = new Map<string, number>();
  private state: NodeState = "follower";
  private currentTerm = 0;
  private votedFor: string | null = null;
  private leaderId: string | null = null;
  private log: LogEntry[] = [];
  private commitIndex = 0;
  private lastHeartbeatAt = Date.now();
  private electionTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatingPeers = new Set<string>();

  constructor(config: ReplicaConfig) {
    this.config = config;
    this.logger = createLogger(this.config.replicaId);
  }

  start(): void {
    this.logger.log("STARTUP", `Started as FOLLOWER | Term: ${this.currentTerm}`);
    this.resetElectionTimer();
  }

  getSnapshot(): ReplicaStateSnapshot {
    return {
      replicaId: this.config.replicaId,
      state: this.state,
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      commitIndex: this.commitIndex,
      logLength: this.log.length,
    };
  }

  getStatus(): ReplicaStatus {
    return {
      replicaId: this.config.replicaId,
      state: this.state,
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      logLength: this.log.length,
      commitIndex: this.commitIndex,
      leaderId: this.getLeaderId(),
      msSinceLastHeartbeat: this.getMsSinceLastHeartbeat(),
      recentEvents: this.getRecentEvents(20),
    };
  }

  getLog(): LogEntry[] {
    return this.log;
  }

  getCurrentTerm(): number {
    return this.currentTerm;
  }

  getLeaderId(): string | null {
    return this.state === "leader" ? this.config.replicaId : this.leaderId;
  }

  getMsSinceLastHeartbeat(): number {
    if (this.state === "leader") {
      return 0;
    }
    return Math.max(0, Date.now() - this.lastHeartbeatAt);
  }

  getRecentEvents(n = 20) {
    return this.logger.getRecentEvents(n);
  }

  private shouldLogHeartbeatSent(): boolean {
    const now = Date.now();
    if (now - this.lastHeartbeatSentLogAt < this.config.heartbeatLogIntervalMs) {
      return false;
    }
    this.lastHeartbeatSentLogAt = now;
    return true;
  }

  private shouldLogHeartbeatReceived(): boolean {
    const now = Date.now();
    if (now - this.lastHeartbeatReceivedLogAt < this.config.heartbeatLogIntervalMs) {
      return false;
    }
    this.lastHeartbeatReceivedLogAt = now;
    return true;
  }

  private logPeerUnreachable(peerId: string): void {
    const now = Date.now();
    const lastAt = this.lastUnreachableLogAtByPeer.get(peerId) ?? 0;
    if (now - lastAt < this.config.heartbeatLogIntervalMs) {
      return;
    }
    this.lastUnreachableLogAtByPeer.set(peerId, now);
    this.logger.log("NODE_UNREACHABLE", `Could not reach ${peerId} - skipping`);
  }

  isLeader(): boolean {
    return this.state === "leader";
  }

  getLeaderHint(): string {
    return this.getLeaderId() ?? "unknown";
  }

  async onRequestVote(req: RequestVoteRequest): Promise<RequestVoteResponse> {
    if (req.term < this.currentTerm) {
      return { term: this.currentTerm, voteGranted: false };
    }

    if (req.term > this.currentTerm) {
      this.becomeFollower(req.term, `Stepped down - higher term seen | Term: ${req.term}`);
    }

    const alreadyVoted = this.votedFor && this.votedFor !== req.candidateId;
    if (alreadyVoted) {
      return { term: this.currentTerm, voteGranted: false };
    }

    this.votedFor = req.candidateId;
    this.logger.log("VOTE_SENT", `Voted for ${req.candidateId} | Term: ${this.currentTerm}`);
    this.resetElectionTimer();
    return { term: this.currentTerm, voteGranted: true };
  }

  async onHeartbeat(req: HeartbeatRequest): Promise<{ term: number; success: boolean }> {
    if (req.term < this.currentTerm) {
      return { term: this.currentTerm, success: false };
    }

    if (req.term >= this.currentTerm) {
      this.becomeFollower(req.term);
      this.leaderId = req.leaderId;
      this.lastHeartbeatAt = Date.now();
      this.resetElectionTimer();
    }

    if (req.leaderCommit !== undefined && req.leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(req.leaderCommit, this.log.length);
    }

    if (this.shouldLogHeartbeatReceived()) {
      this.logger.log("HEARTBEAT_RECEIVED", `Heartbeat from ${req.leaderId} | Term: ${req.term}`);
    }

    return { term: this.currentTerm, success: true };
  }

  async onAppendEntries(req: AppendEntriesRequest): Promise<AppendEntriesResponse> {
    if (req.term < this.currentTerm) {
      return { term: this.currentTerm, success: false, logLength: this.log.length };
    }

    if (req.term >= this.currentTerm) {
      this.becomeFollower(req.term);
      this.leaderId = req.leaderId;
      this.lastHeartbeatAt = Date.now();
      this.resetElectionTimer();
    }

    const targetIndex = req.entries.length > 0 ? req.entries[req.entries.length - 1].index : req.prevLogIndex;

    this.logger.log("APPEND_RECEIVED", `AppendEntries from ${req.leaderId} | Index: ${targetIndex} | Term: ${req.term}`);

    if (req.prevLogIndex > this.log.length) {
      return { term: this.currentTerm, success: false, logLength: this.log.length };
    }

    if (req.prevLogIndex > 0) {
      const prev = this.log[req.prevLogIndex - 1];
      if (!prev || prev.term !== req.prevLogTerm) {
        this.log = this.log.slice(0, Math.max(0, req.prevLogIndex - 1));
        return { term: this.currentTerm, success: false, logLength: this.log.length };
      }
    }

    if (req.entries.length > 0) {
      const fromIndex = req.prevLogIndex;
      this.log = this.log.slice(0, fromIndex);
      this.log.push(...req.entries);
    }

    if (req.leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(req.leaderCommit, this.log.length);
    }

    this.logger.log("APPEND_ACK", `ACK sent to ${req.leaderId} | Index: ${targetIndex}`);

    return { term: this.currentTerm, success: true, logLength: this.log.length };
  }

  onSyncLog(fromIndex: number, entries: LogEntry[]): { success: boolean; newLogLength: number } {
    this.logger.log("SYNC_START", `Sync requested from index ${fromIndex}`);
    const start = Math.max(0, fromIndex);
    this.log = this.log.slice(0, start).concat(entries);
    this.commitIndex = this.log.length;
    this.resetElectionTimer();
    this.logger.log("SYNC_COMPLETE", `Sync complete | Log length: ${this.log.length}`);
    return { success: true, newLogLength: this.log.length };
  }

  async appendStroke(stroke: Stroke): Promise<{ committed: boolean; index: number }> {
    if (!this.isLeader()) {
      return { committed: false, index: -1 };
    }

    const entry: LogEntry = {
      term: this.currentTerm,
      index: this.log.length + 1,
      stroke,
    };

    this.log.push(entry);
    const successCount = await this.replicateEntry(entry);
    const quorum = Math.floor((Object.keys(this.config.peers).length + 1) / 2) + 1;

    if (successCount >= quorum) {
      this.commitIndex = entry.index;
      this.logger.log("COMMIT", `Entry committed | Index: ${entry.index} | Term: ${this.currentTerm}`);
      void this.notifyGatewayCommit(entry);
      void this.sendHeartbeats();
      return { committed: true, index: entry.index };
    }

    return { committed: false, index: entry.index };
  }

  private randomElectionTimeoutMs(): number {
    const { electionTimeoutMinMs, electionTimeoutMaxMs } = this.config;
    const spread = electionTimeoutMaxMs - electionTimeoutMinMs;
    return electionTimeoutMinMs + Math.floor(Math.random() * (spread + 1));
  }

  private resetElectionTimer(): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
    }

    this.electionTimer = setTimeout(() => {
      void this.beginElection();
    }, this.randomElectionTimeoutMs());
  }

  private async beginElection(): Promise<void> {
    this.state = "candidate";
    this.currentTerm += 1;
    this.votedFor = this.config.replicaId;
    this.logger.log("ELECTION_START", `No heartbeat - starting election | Term: ${this.currentTerm}`);

    let votes = 1;
    const peers = Object.entries(this.config.peers);
    const lastLogIndex = this.log.length;
    const lastLogTerm = this.log.length === 0 ? 0 : this.log[this.log.length - 1].term;
    const quorum = Math.floor((peers.length + 1) / 2) + 1;

    if (votes >= quorum) {
      this.becomeLeader(votes);
      return;
    }

    let resolveElection!: () => void;
    const electionPromise = new Promise<void>((r) => { resolveElection = r; });

    const promises = peers.map(async ([peerId, url]) => {
      try {
        const payload: RequestVoteRequest = {
          term: this.currentTerm,
          candidateId: this.config.replicaId,
          lastLogIndex,
          lastLogTerm,
        };
        const response = await axios.post<RequestVoteResponse>(`${url}/request-vote`, payload, {
          timeout: 500,
        });

        if (this.state !== "candidate") {
          return false;
        }

        if (response.data.term > this.currentTerm) {
          this.becomeFollower(response.data.term, `Stepped down - higher term seen | Term: ${response.data.term}`);
          resolveElection();
          return false;
        }

        if (response.data.voteGranted) {
          votes += 1;
          this.logger.log("VOTE_RECEIVED", `Vote received from ${peerId} | Term: ${this.currentTerm}`);
          if (votes >= quorum) {
            resolveElection();
          }
          return true;
        }
        return false;
      } catch {
        this.logger.log("NODE_UNREACHABLE", `Could not reach ${peerId} - skipping`);
        return false;
      }
    });

    Promise.allSettled(promises).then(resolveElection);
    await electionPromise;

    if (this.state === "candidate" && votes >= quorum) {
      this.becomeLeader(votes);
      return;
    }

    if (this.state === "candidate") {
      this.logger.log("ELECTION_LOSS", `Election lost | Term: ${this.currentTerm} | Votes: ${votes}`);
      this.resetElectionTimer();
    }
  }

  private becomeFollower(term: number, reason?: string): void {
    this.state = "follower";
    this.currentTerm = term;
    this.votedFor = null;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (reason) {
      this.logger.log("ELECTION_LOSS", reason);
    }
  }

  private becomeLeader(votes: number): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }

    this.state = "leader";
    this.votedFor = this.config.replicaId;
    this.leaderId = this.config.replicaId;
    this.lastHeartbeatAt = Date.now();
    this.logger.log("ELECTION_WIN", `Won election | Term: ${this.currentTerm} | Votes: ${votes}`);

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeats();
    }, this.config.heartbeatIntervalMs);

    void this.notifyGatewayLeaderChange();
    void this.sendHeartbeats();
  }

  private async sendHeartbeats(): Promise<void> {
    if (!this.isLeader()) {
      return;
    }

    const peers = Object.entries(this.config.peers);
    const peerIds = peers.map(([peerId]) => peerId).join(", ");
    if (this.shouldLogHeartbeatSent()) {
      this.logger.log("HEARTBEAT_SENT", `Heartbeat sent to ${peerIds || "none"} | Term: ${this.currentTerm}`);
    }

    for (const [peerId, url] of peers) {
      if (this.heartbeatingPeers.has(peerId)) {
        continue;
      }

      this.heartbeatingPeers.add(peerId);
      const payload: HeartbeatRequest = {
        term: this.currentTerm,
        leaderId: this.config.replicaId,
        leaderCommit: this.commitIndex,
      };

      axios.post(`${url}/heartbeat`, payload, { timeout: 500 })
        .then((response) => {
          if (response.data?.term > this.currentTerm) {
            this.becomeFollower(response.data.term, `Stepped down - higher term seen | Term: ${response.data.term}`);
          }
        })
        .catch(() => {
          this.logPeerUnreachable(peerId);
        })
        .finally(() => {
          this.heartbeatingPeers.delete(peerId);
        });
    }
  }

  private async replicateEntry(entry: LogEntry): Promise<number> {
    const peers = Object.entries(this.config.peers);
    const quorum = Math.floor((peers.length + 1) / 2) + 1;
    let successCount = 1;

    if (successCount >= quorum || peers.length === 0) {
      return successCount;
    }

    let resolveQuorum!: (v: number) => void;
    const quorumPromise = new Promise<number>((r) => { resolveQuorum = r; });

    const promises = peers.map(async ([peerId, url]) => {
      try {
        const payload: AppendEntriesRequest = {
          term: this.currentTerm,
          leaderId: this.config.replicaId,
          prevLogIndex: entry.index - 1,
          prevLogTerm: entry.index > 1 ? this.log[entry.index - 2].term : 0,
          entries: [entry],
          leaderCommit: this.commitIndex,
        };

        const response = await axios.post<AppendEntriesResponse>(`${url}/append-entries`, payload, {
          timeout: 700,
        });

        if (response.data.term > this.currentTerm) {
          this.becomeFollower(response.data.term, `Stepped down - higher term seen | Term: ${response.data.term}`);
          resolveQuorum(successCount);
          return false;
        } else if (response.data.success) {
          successCount += 1;
          this.logger.log("APPEND_ACK", `ACK received from ${peerId} | Index: ${entry.index}`);
          if (successCount >= quorum) {
            resolveQuorum(successCount);
          }
          return true;
        } else {
          await this.syncFollower(peerId, url, response.data.logLength);
          return false;
        }
      } catch {
        this.logPeerUnreachable(peerId);
        return false;
      }
    });

    Promise.allSettled(promises).then(() => resolveQuorum(successCount));
    return quorumPromise;
  }

  private async syncFollower(peerId: string, url: string, followerLength: number): Promise<void> {
    const start = Math.max(0, followerLength);
    const entries = this.log.slice(start);
    if (entries.length === 0) {
      return;
    }

    this.logger.log("SYNC_START", `${peerId} is lagging - syncing from index ${start}`);

    try {
      await axios.post(
        `${url}/sync-log`,
        {
          fromIndex: start,
          entries,
        },
        { timeout: 1000 },
      );
      this.logger.log("SYNC_COMPLETE", `Sync complete | Log length: ${start + entries.length}`);
    } catch {
      this.logPeerUnreachable(peerId);
    }
  }

  private async notifyGatewayLeaderChange(): Promise<void> {
    const delivered = await this.postGatewayWithRetries("/leader-change", {
      newLeaderId: this.config.replicaId,
      term: this.currentTerm,
    });

    if (delivered) {
      this.logger.log("LEADER_CHANGE", `New leader: ${this.config.replicaId} | Term: ${this.currentTerm}`);
    } else {
      this.logger.log("NODE_UNREACHABLE", "Could not reach gateway - skipping leader notification");
    }
  }

  private async notifyGatewayCommit(entry: LogEntry): Promise<void> {
    const delivered = await this.postGatewayWithRetries("/commit-notify", {
      logIndex: entry.index,
      stroke: entry.stroke,
    });

    if (!delivered) {
      this.logger.log("NODE_UNREACHABLE", "Could not reach gateway - skipping commit notification");
    }
  }

  private async postGatewayWithRetries(path: string, payload: unknown): Promise<boolean> {
    for (let attempt = 1; attempt <= this.config.gatewayNotifyMaxAttempts; attempt += 1) {
      try {
        await axios.post(`${this.config.gatewayUrl}${path}`, payload, {
          timeout: this.config.gatewayNotifyTimeoutMs,
        });
        return true;
      } catch {
        if (attempt === this.config.gatewayNotifyMaxAttempts) {
          return false;
        }

        await new Promise<void>((resolve) => {
          setTimeout(resolve, this.config.gatewayNotifyRetryDelayMs * attempt);
        });
      }
    }

    return false;
  }
}
