# Distributed Real-Time Drawing Board (Mini-RAFT)

This repository contains a monorepo implementation starter for:
- 1 Gateway service (WebSocket entry point)
- 3 Replica services (Mini-RAFT state machine)
- 1 Frontend canvas app

## Start

1. Install dependencies:

   npm install

2. Run with Docker Compose:

   docker compose up --build

3. Open the drawing UI:

   http://localhost:8080

## Services

- Gateway: http://localhost:3000
- Replica1: http://localhost:4001
- Replica2: http://localhost:4002
- Replica3: http://localhost:4003

## Useful endpoints

- Gateway health: GET /health
- Gateway state: GET /state
- Replica health: GET /health
- Replica log dump: GET /debug/log
