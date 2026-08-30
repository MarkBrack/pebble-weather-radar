#!/bin/sh
set -eu

cd "$(dirname "$0")"
umask 077

if [ ! -s .env ]; then
  printf 'TILE_SERVER_TOKEN=' > .env
  openssl rand -hex 32 >> .env
fi

sudo docker compose up --detach --build

attempt=0
until curl --silent --fail --output /dev/null http://127.0.0.1:8081/healthz; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 15 ]; then
    echo 'Tile server did not become healthy' >&2
    exit 1
  fi
  sleep 1
done

. ./.env
unauthorized_status=$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8081/)
authorized_status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --header "X-Tile-Token: $TILE_SERVER_TOKEN" http://127.0.0.1:8081/)
test "$unauthorized_status" = '401'
test "$authorized_status" = '404'
