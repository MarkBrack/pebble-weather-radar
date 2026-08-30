FROM node:22-bookworm-slim

WORKDIR /app
RUN apt-get update && \
    apt-get install -y --no-install-recommends fonts-dejavu-core && \
    rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

ENV NODE_ENV=production \
    PORT=8080 \
    CACHE_DIR=/data/cache

RUN mkdir -p /data/cache && chown -R node:node /data
USER node

EXPOSE 8080
VOLUME ["/data/cache"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "src/server.js"]
