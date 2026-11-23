#!/bin/bash
# One-off build: compiles jq from source and vendors it into ./vendor/jq. The
# scripts use it on every macOS in place of /usr/bin/jq, which only ships from
# macOS 15, so every Mac runs the same jq.
#
# jqlang's own macOS binaries target newer macOS versions than Alfred 6's
# minimum, hence the source build.
#
# Needs (build time only): Xcode command line tools, curl.
# Usage:  ./vendor-jq.sh
#
# The jq version and its source tarball's SHA-256 are pinned below; to update
# jq, change both (the hash is in the release's sha256sum.txt).
# The binary targets macOS $MIN_MACOS (default 12.0, Alfred 6's minimum) and
# is signed and notarised; see vendor-common.sh for SIGN_IDENTITY,
# NOTARY_PROFILE and SIGN=0.
set -euo pipefail

jq_version=1.8.2
jq_sha256=71b8d6e8f5fe81f6c6d0d110e3892251f6ce76ed095abd315e26e6e1193af3af

here="$(cd "$(dirname "$0")" && pwd)"
source "$here/vendor-common.sh"

require_xcode_tools
check_signing_setup

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "==> Downloading jq $jq_version"
curl -sSfL -o "$work/jq.tar.gz" \
  "https://github.com/jqlang/jq/releases/download/jq-$jq_version/jq-$jq_version.tar.gz"
actual="$(shasum -a 256 "$work/jq.tar.gz" | cut -d ' ' -f 1)"
if [ "$actual" != "$jq_sha256" ]; then
  echo "FAILED: jq-$jq_version.tar.gz has SHA-256 $actual, expected $jq_sha256" >&2
  exit 1
fi
tar -xzf "$work/jq.tar.gz" -C "$work"
src="$work/jq-$jq_version"

# One build per architecture, joined with lipo, since autoconf builds don't
# reliably support several -arch flags in one pass. Regex support uses the
# Oniguruma copy in the tarball (--with-oniguruma=builtin, as Apple builds
# /usr/bin/jq), and static libraries keep the binary self-contained.
for arch in arm64 x86_64; do
  case "$arch" in
    arm64)  host=aarch64-apple-darwin ;;
    x86_64) host=x86_64-apple-darwin ;;
  esac
  echo "==> Building $arch (minimum macOS $min_macos)"
  build="$work/build-$arch"
  mkdir "$build"
  if ! (cd "$build" &&
        export MACOSX_DEPLOYMENT_TARGET="$min_macos" &&
        "$src/configure" --host="$host" --disable-docs --disable-maintainer-mode \
          --disable-shared --enable-static --with-oniguruma=builtin \
          CC="clang -arch $arch" CFLAGS=-O2 >configure.log 2>&1 &&
        make -j"$(sysctl -n hw.ncpu)" >make.log 2>&1); then
    echo "FAILED: $arch build; the end of its logs:" >&2
    tail -n 20 "$build"/configure.log "$build"/make.log 2>/dev/null >&2 || true
    exit 1
  fi
done

lipo -create "$work/build-arm64/jq" "$work/build-x86_64/jq" -output "$work/jq"
strip "$work/jq"

# jq_works <jq binary> [arch prefix…]: runs the binary on the builtins the
# scripts rely on, plus test() to check regex support was built in.
jq_works() {
  local jq="$1" out
  shift
  out="$("$@" "$jq" -nc --argjson d 15 \
    '[1.6 | floor, (2.5 | round), (-3 | fabs), ("Music.app" | rtrimstr(".app")), $d, ("abc" | test("b"))]')"
  [ "$out" = '[1,3,3,"Music",15,true]' ]
}

# Checking, signing and notarising all happen before ./vendor is touched, so a
# failure leaves the existing jq in place.
archs="$(lipo -archs "$work/jq")"
if [ "$archs" != "x86_64 arm64" ]; then
  echo "FAILED: jq has architectures '$archs', expected 'x86_64 arm64'" >&2
  exit 1
fi
check_minos "$work/jq"
version="$("$work/jq" --version)"
if [ "$version" != "jq-$jq_version" ]; then
  echo "FAILED: built jq reports '$version', expected 'jq-$jq_version'" >&2
  exit 1
fi
jq_works "$work/jq" || { echo "FAILED: built jq gave unexpected results" >&2; exit 1; }
# On Apple silicon, also run the Intel slice if Rosetta is installed.
if [ "$(uname -m)" = arm64 ] && arch -x86_64 /usr/bin/true 2>/dev/null; then
  jq_works "$work/jq" arch -x86_64 || { echo "FAILED: built jq's x86_64 slice gave unexpected results" >&2; exit 1; }
fi
sign_and_notarise "$work/jq" "$work/jq" "$work"

echo "==> Vendoring into $here/vendor/jq"
rm -rf "$here/vendor/jq"
mkdir -p "$here/vendor/jq/bin"
ditto "$work/jq" "$here/vendor/jq/bin/jq"
cp "$src/COPYING" "$here/vendor/jq/COPYING"
cp "$src/vendor/oniguruma/COPYING" "$here/vendor/jq/COPYING.oniguruma"
echo "$jq_version" > "$here/vendor/jq/VERSION"

jq_works "$here/vendor/jq/bin/jq" || { echo "FAILED: vendored jq gave unexpected results" >&2; exit 1; }
echo "OK: jq $jq_version vendored ($(stat -f %z "$here/vendor/jq/bin/jq") bytes)"
if [ "$sign" != 1 ]; then
  echo "NOTE: unsigned (SIGN=0). Don't release this build: Gatekeeper blocks it on other Macs." >&2
fi
