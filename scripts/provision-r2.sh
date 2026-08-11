#!/usr/bin/env bash
set -euo pipefail

bucket_name="${R2_BUCKET_NAME:-artifacts}"

create_bucket() {
  local name="$1"

  if pnpm exec wrangler r2 bucket info "$name" --json >/dev/null 2>&1; then
    echo "R2 bucket already exists: $name"
    return
  fi

  pnpm exec wrangler r2 bucket create "$name"
}

create_bucket "$bucket_name"
