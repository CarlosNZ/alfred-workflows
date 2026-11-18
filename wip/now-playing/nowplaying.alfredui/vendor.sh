#!/bin/bash
# One-off build: compiles ungive/mediaremote-adapter and vendors it into ./vendor
# so the workflow has no runtime dependencies.
#
# Needs (build time only): Xcode command line tools, cmake, git.
# Usage:  ./vendor.sh            # latest master
#         ./vendor.sh v0.5.0     # or a specific tag/branch
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
ref="${1:-master}"

xcode-select -p >/dev/null 2>&1 || { echo "Missing Xcode command line tools: xcode-select --install"; exit 1; }
command -v cmake >/dev/null    || { echo "Missing cmake: brew install cmake (only needed to build)"; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "==> Cloning mediaremote-adapter ($ref)"
git clone --quiet --depth 1 --branch "$ref" --recurse-submodules --shallow-submodules \
  https://github.com/ungive/mediaremote-adapter.git "$work/src"

echo "==> Building"
cmake -S "$work/src" -B "$work/build" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$work/build" --config Release >/dev/null

echo "==> Vendoring into $here/vendor"
rm -rf "$here/vendor"
mkdir -p "$here/vendor"
# ditto preserves the framework's internal symlinks and code signature
ditto "$work/src/bin/mediaremote-adapter.pl"       "$here/vendor/mediaremote-adapter.pl"
ditto "$work/build/MediaRemoteAdapter.framework"   "$here/vendor/MediaRemoteAdapter.framework"
ditto "$work/build/MediaRemoteAdapterTestClient"   "$here/vendor/MediaRemoteAdapterTestClient"
cp "$work/src/LICENSE" "$here/vendor/LICENSE"
git -C "$work/src" rev-parse HEAD > "$here/vendor/VERSION"

echo "==> Testing adapter (exit 0 = MediaRemote access works on this macOS)"
if /usr/bin/perl "$here/vendor/mediaremote-adapter.pl" \
     "$here/vendor/MediaRemoteAdapter.framework" \
     "$here/vendor/MediaRemoteAdapterTestClient" test; then
  echo "OK: adapter $(cut -c1-7 "$here/vendor/VERSION") vendored and working"
else
  echo "FAILED: adapter built but MediaRemote access test failed" >&2
  exit 1
fi
