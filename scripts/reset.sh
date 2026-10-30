#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" != "--force" ]]; then
  echo "This removes all users and their activity while keeping the running service and market data."
  read -r -p 'Type RESET to continue: ' confirmation
  [[ "$confirmation" == "RESET" ]] || { echo "Reset cancelled."; exit 1; }
fi

cd "$project_dir"
if [[ -z "$(docker compose ps -q trading1337)" ]]; then
  echo "Trading 1337 must be running before resetting its database." >&2
  exit 1
fi

docker compose exec -T trading1337 node src/seed.js --reset
