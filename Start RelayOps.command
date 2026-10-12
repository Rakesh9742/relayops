#!/bin/zsh -l
set -eu

cd "${0:A:h}"

if ! command -v npm >/dev/null 2>&1; then
  print "Node.js is required. Install Node.js 24, then run this launcher again."
  read "?Press Return to close."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  print "Installing RelayOps dependencies..."
  npm ci
fi

print "Building RelayOps..."
npm run build
print ""
print "When the server reports ready, open http://127.0.0.1:5177"
print "Keep this Terminal window open. Press Control-C to stop RelayOps."
print ""

# Serve the UI and API together without development file watchers.
HOST=127.0.0.1 PORT=5177 npm start
