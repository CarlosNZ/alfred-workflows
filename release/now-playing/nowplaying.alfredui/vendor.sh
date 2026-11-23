#!/bin/bash
# One-off build: compiles ungive/mediaremote-adapter and vendors it into ./vendor
# so the workflow has no runtime dependencies. ./vendor/jq comes from
# vendor-jq.sh and is left alone.
#
# Needs (build time only): Xcode command line tools, cmake, git.
# Usage:  ./vendor.sh            # latest master
#         ./vendor.sh v0.5.0     # or a specific tag/branch
#
# The binaries target macOS $MIN_MACOS (default 12.0, Alfred 6's minimum).
# The framework is signed and notarised; see vendor-common.sh for
# SIGN_IDENTITY, NOTARY_PROFILE and SIGN=0.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
ref="${1:-master}"
source "$here/vendor-common.sh"

require_xcode_tools
command -v cmake >/dev/null || { echo "Missing cmake: brew install cmake (only needed to build)"; exit 1; }
check_signing_setup

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "==> Cloning mediaremote-adapter ($ref)"
git clone --quiet --depth 1 --branch "$ref" --recurse-submodules --shallow-submodules \
  https://github.com/ungive/mediaremote-adapter.git "$work/src"

echo "==> Building (minimum macOS $min_macos)"
cmake -S "$work/src" -B "$work/build" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$min_macos" >/dev/null
cmake --build "$work/build" --config Release >/dev/null

# Checking, signing and notarising all happen before ./vendor is touched, so a
# failure leaves the existing adapter in place. Only the framework ships; the
# test client is used on this Mac only, so it keeps its ad-hoc signature.
framework="$work/build/MediaRemoteAdapter.framework"
binary="$framework/Versions/A/MediaRemoteAdapter"
check_minos "$binary"
sign_and_notarise "$framework" "$binary" "$work"

echo "==> Vendoring into $here/vendor"
rm -rf "$here/vendor/mediaremote-adapter.pl" "$here/vendor/MediaRemoteAdapter.framework" \
  "$here/vendor/MediaRemoteAdapterTestClient" "$here/vendor/LICENSE" "$here/vendor/VERSION"
mkdir -p "$here/vendor"
# ditto preserves the framework's internal symlinks and code signature
ditto "$work/src/bin/mediaremote-adapter.pl"       "$here/vendor/mediaremote-adapter.pl"
ditto "$framework"                                 "$here/vendor/MediaRemoteAdapter.framework"
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
if [ "$sign" != 1 ]; then
  echo "NOTE: unsigned (SIGN=0). Don't release this build: Gatekeeper blocks it on other Macs." >&2
fi
