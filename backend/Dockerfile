# ——— Build stage ———
FROM node:20-alpine AS builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev

# ——— Production stage ———
FROM node:20-alpine
WORKDIR /app

# Install yt-dlp, ffmpeg (for yt-dlp merge), and curl (for health check)
RUN apk add --no-cache curl python3 ffmpeg \
  && wget -qO /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY backend/package*.json ./

# Copy source code
COPY backend/src ./src

# Copy frontend
COPY frontend /app/public

# Environment
ENV NODE_ENV=production
ENV PORT=3005
ENV DATA_DIR=/data/videos
ENV DB_PATH=/data/videos/database.sqlite
ENV FRONTEND_DIR=/app/public

EXPOSE 3005

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3005/api/health || exit 1

USER appuser

CMD ["node", "src/server.js"]
