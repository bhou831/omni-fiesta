# Deployment and recovery preparation

This is a single-instance application: do not run multiple writers against the same SQLite database. Check the actual server configuration before applying these instructions.

For Lightsail, install a supported Node 22 release, build the application, create a dedicated `omni-fiesta` service user and persistent `/var/lib/omni-fiesta` directory, and adapt `deploy/omni-fiesta.service` to the actual installation and Node paths. Put `HOST_PASSWORD` and `COINGECKO_API_KEY` in a private `/etc/omni-fiesta.env` readable only by the service and administrator; never commit it. The production Node listener binds to loopback; configure `PUBLIC_ORIGIN`, HTTPS, firewall and DNS for the real host, then use `deploy/Caddyfile` as the starting reverse proxy configuration. Verify Caddy's HTTPS and WebSocket proxying and service startup before inviting players. Set `ENABLE_REHEARSAL=false` in production. Verify CoinGecko API access and freshness for all configured IDs before the event.

## Operator shortcuts

After the server, SSH access and service are configured, set these variables locally (do not put the private key or credentials in the repository):

```sh
export DEPLOY_SSH_KEY="$HOME/.ssh/lightsail-key.pem"
export DEPLOY_HOST="ubuntu@18.214.189.202"
export DEPLOY_ORIGIN="https://game.bowen-hou.com"
just deploy-ssh       # interactive administration
just deploy-status    # systemd status
just deploy-logs      # follow service logs; Ctrl-C to stop
just deploy-health    # public HTTPS health endpoint
just deploy-restart   # restart the service; requires server sudo
```

Replace the example key path, host and origin with your actual configuration. These remote operator shortcuts do not install or update the application.

To deploy a tested, pushed commit, SSH to the server and run in `~/omni-fiesta`:

```sh
just pull
just deploy
```

Install `just` on the server first. `pull` uses `~/.ssh/omni-fiesta-deploy` for GitHub and requires a fast-forward of `master`. `deploy` requires a clean checkout, Node/npm, curl and sudo; it installs dependencies, builds, stages runtime files, stops the service, backs up `/var/lib/omni-fiesta/party.sqlite`, replaces `/opt/omni-fiesta`, and checks the local health endpoint. It records the commit in `/opt/omni-fiesta/REVISION` and retains the previous application directory. It assumes the documented database path and service layout; it does not change the systemd unit or Caddy configuration. Backups and old releases consume disk space; manage retention securely and copy backups off the instance. Database migrations are not automatically rolled back; check schema compatibility before restoring an older release. If startup fails, inspect the logs and backup before recovering.

Run `just check` locally and push the intended commit before deploying. A health response only confirms the endpoint responds; it does not validate games, WebSockets, or market access. Restarting interrupts connected players; choose a suitable maintenance window. The deployment script has not yet been verified on Lightsail.

## Consistent backups and restore

Create a point-in-time SQLite backup, including committed WAL state, using Node's SQLite `VACUUM INTO` operation:

```sh
node scripts/backup.mjs /var/lib/omni-fiesta/party.sqlite /secure-backups/party-2026-10-28.sqlite
```

The destination must not exist. Restrict access to the backup: it contains guest contact information and session data. Copy the completed backup to appropriately private, encrypted durable storage, such as a configured S3 bucket, using an independently reviewed retention policy. Do not copy only the live main database file while the application is writing.

For restore, stop the service and preserve the current database and its `-wal`/`-shm` files as a set. Place a verified backup at the configured database path with the correct ownership and permissions, ensure no stale WAL/SHM files are paired with it, and restart the service. Verify the room, sessions, balances, current phase and deadlines before proceeding. Restore to a disposable location first when rehearsing this procedure. A local `VACUUM INTO` backup and read-back of a disposable database were smoke-tested; complete party restore and cloud backup remain unverified.
