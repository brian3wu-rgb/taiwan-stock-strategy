# ── Stage 1: 依賴安裝 ─────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --frozen-lockfile 2>/dev/null || npm install


# ── Stage 2: 建置 ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 建置時注入後端 API URL（可被 docker-compose / Railway 覆蓋）
ARG NEXT_PUBLIC_API_URL=https://taiwan-stock-backend-utuw.onrender.com
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Docker 部署時啟用 standalone 模式
ENV DOCKER_BUILD=1

RUN npm run build


# ── Stage 3: 執行映像 ─────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

COPY --from=builder /app/public           ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
