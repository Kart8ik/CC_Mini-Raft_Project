import axios from "axios";
import {
  AppendEntriesRequest,
  AppendEntriesResponse,
  HeartbeatRequest,
  LogEntry,
  NodeState,
  RequestVoteRequest,
  RequestVoteResponse,
  ReplicaStateSnapshot,
  Stroke,
} from "@mini-raft/shared";
import { ReplicaConfig } from "./config";

export class MiniRaftNode {
  private readonly config: ReplicaConfig;
  private state: NodeState = "follower";
  private currentTerm = 0;
  private votedFor: string | null = null;
  private log: LogEntry[] = [];
  private commitIndex = 0;
  private electionTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(config: ReplicaConfig) {
    this.config = config;
  }

  start(): void {
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

  getLog(): LogEntry[] {
    return this.log;
  }

  getCurrentTerm(): number {
    return this.currentTerm;
  }

  isLeader(): boolean {
    return this.state === "leader";
  }

  getLeaderHint(): string {
    return "unknown";
  }

  async onRequestVote(req: RequestVoteRequest): Promise<RequestVoteResponse> {
    if (req.term < this.currentTerm) {
      return { term: this.currentTerm, voteGranted: false };
    }

    if (req.term > this.currentTerm) {
      this.becomeFollower(req.term);
    }

    const alreadyVoted = this.votedFor && this.votedFor !== req.candidateId;
    if (alreadyVoted) {
      return { term: this.currentTerm, voteGranted: false };
    }

    this.votedFor = req.candidateId;
    this.resetElectionTimer();
    return { term: this.currentTerm, voteGranted: true };
  }

  async onHeartbeat(req: HeartbeatRequest): Promise<{ term: number; success: boolean }> {
    if (req.term < this.currentTerm) {
      return { term: this.currentTerm, success: false };
    }

    if (req.term >= this.currentTerm) {
      this.becomeFollower(req.term);
      this.resetElectionTimer();
    }

    return { term: this.currentTerm, success: true };
  }

  async onAppendEntries(req: AppendEntriesRequest): Promise<AppendEntriesResponse> {
    if (req.term < this.currentTerm) {
      return { term: this.currentTerm, success: false, logLength: this.log.length };
    }

    if (req.term >= this.currentTerm) {
      this.becomeFollower(req.term);
      this.resetElectionTimer();
    }

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

    return { term: this.currentTerm, success: true, logLength: this.log.length };
  }

  onSyncLog(fromIndex: number, entries: LogEntry[]): { success: boolean; newLogLength: number } {
    const start = Math.max(0, fromIndex);
    this.log = this.log.slice(0, start).concat(entries);
    this.commitIndex = this.log.length;
    this.resetElectionTimer();
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
      await this.notifyGatewayCommit(entry);
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

    let votes = 1;
    const peers = Object.entries(this.config.peers);
    const lastLogIndex = this.log.length;
    const lastLogTerm = this.log.length === 0 ? 0 : this.log[this.log.length - 1].term;

    const requests = peers.map(async ([, url]) => {
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

        if (response.data.term > this.currentTerm) {
          this.becomeFollower(response.data.term);
          return;
        }

        if (response.data.voteGranted) {
          votes += 1;
        }
      } catch {
        // Peer can be down during election.
      }
    });

    await Promise.all(requests);

    const quorum = Math.floor((peers.length + 1) / 2) + 1;
    if (this.state === "candidate" && votes >= quorum) {
      this.becomeLeader();
      return;
    }

    this.resetElectionTimer();
  }

  private becomeFollower(term: number): void {
    this.state = "follower";
    this.currentTerm = term;
    this.votedFor = null;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private becomeLeader(): void {
    this.state = "leader";
    this.votedFor = this.config.replicaId;

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

    const peers = Object.values(this.config.peers);
    await Promise.all(
      peers.map(async (url) => {
        try {
          const payload: HeartbeatRequest = {
            term: this.currentTerm,
            leaderId: this.config.replicaId,
          };
          const response = await axios.post(`${url}/heartbeat`, payload, { timeout: 500 });
          if (response.data?.term > this.currentTerm) {
            this.becomeFollower(response.data.term);
          }
        } catch {
          // Peer may be unavailable.
        }
      }),
    );
  }

  private async replicateEntry(entry: LogEntry): Promise<number> {
    const peers = Object.values(this.config.peers);
    let successCount = 1;

    await Promise.all(
      peers.map(async (url) => {
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
            this.becomeFollower(response.data.term);
            return;
          }

          if (response.data.success) {
            successCount += 1;
            return;
          }

          await this.syncFollower(url, response.data.logLength);
        } catch {
          // Peer may be unavailable.
        }
      }),
    );

    return successCount;
  }

  private async syncFollower(url: string, followerLength: number): Promise<void> {
    const start = Math.max(0, followerLength);
    const entries = this.log.slice(start);
    if (entries.length === 0) {
      return;
    }

    try {
      await axios.post(
        `${url}/sync-log`,
        {
          fromIndex: start,
          entries,
        },
        { timeout: 1000 },
      );
    } catch {
      // Retry will happen in next replication cycle.
    }
  }

  private async notifyGatewayLeaderChange(): Promise<void> {
    try {
      await axios.post(
        `${this.config.gatewayUrl}/leader-change`,
        {
          newLeaderId: this.config.replicaId,
          term: this.currentTerm,
        },
        { timeout: 600 },
      );
    } catch {
      // Gateway might not be up yet.
    }
  }

  private async notifyGatewayCommit(entry: LogEntry): Promise<void> {
    try {
      await axios.post(
        `${this.config.gatewayUrl}/commit-notify`,
        {
          logIndex: entry.index,
          stroke: entry.stroke,
        },
        { timeout: 600 },
      );
    } catch {
      // Gateway notification can be retried by future log replay endpoint.
    }
  }
}
