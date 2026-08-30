#!/bin/sh
set -eu

cd "$(dirname "$0")"
. ./.env

exec curl --silent --show-error --fail \
  --header "X-Metrics-Token: $METRICS_TOKEN" \
  http://127.0.0.1:8081/internal/metrics
