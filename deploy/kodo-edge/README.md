# Kooyu HTTPS Edge Gateway (Caddy)

Generic self-hosted HTTPS reverse proxy template for Kooyu Relay. The site
configuration proxies inbound HTTPS traffic to a loopback-only Relay container
listening on `127.0.0.1:4321`; see [`../kodo-relay/README.md`](../kodo-relay/README.md)
for the Relay application setup.

## Deployment

1. Copy this directory to your server (for example `/opt/kooyu-edge`) without copying any local credentials.
2. Edit `sites/relay.caddy` and replace `relay.example.com` with your own Relay hostname, then point its DNS A/AAAA record to your server.
3. Pull an official `caddy:2-alpine` image, inspect its digest, and write `CADDY_IMAGE=caddy@sha256:...` into a server-local `.env` file.
4. Validate Compose and Caddy configuration:
   ```sh
   docker compose config --quiet
   docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   ```
5. Allow inbound TCP `80` and `443` in your host firewall while keeping `127.0.0.1:4321` and Caddy's admin endpoint (`127.0.0.1:2019`) closed to the public Internet.
6. Start Caddy:
   ```sh
   docker compose up -d
   ```
7. Deploy the Relay container, then verify HTTPS, HTTP → HTTPS redirection, and `/healthz` with normal TLS certificate verification.

## Security Notes

- Only Caddy uses host networking so your host firewall governs inbound traffic directly.
- Caddy's admin API listens on `127.0.0.1:2019` only; never expose it publicly.
- HTTP/3 is disabled by default; only TCP `80` and `443` are required.
- Certificate and ACME account state persist in the Compose `caddy_data` volume. Do not delete this volume during upgrades.
- Access logs are disabled by default; still treat runtime logs as sensitive diagnostic data.

## Updating Sites

Add or edit files under `sites/*.caddy`, validate first, then reload Caddy without downtime:

```sh
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

## Rollback

Run `docker compose down` to stop the gateway while preserving certificate volumes, and close TCP `80`/`443` in your firewall if no longer needed.
