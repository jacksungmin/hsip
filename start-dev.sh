#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

print_node_install_help() {
  cat >&2 <<'EOF'
For Ubuntu/WSL, install Node.js and npm with:
  sudo apt-get update && sudo apt-get install -y curl && curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs

Then run this script again.
EOF
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to run this project." >&2
  print_node_install_help
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to run this project." >&2
  print_node_install_help
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  if [ -f "package-lock.json" ]; then
    npm ci
  else
    npm install
  fi
fi

echo "Starting development server..."
exec npm run dev -- "$@"
