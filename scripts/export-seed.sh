#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
seed_name="${1:-}"
target="${2:-seeds/$seed_name.json}"

if [[ ! "$seed_name" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "Usage: ./scripts/export-seed.sh <lowercase-seed-name> [seeds/output.json]" >&2
  exit 1
fi
if [[ "$target" = /* || "$target" == *".."* || "$target" != seeds/*.json ]]; then
  echo "Output must be a JSON file under seeds/: $target" >&2
  exit 1
fi
if [[ -e "$project_dir/$target" ]]; then
  echo "Seed already exists: $project_dir/$target" >&2
  exit 1
fi

cd "$project_dir"
if [[ -z "$(docker compose ps -q trading1337)" ]]; then
  echo "Trading 1337 must be running before exporting its database." >&2
  exit 1
fi

temporary_file="$(mktemp "$project_dir/seeds/.export.XXXXXX")"
trap 'rm -f "$temporary_file"' EXIT
docker compose exec -T trading1337 node src/seed.js --export "$seed_name" > "$temporary_file"
mv "$temporary_file" "$project_dir/$target"
trap - EXIT
echo "Created $project_dir/$target"
