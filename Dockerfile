FROM node:22-alpine

WORKDIR /app

# 先拷依赖清单，利用 Docker 层缓存
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund 2>/dev/null || npm install --omit=dev --no-audit --no-fund

COPY server ./server
COPY public ./public
COPY samples ./samples

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/app/data

VOLUME ["/app/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1

CMD ["node", "server/index.js"]
