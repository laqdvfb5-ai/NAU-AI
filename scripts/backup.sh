#!/bin/sh
set -eu
# Run from the project directory. Backups contain sensitive data: protect and encrypt off-site copies.
mkdir -p backups
chmod 700 backups
target="backups/nau-ai-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T postgres pg_dump -U nau -d nau_ai -Fc > "$target"
chmod 600 "$target"
test -s "$target"
echo "PostgreSQL backup created: $target"
