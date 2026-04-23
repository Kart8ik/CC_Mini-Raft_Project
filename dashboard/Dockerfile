FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY packages/shared/src ./packages/shared/src
COPY dashboard/package.json ./dashboard/package.json
COPY dashboard/tsconfig.json ./dashboard/tsconfig.json
COPY dashboard/tsconfig.board.json ./dashboard/tsconfig.board.json
COPY dashboard/vite.config.ts ./dashboard/vite.config.ts
COPY dashboard/board.html ./dashboard/board.html
COPY dashboard/src ./dashboard/src
COPY dashboard/public ./dashboard/public

RUN npm install
RUN npm run build -w @mini-raft/dashboard

EXPOSE 3001
CMD ["sh", "-c", "npm run build:client -w @mini-raft/dashboard && npm run dev -w @mini-raft/dashboard"]
