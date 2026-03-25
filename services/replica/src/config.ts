import { parseReplicaMap } from "@mini-raft/shared";

export interface ReplicaConfig {
  replicaId: string;
  port: number;
  peers: Record<string, string>;
  gatewayUrl: string;
  gatewayNotifyTimeoutMs: number;
  gatewayNotifyMaxAttempts: number;
  gatewayNotifyRetryDelayMs: number;
  electionTimeoutMinMs: number;
  electionTimeoutMaxMs: number;
  heartbeatIntervalMs: number;
  heartbeatLogIntervalMs: number;
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
    gatewayNotifyTimeoutMs: Number(process.env.GATEWAY_NOTIFY_TIMEOUT_MS || "1000"),
    gatewayNotifyMaxAttempts: Math.max(1, Number(process.env.GATEWAY_NOTIFY_MAX_ATTEMPTS || "10")),
    gatewayNotifyRetryDelayMs: Math.max(0, Number(process.env.GATEWAY_NOTIFY_RETRY_DELAY_MS || "500")),
    electionTimeoutMinMs: Number(process.env.ELECTION_TIMEOUT_MIN_MS || "500"),
    electionTimeoutMaxMs: Number(process.env.ELECTION_TIMEOUT_MAX_MS || "800"),
    heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS || "150"),
    heartbeatLogIntervalMs: Number(process.env.HEARTBEAT_LOG_INTERVAL_MS || "4000"),
  };
}
