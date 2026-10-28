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
