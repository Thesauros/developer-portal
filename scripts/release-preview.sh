#!/usr/bin/env bash
# Build separately so the running Next server never reads half-written chunks.
set -euo pipefail
cd "$(dirname "$0")/.."
release_dir=".next-release-$(date -u +%Y%m%d%H%M%S)"
NEXT_PUBLIC_BASE_PATH=/developers THESAUROS_NEXT_DIST="$release_dir" npm run build
dropin_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/thesauros-docs-console.service.d"
mkdir -p "$dropin_dir"
printf '[Service]\nEnvironment=THESAUROS_NEXT_DIST=%s\n' "$release_dir" > "$dropin_dir/build.conf"
systemctl --user daemon-reload
systemctl --user restart thesauros-docs-console.service
systemctl --user is-active thesauros-docs-console.service
