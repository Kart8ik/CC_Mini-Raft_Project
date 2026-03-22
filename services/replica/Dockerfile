FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY packages/shared/src ./packages/shared/src
COPY services/replica/package.json ./services/replica/package.json
COPY services/replica/tsconfig.json ./services/replica/tsconfig.json
COPY services/replica/src ./services/replica/src

RUN npm install
EXPOSE 4001 4002 4003
CMD ["npm", "run", "dev", "-w", "@mini-raft/replica"]
