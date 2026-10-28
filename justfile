set positional-arguments := true

# List available shortcuts.
default:
    @just --list

# Install dependencies and create .env if needed.
setup:
    npm ci
    npm run setup

# Start the development server.
dev:
    npm run dev

kill:
    kill -9 $(lsof -t -i:3000)

# Preview any game directly with disposable sample players/prices (port 3001).
preview game="all":
    node --import tsx scripts/preview.ts "$1"

# Format the source files.
format:
    npm run format

# Check TypeScript types.
typecheck:
    npm run typecheck

# Run the automated tests.
test:
    npm test

# Check formatting, run tests, type-check, and build.
check:
    npm run format:check
    npm test
    npm run build

# Build the application.
build:
    npm run build

# Start the built application with the configured environment.
start:
    npm start

# Simulate players against a running development server (default: 15).
simulate players="15":
    npm run simulate -- "$1"

# Check all five live market quotes without exposing the configured API key.
market-check:
    node --env-file-if-exists=.env --import tsx scripts/check-market.ts

# Connect to the configured Lightsail instance (set DEPLOY_SSH_KEY and DEPLOY_HOST).
deploy-ssh:
    ssh -i "${DEPLOY_SSH_KEY:?Set DEPLOY_SSH_KEY to your private key path}" "${DEPLOY_HOST:?Set DEPLOY_HOST to user@host}"

# Inspect the production service without changing it.
deploy-status:
    ssh -i "${DEPLOY_SSH_KEY:?Set DEPLOY_SSH_KEY to your private key path}" "${DEPLOY_HOST:?Set DEPLOY_HOST to user@host}" 'systemctl status omni-fiesta --no-pager'

# Follow production application logs; Ctrl-C stops viewing them.
deploy-logs:
    ssh -i "${DEPLOY_SSH_KEY:?Set DEPLOY_SSH_KEY to your private key path}" "${DEPLOY_HOST:?Set DEPLOY_HOST to user@host}" 'journalctl -u omni-fiesta -f'

# Restart the configured production service (requires sudo on the server).
deploy-restart:
    ssh -t -i "${DEPLOY_SSH_KEY:?Set DEPLOY_SSH_KEY to your private key path}" "${DEPLOY_HOST:?Set DEPLOY_HOST to user@host}" 'sudo systemctl restart omni-fiesta && systemctl status omni-fiesta --no-pager'

# Check the public HTTPS health endpoint (set DEPLOY_ORIGIN).
deploy-health:
    curl --fail --silent --show-error "${DEPLOY_ORIGIN:?Set DEPLOY_ORIGIN to the HTTPS origin}/api/health"
