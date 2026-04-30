# ── Intent Graph Dockerfile ──────────────────────────────────────────────────────
# Multi-stage build for rez-intent-graph API server
# Supports horizontal scaling (multiple replicas)

FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies only when needed
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --only=production && npm cache clean --force

# Rebuild native modules
FROM base AS builder
COPY package.json package-lock.json* ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 intentgraph

# Copy built application
COPY --from=deps --chown=intentgraph:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=intentgraph:nodejs /app/dist ./dist
COPY --from=builder --chown=intentgraph:nodejs /app/package.json ./

USER intentgraph

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start server
CMD ["node", "dist/server/server.js"]
