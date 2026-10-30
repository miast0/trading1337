#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
seed_file="${1:-seeds/init_seed.json}"

if [[ "$seed_file" = /* || "$seed_file" == *".."* || "$seed_file" != seeds/*.json || ! -f "$project_dir/$seed_file" ]]; then
  echo "Seed file must be a JSON file under seeds/: $seed_file" >&2
  exit 1
fi

cd "$project_dir"
if [[ -z "$(docker compose ps -q trading1337)" ]]; then
  echo "Trading 1337 must be running before applying a seed." >&2
  exit 1
fi

docker compose exec -T trading1337 node src/seed.js - < "$project_dir/$seed_file"
