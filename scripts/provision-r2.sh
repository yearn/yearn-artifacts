#!/usr/bin/env bash
set -euo pipefail

bucket_name="${R2_BUCKET_NAME:-artifacts}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lifecycle_file="${script_dir}/../config/r2-lifecycle.json"

create_bucket() {
  local name="$1"

  if bun run wrangler r2 bucket info "$name" --json >/dev/null 2>&1; then
    echo "R2 bucket already exists: $name"
    return
  fi

  bun run wrangler r2 bucket create "$name"
}

create_bucket "$bucket_name"
bun run wrangler r2 bucket lifecycle set "$bucket_name" \
  --file "$lifecycle_file" \
  --force
