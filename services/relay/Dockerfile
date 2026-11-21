FROM node:24.13.0-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY src/main.mjs src/server.mjs src/account-gateway.mjs src/browser-account.mjs src/mailbox.mjs src/push.mjs ./src/
COPY web ./web
RUN mkdir -p /var/lib/kooyu-relay && chown node:node /var/lib/kooyu-relay
USER node
EXPOSE 4321
CMD ["node", "src/main.mjs"]
