#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

sh deploy/preflight.sh
domain=$(awk -F= '$1 == "DOMAIN" { sub(/^[^=]*=/, ""); value=$0 } END { print value }' .env | tr -d '\r')

docker compose build --pull
docker compose up -d --remove-orphans

attempt=0
until curl --fail --silent --show-error --max-time 10 "https://$domain/api/v1/health" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Deployment started but the public health check did not pass." >&2
    docker compose ps >&2
    docker compose logs --tail=120 api web caddy >&2
    exit 1
  fi
  sleep 2
done

docker compose ps
echo "NAU AI is healthy at https://$domain."
echo "On a new database, configure and test the model at /admin/api-pool before enabling chat."
