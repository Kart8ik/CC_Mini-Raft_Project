FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY packages/shared/src ./packages/shared/src
COPY services/replica1/package.json ./services/replica1/package.json
COPY services/replica1/tsconfig.json ./services/replica1/tsconfig.json
COPY services/replica1/src ./services/replica1/src

RUN npm install
EXPOSE 4001 4002 4003
CMD ["npm", "run", "dev", "-w", "@mini-raft/replica1"]
