#!/usr/bin/env bash
set -euo pipefail

: "${ARTIFACTS_URL:?ARTIFACTS_URL is required}"
: "${ARTIFACTS_API_KEY:?ARTIFACTS_API_KEY is required}"

cursor=""
while true; do
  args=(
    --fail-with-body
    --silent
    --show-error
    --request POST
    --header "Authorization: Bearer ${ARTIFACTS_API_KEY}"
  )
  if [[ -n "$cursor" ]]; then
    args+=(--get --data-urlencode "cursor=${cursor}")
  fi

  migration_response="$(curl "${args[@]}" "${ARTIFACTS_URL}/_migrate-retention-prefixes")"
  printf '%s\n' "$migration_response"
  export MIGRATION_RESPONSE="$migration_response"
  done_value="$(node -e 'process.stdout.write(String(JSON.parse(process.env.MIGRATION_RESPONSE).done))')"
  if [[ "$done_value" == "true" ]]; then
    break
  fi
  cursor="$(node -e 'process.stdout.write(JSON.parse(process.env.MIGRATION_RESPONSE).cursor)')"
done
