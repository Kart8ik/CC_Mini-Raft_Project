import { parseReplicaMap } from "@mini-raft/shared";

export interface ReplicaConfig {
  replicaId: string;
  port: number;
  peers: Record<string, string>;
  gatewayUrl: string;
  electionTimeoutMinMs: number;
  electionTimeoutMaxMs: number;
  heartbeatIntervalMs: number;
}

export function loadConfig(): ReplicaConfig {
  const replicaId = process.env.REPLICA_ID || "replica1";
  const port = Number(process.env.PORT || "4001");
  const peers = parseReplicaMap(process.env.PEERS || "");
  const gatewayUrl = process.env.GATEWAY_URL || "http://localhost:3000";

  return {
    replicaId,
    port,
    peers,
    gatewayUrl,
    electionTimeoutMinMs: Number(process.env.ELECTION_TIMEOUT_MIN_MS || "500"),
    electionTimeoutMaxMs: Number(process.env.ELECTION_TIMEOUT_MAX_MS || "800"),
    heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS || "150"),
  };
}
