export const LOG_EVENT_TYPES = [
  "STARTUP",
  "ELECTION_START",
  "ELECTION_WIN",
  "ELECTION_LOSS",
  "VOTE_SENT",
  "VOTE_REJECTED",
  "VOTE_RECEIVED",
  "HEARTBEAT_SENT",
  "HEARTBEAT_RECEIVED",
  "APPEND_RECEIVED",
  "APPEND_ACK",
  "COMMIT",
  "SYNC_START",
  "SYNC_CHUNK",
  "SYNC_CHUNK_RECV",
  "SYNC_CHUNK_ACK",
  "SYNC_RETRY",
  "SYNC_COMPLETE",
  "SYNC_INCOMPLETE",
  "LEADER_CHANGE",
  "CLIENT_CONNECT",
  "CLIENT_DISCONNECT",
  "STROKE_FORWARDED",
  "BROADCAST",
  "NODE_UNREACHABLE",
] as const;

export type EventType = (typeof LOG_EVENT_TYPES)[number];

export interface LogEvent {
  replicaId: string;
  timestamp: string;
  event: EventType;
  message: string;
}

export interface StructuredLogger {
  log(event: EventType, message: string): void;
  getRecentEvents(n?: number): LogEvent[];
}

const MAX_BUFFER_SIZE = 100;
const DEFAULT_RECENT = 50;

export function createLogger(replicaId: string): StructuredLogger {
  const buffer: LogEvent[] = [];

  return {
    log(event: EventType, message: string): void {
      const timestamp = new Date().toISOString();
      const entry: LogEvent = {
        replicaId,
        timestamp,
        event,
        message,
      };

      process.stdout.write(`[${replicaId}] [${timestamp}] [${event}] ${message}\n`);
      buffer.push(entry);
      if (buffer.length > MAX_BUFFER_SIZE) {
        buffer.shift();
      }
    },

    getRecentEvents(n = DEFAULT_RECENT): LogEvent[] {
      const limit = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : DEFAULT_RECENT;
      if (limit === 0) {
        return [];
      }
      return buffer.slice(-limit);
    },
  };
}
