# Node + headless Chromium (Puppeteer) service for Cloud Run / Fly / any container host.
FROM node:20-slim

# Chromium runtime libraries (Puppeteer downloads Chrome, but needs these to run it).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation fonts-noto-color-emoji \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 libdbus-1-3 \
    libdrm2 libexpat1 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 \
    libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 \
    libxfixes3 libxkbcommon0 libxrandr2 wget \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
# Cloud Run's only writable path is /tmp — the converter writes output there.
ENV OUTPUT_DIR=/tmp/output

# Install deps (incl. optional puppeteer). postinstall downloads Chrome into PUPPETEER_CACHE_DIR.
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server ./server
COPY scripts ./scripts

# Cloud Run injects PORT (8080); server reads process.env.PORT.
EXPOSE 8080
CMD ["node", "server/index.js"]
