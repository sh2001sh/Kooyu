# Kooyu Relay deployment

Server: `ssh codego-new-db`; runtime: `/opt/kooyu-relay`.
Public origin: `https://relay.kooyu.app`.
Edge: existing `/opt/kodo-edge` Caddy deployment, with automatic certificate renewal.

Verified release on 2026-11-13: `kooyu-relay:20261113-2`, source directory
`/opt/kooyu-relay/releases/20261113-2`. Previous image `kooyu-relay:20261113-1`
is retained. Public health and live Host reconnect with the same paired device
were verified after replacement.

On 2026-11-19 the Caddy site gained gzip for JSON responses only. SSE remains
uncompressed; public authenticated JSON decoding and SSE heartbeat were verified.
Keep this match restriction when editing the proxy. Performance findings and
the pre-change backup path are recorded in `docs/mobile-connection-performance-2026-11-19.md`.

## Build a release

1. From the repository root, run `npm ci`, `npm run build`, `npm test`, and `npm run test:relay`.
2. Create a fresh staging directory containing the Relay `Dockerfile`, `package.json`, `package-lock.json`, `src/` from `services/relay`, and the contents of `apps/web/dist/` under `web/`. Never copy local credentials, `.local/`, or desktop data.
3. Upload the staged directory to `/opt/kooyu-relay/releases/<release>`.
4. On the server: `docker build -t kooyu-relay:<release> /opt/kooyu-relay/releases/<release>`.
5. Put this directory's `compose.yaml` in `/opt/kooyu-relay`, and set `RELAY_IMAGE=kooyu-relay:<release>` in its server-local `.env`.
6. Run `docker compose config --quiet` and `docker compose up -d --wait` from `/opt/kooyu-relay`.

Use immutable release tags and retain the previous image. Runtime dependencies are locked in `package-lock.json`. The Docker base is Node 24.13.0 Alpine; reviewed base updates should be rebuilt and tested explicitly.

For the first installation, copy `relay.caddy` to `/opt/kodo-edge/sites/relay.caddy`, validate Caddy, then reload it. Do not recreate the Caddy data volume: it holds certificates and ACME state. Do not change unrelated database/VPN firewall rules. Relay publishes only `127.0.0.1:4321`; leave that port closed to the Internet. TLS terminates at Caddy, whose upstream is on the same server. Only this trusted loopback proxy supplies forwarded client addresses.

## Verify

Run `docker compose ps`, `curl --fail https://relay.kooyu.app/healthz`, and `docker compose logs --tail 30 relay` from `/opt/kooyu-relay`.

Expected health response: `{"service":"kooyu-relay","status":"ok","version":1}`. This checks the Relay process, not an individual desktop's reachability. Use an isolated Host to test public pairing, bearer/cookie authentication, SSE heartbeat and revocation; see `docs/mobile-relay.md`.

The development machine may use fake-IP DNS. For an origin-only connectivity check retaining certificate verification: `curl --noproxy '*' --resolve relay.kooyu.app:443:159.195.115.151 https://relay.kooyu.app/healthz`. Also test the normal DNS/client route. Never use `-k` to hide a certificate problem.

## Update and rollback

Replacing this single container briefly interrupts connected Hosts. They automatically reconnect; clients reload state and never automatically replay writes. Publish compatible Host, web and protocol changes together. Keep the previous server release directory and image.

Rollback by setting `.env` back to the previous `RELAY_IMAGE`, then running `docker compose up -d --wait` and checking health. Rolling back the Relay does not roll back the desktop binary. No cloud database migration is needed for this stateless service.

## Operations and boundaries

The Relay has no persistent message store and no request-body/access logging. Rotated container logs remain potentially sensitive; do not add token, pairing-code, header or payload logging. Keep the host patched, limit SSH access and preserve existing firewall isolation. Caddy maintains certificate state separately.

This is TLS transport, **not end-to-end encryption**: the Relay operator can read forwarded plaintext and credentials. It is a single-node deployment with bounded buffers and rate limits, not an HA service. A later website can share this server using a separate Caddy site and separate process/container; reserve resources so the website cannot exhaust the Relay.
