# RelayOps app image. FalkorDB runs separately (compose, or FalkorDB Cloud).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/types.ts ./src/types.ts
COPY tsconfig.json ./
RUN mkdir -p .data
EXPOSE 4177
ENV HOST=0.0.0.0 PORT=4177 MEMORY_BACKEND=falkordb
CMD ["node", "--import", "tsx", "server/index.ts"]
