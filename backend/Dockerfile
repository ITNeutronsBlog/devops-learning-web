# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Runtime stage
FROM node:20-alpine
WORKDIR /app

# Install FFmpeg, python3, and yt-dlp
RUN apk add --no-cache ffmpeg python3 py3-pip curl \
    && pip3 install --break-system-packages yt-dlp \
    && addgroup -S appgroup && adduser -S appuser -G appgroup \
    && mkdir -p /data/videos/uploads /data/videos/streams /data/videos/thumbnails \
    && chown -R appuser:appgroup /data

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY backend/package*.json ./
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
