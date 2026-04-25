#!/bin/bash
# Encuentra node (Linux o Windows/WSL) y ejecuta el CLI con todos los argumentos
NODE=$(which node 2>/dev/null)
if [ -z "$NODE" ]; then
  NODE="/mnt/c/Program Files/nodejs/node.exe"
fi
"$NODE" "$(dirname "$0")/cli.js" "$@"
