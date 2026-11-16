FROM node:24.13.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/kooyu
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/kooyu/browsers
COPY . .
RUN npm ci --ignore-scripts && npm run build:core && npm run build -w @kodo/web && npx playwright install --with-deps chromium
ENV NODE_ENV=production KODO_DATA_DIR=/var/lib/kooyu HOME=/var/lib/kooyu KOOYU_CREDENTIAL_BACKEND=file
RUN mkdir -p /var/lib/kooyu /srv/workspaces && chown -R node:node /var/lib/kooyu /srv/workspaces /opt/kooyu
USER node
CMD ["node", "packages/host/dist/main.js"]
