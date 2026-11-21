#!/usr/bin/env bash
set -e

echo "============================================================================"
echo "  SHPL - Saptari Hospital Pvt Ltd Clinical ERP (Linux Node.js Launcher)"
echo "  Designed & Developed by Dr. Santosh Majhi"
echo "============================================================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js v18+ is not installed. Please install Node.js LTS first."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "[ERROR] Node.js v18+ required. Current version: $(node -v)"
  exit 1
fi

mkdir -p ./data

# Install lightweight production runtime dependencies only (express, compression, dotenv)
if [ ! -d "node_modules/express" ] || [ ! -d "node_modules/compression" ]; then
  echo "[1/3] Installing Node.js production runtime dependencies..."
  npm install --omit=dev
fi

# Build only if pre-built dist/ or dist-server/ bundle is missing
if [ ! -f "dist/index.html" ] || [ ! -f "dist-server/server.js" ]; then
  echo "[2/3] Pre-built bundle missing — installing build tools and compiling..."
  npm install
  npm run build
else
  echo "[2/3] Pre-built dist/ and dist-server/server.js detected — skipping heavy build."
fi

export NODE_ENV=production
export PORT="${PORT:-3000}"

echo "[3/3] Starting Hospital Management System on port ${PORT}..."
exec node dist-server/server.js
