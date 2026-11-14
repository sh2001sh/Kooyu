# Kodo HTTPS gateway

Target: `codego-new-db` (`159.195.115.151`), `/opt/kodo-edge`.
Public hostname: `relay.kooyu.app`.

This is the HTTPS edge for the working Kooyu Relay. The site configuration
proxies to `127.0.0.1:4321`; deploy the application using
[`../kodo-relay/README.md`](../kodo-relay/README.md). The earlier gateway-only
placeholder has been replaced. `/healthz` now reports the Relay's health.

## Deployment

1. Copy this directory to `/opt/kodo-edge` without copying any local credentials.
2. Pull the official `caddy:2-alpine` image, inspect its repository digest, and
   write `CADDY_IMAGE=caddy@sha256:...` to a server-local `.env`. Keep this digest
   fixed until an explicit upgrade. No Cloudflare token is needed for DNS-only
   HTTP/TLS certificate issuance.
3. `docker compose config --quiet`
4. `docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`
5. `python3 provision-firewall.py`
6. `docker compose up -d`
7. Deploy the Relay, then verify HTTPS with normal certificate verification,
   HTTP redirect, application health and isolated pairing from another machine.

The firewall helper only adds TCP 80/443, saves the previous persistent
configuration under `/root/kodo-deployment-backups`, and validates the new
configuration. It never reloads or flushes the running firewall.

Host networking lets the server input firewall control inbound traffic. Only
Caddy uses host networking. Its management API is loopback-only. Relay
containers must listen through a loopback-only published port or an isolated
container network; do not expose database or Relay management ports publicly.
HTTP/3 is disabled; only TCP 80 and 443 are required.

Certificate/account state persists in the Compose `caddy_data` volume. Do not
delete this volume on updates. Runtime logs rotate and request access logs are
not enabled. Treat logs as potentially sensitive diagnostic data nonetheless.

## Updating sites

Add a separate `sites/*.caddy` file for the future website. Validate first, then
reload Caddy with:

```sh
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

The Relay upstream is already configured. Keep mobile authentication isolated
from local desktop privileges. Pairing, revocation and streamed-response
verification are documented in `docs/mobile-relay.md`.

## Rollback

`docker compose down` stops this gateway, retaining certificate volumes. To
close the ports, find only the `kodo-edge-https` rule with `nft -a list chain
inet codego_filter input`, delete that rule by handle, and remove the matching
line from `/etc/nftables.conf`. Do not restore the entire old firewall over
subsequent unrelated changes and do not run a command that flushes all rules.

## Initial gateway verification — 2026-11-13 (historical)

- DNS A record, confirmed from the server and Cloudflare DNS-over-HTTPS:
  `relay.kooyu.app` → `159.195.115.151`. The development machine's system DNS
  returns a local proxy/fake-IP address, so external checks explicitly used
  the actual origin IP with the correct hostname and certificate validation.
- Deployed to `/opt/kodo-edge`, Compose project `kodo-edge`.
- Image pinned to
  `caddy@sha256:78bd35025c7ba85961dd149ae670315129954e77abe2383ac47c89106b35ade9`.
- Compose configuration and Caddy validation passed.
- Let's Encrypt certificate issuance succeeded; HTTPS checks on the server
  and the development machine passed without disabling certificate checks.
- `GET /healthz` → 200 with `relay: not_deployed`.
- `GET /api/pairing` → intentional 503 `RELAY_NOT_DEPLOYED`.
- HTTP → HTTPS redirect verified with status 308.
- Public listeners: TCP 80/443; Caddy admin listens on `127.0.0.1:2019`.
- Existing SSH, VPN and database firewall rules retained; only the named
  TCP 80/443 rule was added and persisted. The machine was not rebooted.

The gateway-only health/503 results above describe the initial deployment.
The same day's Relay deployment supersedes them: `/healthz` now returns
`service: kooyu-relay` and `status: ok`; Host outbound WSS, device routing,
pairing, authorization and browser/PWA integration are implemented. See the
Relay deployment instructions and `docs/mobile-relay.md` for current evidence
and remaining real-phone acceptance work.
