# Helpers shared by vendor.sh and vendor-jq.sh, which source this file after
# setting `set -euo pipefail`.
#
# Shipped binaries are signed with a Developer ID Application certificate and
# notarised, so Gatekeeper lets them load from a downloaded (quarantined) copy.
#   SIGN_IDENTITY   the certificate's name, e.g. "Developer ID Application:
#                   Name (TEAMID)"; found automatically when the keychain has
#                   exactly one Developer ID Application identity
#   NOTARY_PROFILE  notarytool keychain profile (default: alfred-workflows),
#                   created once with `xcrun notarytool store-credentials`
#   SIGN=0          skip signing and notarising: binaries keep the linker's
#                   ad-hoc signature, which is fine for local testing but is
#                   blocked by Gatekeeper on other Macs
#   MIN_MACOS       the minimum macOS to build for (default 12.0, Alfred 6's
#                   minimum)

min_macos="${MIN_MACOS:-12.0}"
sign="${SIGN:-1}"
notary_profile="${NOTARY_PROFILE:-alfred-workflows}"

require_xcode_tools() {
  xcode-select -p >/dev/null 2>&1 || { echo "Missing Xcode command line tools: xcode-select --install" >&2; exit 1; }
}

# Checks the signing setup and sets $identity. Run it before building, so a
# missing certificate or profile fails in seconds rather than after compiling.
check_signing_setup() {
  [ "$sign" = 1 ] || return 0
  identity="${SIGN_IDENTITY:-}"
  if [ -z "$identity" ]; then
    local identities count
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
}

# check_minos <Mach-O binary>: fails unless every architecture slice targets
# $min_macos. Without an explicit target, compilers use the build machine's
# macOS version, and the binary then refuses to load on anything older.
check_minos() {
  local built
  built="$(otool -l "$1" | awk '$1 == "minos" { print $2 }' | sort -u | tr '\n' ' ')"
  if [ "$built" != "$min_macos " ]; then
    echo "FAILED: ${1##*/} minimum macOS is '${built% }', expected '$min_macos'" >&2
    exit 1
  fi
}

# sign_and_notarise <framework or binary> <its Mach-O binary> <scratch dir>:
# signs with the hardened runtime and a secure timestamp, notarises, and checks
# that Gatekeeper accepts the result. Does nothing when SIGN=0.
sign_and_notarise() {
  [ "$sign" = 1 ] || return 0
  local target="$1" binary="$2" scratch="$3" name="${1##*/}"
  local zip="$scratch/notarise-$name.zip" result="$scratch/notarise-$name.plist"
  local status id assessment

  echo "==> Signing $name as $identity"
  codesign --force --timestamp --options runtime --sign "$identity" "$target"
  codesign --verify --strict --verbose=2 "$target"

  # Neither a framework nor a bare binary can have a notarisation ticket
  # stapled to it, so Gatekeeper looks the ticket up online when it first
  # checks it.
  echo "==> Notarising $name (usually a few minutes)"
  ditto -c -k --keepParent "$target" "$zip"
  xcrun notarytool submit "$zip" --keychain-profile "$notary_profile" \
    --wait --output-format plist > "$result" || true
  status="$(plutil -extract status raw "$result" 2>/dev/null || echo unknown)"
  if [ "$status" != Accepted ]; then
    echo "FAILED: notarisation status '$status'" >&2
    id="$(plutil -extract id raw "$result" 2>/dev/null || true)"
    if [ -n "$id" ]; then
      xcrun notarytool log "$id" --keychain-profile "$notary_profile" >&2 || true
    else
      cat "$result" >&2
    fi
    exit 1
  fi

  # spctl's output is captured whole rather than piped into grep -q: with
  # pipefail, grep exiting at the first match can kill the writer with SIGPIPE
  # and fail the pipeline even though Gatekeeper accepted the binary.
  echo "==> Checking Gatekeeper accepts $name"
  assessment="$(spctl --assess -vv --type open --context context:primary-signature "$binary" 2>&1 || true)"
  echo "$assessment"
  if [[ "$assessment" != *'source=Notarized Developer ID'* ]]; then
    echo "FAILED: Gatekeeper doesn't see $name as notarised" >&2
    exit 1
  fi
}
