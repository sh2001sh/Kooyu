# Kooyu Relay Self-Hosted Deployment

This directory contains a generic Docker Compose and Caddy configuration for self-hosting Kooyu Relay (`services/relay`) behind HTTPS termination (for example [`../kodo-edge/`](../kodo-edge/)).

## Build and Deploy

1. From the repository root, run verification and build the Web bundle:
   ```sh
   npm ci
   npm run build
   npm test
   npm run test:relay
   ```
2. Create a fresh staging directory containing `services/relay/Dockerfile`, `services/relay/package.json`, `services/relay/package-lock.json`, `services/relay/src/`, and the built `apps/web/dist/` directory copied under `web/`. Never copy local credentials, `.local/`, or desktop data.
3. Build a versioned image on your server:
   ```sh
   docker build -t kooyu-relay:<release> /path/to/staged-release
   ```
4. Copy `compose.yaml` to your deployment directory and create a server-local `.env` file:
   ```dotenv
   RELAY_IMAGE=kooyu-relay:<release>
   RELAY_ORIGIN=https://relay.example.com
   ACCOUNT_ORIGIN=https://accounts.example.com
   # Local private control plane on the same Linux host
   ACCOUNT_CONTROL_ORIGIN=http://127.0.0.1:4381
   # Set the same independently generated secret in the account service
   RELAY_CONTROL_SECRET=<at-least-32-random-characters>
   # Optional: wildcard domain for isolated remote previews
   # RELAY_PREVIEW_DOMAIN=preview.example.com
   ```
5. Validate and start the service:
   ```sh
   docker compose config --quiet
   docker compose up -d --wait
   ```
6. Configure your HTTPS reverse proxy using `relay.caddy` (replacing `relay.example.com` with your hostname). Keep gzip restricted to `application/json*` so SSE streams remain uncompressed, and keep `127.0.0.1:4321` bound to loopback only.

## Verify

```sh
docker compose ps
curl --fail https://relay.example.com/healthz
docker compose logs --tail 30 relay
```

Expected health response: `{"service":"kooyu-relay","status":"ok","version":1}`. Always verify TLS certificates normally; never use `curl -k` to ignore certificate errors.

## Update and Rollback

- Replacing the container briefly interrupts connected Hosts. Hosts reconnect automatically; clients reload state and never auto-replay writes.
- Use immutable image tags and keep the previous image so rollback is simply restoring the previous `RELAY_IMAGE` in `.env` and running `docker compose up -d --wait`.
- Preserve the `relay-data` volume across updates and rollbacks. It persists `/var/lib/kooyu-relay/mailbox.sqlite` (device verification keys, short-lived encrypted mailbox envelopes, Web Push subscriptions, and the Relay VAPID keypair). Treat this volume as sensitive data.

## Protocol & Security Boundaries

- V1 and V2 Hosts can connect concurrently. Point self-hosted desktop Hosts to your server via `KODO_RELAY_ORIGIN=https://relay.example.com` and `KOOYU_RELAY_PROTOCOL=2`.
- The encrypted offline mailbox enforces Ed25519 device verification keys and accepts up to 32 envelopes per Host (max 32 KiB each, 12-hour TTL). Hosts revalidate paired devices before executing queued envelopes.
- Native Android, iOS, and Desktop v2 pairings pin the Host signing identity from the invitation URL and encrypt API traffic end-to-end. For Web/PWA clients loaded through the Relay, transport is encrypted by TLS and mailbox envelopes are encrypted, though the Relay serves the PWA static assets and should be operated as trusted infrastructure.
- For isolated remote previews, configure wildcard DNS and TLS for a dedicated domain separate from `RELAY_ORIGIN`, preserve the `Host` header when proxying to the Relay, and set `RELAY_PREVIEW_DOMAIN` in `.env`.
