# Deploying Leaf

Target: the Hetzner box, reached through the `estiva-prod` Cloudflare Tunnel.
Public URL `https://leaf.estiva.app`. The same shape as Ship's
(`estiva-app/ship/deploy/README.md`), which says why at more length.

```
push to main → CI: check, gate → build bundle → image → ghcr.io/estiva-app/leaf:main
                                                                ↓
                          systemd timer on the box, every 2 min → update.sh
                                                                ↓
                                              pull → restart → health check
```

CI never connects to the box and must never be given a key that would let it:
the firewall allows SSH from one address, and a deploy key in GitHub would be a
standing credential for an access path that is deliberately closed.

`gh workflow run deploy.yml -R estiva-app/leaf --ref main` publishes `main` as
it stands, for when GitHub drops a push event (it has, on Peek).

## What the bundle is built with

`publish` in `.github/workflows/deploy.yml` bakes in:

| | |
| -- | -- |
| `VITE_ESTIVA_ID_ORIGIN` | `https://id.estiva.app` |
| `VITE_ESTIVA_ID_CLIENT_ID` | `estiva-leaf`, which must match a `client_id` seeded in Estiva ID |
| `VITE_RELAY_URL` | `https://estiva.estiva.app` |

## Outside this repo, and none of it fails loudly

- **Estiva ID** seeds `estiva-leaf` (`src/db/seed.ts`), with its redirect
  addresses read from `LEAF_REDIRECT_URIS` in `/opt/estiva-id/.env`, matched
  exactly: `https://leaf.estiva.app/,http://localhost:5173/`. After a change,
  re-run the seed once the new image is running:
  `docker exec estiva-id-estiva-id-1 node dist/db/seed.js`. Missing, and sign-in
  answers "Unknown or disabled app".
- **Every kind Leaf signs** must be in that entry's `allowedKinds` as well as in
  `KINDS`, or saving fails at the very last step.
- **The relay's CORS list**, `BUZZ_CORS_ORIGINS` in `/opt/buzz/.env`, must name
  `https://leaf.estiva.app`, followed by `cd /opt/buzz && ./run.sh restart`.
  Missing, and the app loads and then fails every request. `http://localhost:5173`
  is already there.
- **The tunnel route**: one.dash.cloudflare.com → Networks → Tunnels →
  estiva-prod → Published application routes: subdomain `leaf`, domain
  `estiva.app`, no path, type `HTTP`, URL `localhost:8084`. No Host header.
- **The image must be pullable without credentials**: GitHub → estiva-app →
  Packages → `leaf` → Package settings → Change visibility → Public. A new
  package is private by default.

## First deploy on the box

```bash
ssh root@167.233.252.136 'mkdir -p /opt/estiva-leaf'
scp deploy/docker-compose.yml deploy/update.sh \
    deploy/estiva-leaf-update.service deploy/estiva-leaf-update.timer \
    root@167.233.252.136:/opt/estiva-leaf/
ssh root@167.233.252.136 'chmod +x /opt/estiva-leaf/update.sh && cd /opt/estiva-leaf && docker compose pull && docker compose up -d'
ssh root@167.233.252.136 'cp /opt/estiva-leaf/estiva-leaf-update.* /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now estiva-leaf-update.timer'
```

Then `curl -I https://leaf.estiva.app/`. If it is a 404 and
`docker logs estiva-leaf-estiva-leaf-1` shows only the healthcheck's `Wget`, the
tunnel never routed there: a Cloudflare problem, not an nginx one.

## Operating it

- **Watch a deploy:** `journalctl -u estiva-leaf-update -f`
- **Deploy now:** `systemctl start estiva-leaf-update`
- **Roll back:** every build is also tagged with its commit sha. Stop the timer
  first, or it pulls `main` over the rollback within two minutes:

  ```bash
  systemctl stop estiva-leaf-update.timer
  ESTIVA_LEAF_IMAGE=ghcr.io/estiva-app/leaf:<sha> docker compose up -d --force-recreate
  ```
