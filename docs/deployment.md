# Deployment and recovery preparation

These are preparation notes, not a claim that any AWS resource, DNS record or service exists. Provisioning, DNS changes and public deployment require a separate task. This is a single-instance application: do not run multiple writers against the same SQLite database.

For a future Lightsail deployment, install a supported Node 22 release, build the application, create a dedicated `omni-fiesta` service user and persistent `/var/lib/omni-fiesta` directory, and adapt `deploy/omni-fiesta.service` to the actual installation and Node paths. Put `HOST_PASSWORD` and `COINGECKO_API_KEY` in a private `/etc/omni-fiesta.env` readable only by the service and administrator; never commit it. The production Node listener binds to loopback; configure `PUBLIC_ORIGIN`, HTTPS, firewall and DNS for the real host, then use `deploy/Caddyfile` as the starting reverse proxy configuration. Verify Caddy's HTTPS and WebSocket proxying and service startup before inviting players. Set `ENABLE_REHEARSAL=false` in production. Verify CoinGecko API access and freshness for all configured IDs before the event.

## Operator shortcuts

After the server, SSH access and service are configured, set these variables locally (do not put the private key or credentials in the repository):

```sh
export DEPLOY_SSH_KEY="$HOME/.ssh/lightsail-key.pem"
export DEPLOY_HOST="ubuntu@100.58.241.182"
export DEPLOY_ORIGIN="https://game.bowen-hou.com"
just deploy-ssh       # interactive administration
just deploy-status    # systemd status
just deploy-logs      # follow service logs; Ctrl-C to stop
just deploy-health    # public HTTPS health endpoint
just deploy-restart   # restart the service; requires server sudo
```

Replace the example key path, host and origin with your actual configuration. The shortcuts do not install, upload, or update the application. Run `just check` locally, push the intended commit, and follow the server setup and release procedure before restarting. A health response only confirms the endpoint responds; it does not validate games, WebSockets, or market access. Restarting interrupts connected players; choose a suitable maintenance window.

## Consistent backups and restore

Create a point-in-time SQLite backup, including committed WAL state, using Node's SQLite `VACUUM INTO` operation:

```sh
node scripts/backup.mjs /var/lib/omni-fiesta/party.sqlite /secure-backups/party-2026-10-28.sqlite
```

The destination must not exist. Restrict access to the backup: it contains guest contact information and session data. Copy the completed backup to appropriately private, encrypted durable storage, such as a configured S3 bucket, using an independently reviewed retention policy. Do not copy only the live main database file while the application is writing.

For restore, stop the service and preserve the current database and its `-wal`/`-shm` files as a set. Place a verified backup at the configured database path with the correct ownership and permissions, ensure no stale WAL/SHM files are paired with it, and restart the service. Verify the room, sessions, balances, current phase and deadlines before proceeding. Restore to a disposable location first when rehearsing this procedure. A local `VACUUM INTO` backup and read-back of a disposable database were smoke-tested; complete party restore and cloud backup remain unverified.
