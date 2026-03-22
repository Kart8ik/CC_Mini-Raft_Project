FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY packages/shared/src ./packages/shared/src
COPY services/gateway/package.json ./services/gateway/package.json
COPY services/gateway/tsconfig.json ./services/gateway/tsconfig.json
COPY services/gateway/src ./services/gateway/src

RUN npm install
EXPOSE 3000
CMD ["npm", "run", "dev", "-w", "@mini-raft/gateway"]
