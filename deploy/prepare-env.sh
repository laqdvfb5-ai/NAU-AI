#!/bin/sh
set -eu

# Create or complete the production .env without printing any secret.
# Usage: sh deploy/prepare-env.sh ai.example.edu.vn

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
umask 077

domain=${1:-}
case "$domain" in
  ''|*://*|*/*|*:*|*[!A-Za-z0-9.-]*|.*|*.)
    echo "Usage: sh deploy/prepare-env.sh <domain-without-https>" >&2
    exit 1
    ;;
esac
case "$domain" in
  *.*) ;;
  *)
    echo "DOMAIN must be a fully qualified host name." >&2
    exit 1
    ;;
esac
if printf '%s\n' "$domain" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
  echo "A raw IPv4 address cannot provide browser-trusted HTTPS. Use a domain name." >&2
  exit 1
fi

command -v openssl >/dev/null 2>&1 || {
  echo "openssl is required to generate deployment secrets." >&2
  exit 1
}

env_file=.env
if [ ! -f "$env_file" ]; then
  cp .env.example "$env_file"
fi

get_value() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); value=$0 } END { print value }' "$env_file" | tr -d '\r'
}

set_value() {
  key=$1
  value=$2
  temp=$(mktemp "${env_file}.tmp.XXXXXX")
  awk -v key="$key" -v value="$value" '
    BEGIN { written=0 }
    index($0, key "=") == 1 {
      if (!written) print key "=" value
      written=1
      next
    }
    { print }
    END { if (!written) print key "=" value }
  ' "$env_file" > "$temp"
  mv "$temp" "$env_file"
}

ensure_secret() {
  key=$1
  bytes=$2
  if [ -z "$(get_value "$key")" ]; then
    set_value "$key" "$(openssl rand -hex "$bytes")"
  fi
}

set_value DOMAIN "$domain"
set_value WEB_ORIGIN "https://$domain"
set_value APP_URL "https://$domain"
set_value API_INTERNAL_URL "http://api:4000"
ensure_secret POSTGRES_PASSWORD 32
ensure_secret SESSION_SECRET 48
ensure_secret ADMIN_PASSWORD 20
if [ "$(get_value ALLOW_DEMO_LOGIN)" = "true" ]; then
  ensure_secret DEMO_PASSWORD 16
fi

chmod 600 "$env_file"
echo "Prepared $env_file for https://$domain (mode 600)."
echo "Secrets were preserved when already present and were not printed."
echo "Run: sh deploy/preflight.sh"
