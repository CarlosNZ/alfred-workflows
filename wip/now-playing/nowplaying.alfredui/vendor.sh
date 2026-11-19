#!/bin/bash
# One-off build: compiles ungive/mediaremote-adapter and vendors it into ./vendor
# so the workflow has no runtime dependencies.
#
# Needs (build time only): Xcode command line tools, cmake, git.
# Usage:  ./vendor.sh            # latest master
#         ./vendor.sh v0.5.0     # or a specific tag/branch
#
# The binaries target macOS $MIN_MACOS (default 12.0, Alfred 6's minimum).
# Without an explicit target, cmake uses the build machine's macOS version,
# and the framework then fails to load on anything older.
#
# The framework is signed with a Developer ID Application certificate and
# notarised, so Gatekeeper lets it load from a downloaded (quarantined) copy.
#   SIGN_IDENTITY   the certificate's name, e.g. "Developer ID Application:
#                   Name (TEAMID)"; found automatically when the keychain has
#                   exactly one Developer ID Application identity
#   NOTARY_PROFILE  notarytool keychain profile (default: alfred-workflows),
#                   created once with `xcrun notarytool store-credentials`
#   SIGN=0          skip signing and notarising: the framework keeps the
#                   linker's ad-hoc signature, which is fine for local testing
#                   but is blocked by Gatekeeper on other Macs
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
ref="${1:-master}"
min_macos="${MIN_MACOS:-12.0}"
sign="${SIGN:-1}"
notary_profile="${NOTARY_PROFILE:-alfred-workflows}"

xcode-select -p >/dev/null 2>&1 || { echo "Missing Xcode command line tools: xcode-select --install"; exit 1; }
command -v cmake >/dev/null    || { echo "Missing cmake: brew install cmake (only needed to build)"; exit 1; }

# Check the signing setup before the build, so a missing certificate or
# profile fails in seconds rather than after compiling.
if [ "$sign" = 1 ]; then
  identity="${SIGN_IDENTITY:-}"
  if [ -z "$identity" ]; then
    identities="$(security find-identity -v -p codesigning |
      sed -n 's/^ *[0-9]*) [0-9A-F]* "\(Developer ID Application: .*\)"$/\1/p')"
    count="$(printf '%s' "$identities" | grep -c . || true)"
    if [ "$count" = 0 ]; then
      echo "No Developer ID Application certificate in the keychain." >&2
      echo "Create one (see README.md), or run with SIGN=0 for an unsigned local build." >&2
      exit 1
    elif [ "$count" != 1 ]; then
      echo "Several Developer ID Application certificates; choose one with SIGN_IDENTITY:" >&2
      printf '  %s\n' "$identities" >&2
      exit 1
    fi
    identity="$identities"
  fi
  if ! xcrun notarytool history --keychain-profile "$notary_profile" >/dev/null 2>&1; then
    echo "notarytool keychain profile '$notary_profile' is missing or its credentials don't work." >&2
    echo "Create it with: xcrun notarytool store-credentials $notary_profile (see README.md)" >&2
    exit 1
  fi
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "==> Cloning mediaremote-adapter ($ref)"
git clone --quiet --depth 1 --branch "$ref" --recurse-submodules --shallow-submodules \
  https://github.com/ungive/mediaremote-adapter.git "$work/src"

echo "==> Building (minimum macOS $min_macos)"
cmake -S "$work/src" -B "$work/build" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$min_macos" >/dev/null
cmake --build "$work/build" --config Release >/dev/null

# Check every architecture slice before touching ./vendor, so a bad build
# leaves the existing adapter in place.
framework="$work/build/MediaRemoteAdapter.framework"
binary="$framework/Versions/A/MediaRemoteAdapter"
built_minos="$(otool -l "$binary" | awk '$1 == "minos" { print $2 }' | sort -u | tr '\n' ' ')"
if [ "$built_minos" != "$min_macos " ]; then
  echo "FAILED: framework minimum macOS is '${built_minos% }', expected '$min_macos'" >&2
  exit 1
fi

# Signing and notarising also happen before ./vendor is touched. Only the
# framework ships; the test client is used on this Mac only, so it keeps its
# ad-hoc signature.
if [ "$sign" = 1 ]; then
  echo "==> Signing as $identity"
  codesign --force --timestamp --options runtime --sign "$identity" "$framework"
  codesign --verify --strict --verbose=2 "$framework"

  # A framework can't have a notarisation ticket stapled to it, so Gatekeeper
  # looks the ticket up online when it first checks the framework.
  echo "==> Notarising (usually a few minutes)"
  ditto -c -k --keepParent "$framework" "$work/notarise.zip"
  xcrun notarytool submit "$work/notarise.zip" --keychain-profile "$notary_profile" \
    --wait --output-format plist > "$work/notarise.plist" || true
  status="$(plutil -extract status raw "$work/notarise.plist" 2>/dev/null || echo unknown)"
  if [ "$status" != Accepted ]; then
    echo "FAILED: notarisation status '$status'" >&2
    id="$(plutil -extract id raw "$work/notarise.plist" 2>/dev/null || true)"
    if [ -n "$id" ]; then
      xcrun notarytool log "$id" --keychain-profile "$notary_profile" >&2 || true
    else
      cat "$work/notarise.plist" >&2
    fi
    exit 1
  fi

  # spctl's output is captured whole rather than piped into grep -q: with
  # pipefail, grep exiting at the first match can kill the writer with SIGPIPE
  # and fail the pipeline even though Gatekeeper accepted the framework.
  echo "==> Checking Gatekeeper accepts it"
  assessment="$(spctl --assess -vv --type open --context context:primary-signature "$binary" 2>&1 || true)"
  echo "$assessment"
  if [[ "$assessment" != *'source=Notarized Developer ID'* ]]; then
    echo "FAILED: Gatekeeper doesn't see the framework as notarised" >&2
    exit 1
  fi
fi

echo "==> Vendoring into $here/vendor"
rm -rf "$here/vendor"
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
