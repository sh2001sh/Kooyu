FROM node:24.13.0-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY web ./web
USER node
EXPOSE 4321
CMD ["node", "src/main.mjs"]
