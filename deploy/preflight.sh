#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

fail() {
  echo "Preflight failed: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "Docker Engine is not installed."
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is not installed."
command -v curl >/dev/null 2>&1 || fail "curl is not installed."
[ -f .env ] || fail ".env is missing; run sh deploy/prepare-env.sh <domain>."

get_value() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); value=$0 } END { print value }' .env | tr -d '\r'
}

require_value() {
  value=$(get_value "$1")
  [ -n "$value" ] || fail "$1 is empty in .env."
}

for key in DOMAIN POSTGRES_PASSWORD SESSION_SECRET ADMIN_PASSWORD DATA_MODE ALLOW_DEMO_LOGIN; do
  require_value "$key"
done

domain=$(get_value DOMAIN)
case "$domain" in
  *://*|*/*|*:*|*[!A-Za-z0-9.-]*) fail "DOMAIN must contain only a host name." ;;
esac
case "$domain" in
  *.*) ;;
  *) fail "DOMAIN must be a fully qualified host name." ;;
esac
if printf '%s\n' "$domain" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
  fail "A raw IPv4 address cannot provide browser-trusted HTTPS; configure a domain name."
fi

postgres_password=$(get_value POSTGRES_PASSWORD)
case "$postgres_password" in
  *[!A-Za-z0-9._~-]*)
    fail "POSTGRES_PASSWORD must be URL-safe because it is embedded in DATABASE_URL; generate a hex value."
    ;;
esac

session_secret=$(get_value SESSION_SECRET)
[ "${#session_secret}" -ge 32 ] || fail "SESSION_SECRET must have at least 32 characters."

data_mode=$(get_value DATA_MODE)
demo_login=$(get_value ALLOW_DEMO_LOGIN)
if [ "$data_mode" = "real" ] && [ "$demo_login" = "true" ]; then
  fail "ALLOW_DEMO_LOGIN must be false when DATA_MODE=real."
fi
if [ "$data_mode" = "real" ]; then
  for key in STUDENT_PROVIDER_MODULE OIDC_ISSUER OIDC_CLIENT_ID OIDC_CLIENT_SECRET OIDC_MAPPING_FILE; do
    require_value "$key"
  done
fi

mode=$(stat -c '%a' .env 2>/dev/null || true)
if [ "$mode" != "600" ] && [ -n "$mode" ]; then
  echo "Warning: .env mode is $mode; applying mode 600."
  chmod 600 .env
fi

docker compose config --quiet
echo "Preflight passed for https://$domain."
echo "DNS and firewall still need to expose TCP 80/443 and UDP 443 to this VPS."
