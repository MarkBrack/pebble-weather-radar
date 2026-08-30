#!/bin/sh
set -eu

cd "$(dirname "$0")"
umask 077

if [ ! -s .env ]; then
  printf 'TILE_SERVER_TOKEN=' > .env
  openssl rand -hex 32 >> .env
fi

sudo docker compose up --detach --build
