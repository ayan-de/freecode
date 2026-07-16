#!/usr/bin/env bash
# =============================================================================
# FreeCode uninstaller
#
#   curl -fsSL https://freecode.ayande.xyz/uninstall | bash -s -- --yes
#
# Removes the installed binaries and launcher. User data under ~/.freecode is
# kept unless --purge is given.
#
# Flags: --purge (delete ALL data), --dry-run, --yes/-y (skip prompt)
# =============================================================================
set -euo pipefail

info() { printf '\033[1;34m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
err()  { printf '\033[1;31merror: %s\033[0m\n' "$*" >&2; exit 1; }

PURGE=false; DRY_RUN=false; ASSUME_YES=false
for arg in "$@"; do
  case "$arg" in
    --purge)   PURGE=true ;;
    --dry-run) DRY_RUN=true ;;
    --yes|-y)  ASSUME_YES=true ;;
    --help|-h) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) err "Unknown flag: $arg (supported: --purge, --dry-run, --yes)" ;;
  esac
done

FREECODE_HOME="${FREECODE_HOME:-$HOME/.freecode}"
INSTALL_DIR="${FREECODE_INSTALL_DIR:-$HOME/.local/bin}"
LAUNCHER="$INSTALL_DIR/freecode"
BUILDS_DIR="$FREECODE_HOME/builds"

TARGETS=()
{ [ -e "$LAUNCHER" ] || [ -L "$LAUNCHER" ]; } && TARGETS+=("$LAUNCHER (launcher)")
[ -d "$BUILDS_DIR" ] && TARGETS+=("$BUILDS_DIR (installed binaries)")
if [ "$PURGE" = true ] && [ -d "$FREECODE_HOME" ]; then
  TARGETS+=("$FREECODE_HOME (ALL user data: config, sessions, memory)")
fi

if [ ${#TARGETS[@]} -eq 0 ]; then
  info "Nothing to uninstall: no freecode installation found."
  exit 0
fi

info "The following will be removed:"
for t in "${TARGETS[@]}"; do printf '  - %s\n' "$t"; done
[ "$PURGE" = false ] && warn "User data in $FREECODE_HOME is kept. Use --purge for a full wipe."

if [ "$DRY_RUN" = true ]; then info "Dry run: nothing deleted."; exit 0; fi

if [ "$ASSUME_YES" = false ]; then
  if [ -t 0 ]; then
    printf 'Proceed? [y/N] '; read -r reply
    case "$reply" in y|Y|yes|YES) ;; *) info "Aborted."; exit 1 ;; esac
  else
    err "stdin is not a terminal; re-run with --yes (e.g. curl ... | bash -s -- --yes)"
  fi
fi

remove() { if [ -e "$1" ] || [ -L "$1" ]; then rm -rf -- "$1"; info "Removed $1"; fi; }

remove "$LAUNCHER"
if [ "$PURGE" = true ]; then remove "$FREECODE_HOME"; else remove "$BUILDS_DIR"; fi

info "freecode uninstalled."
info "Reinstall with: curl -fsSL https://freecode.ayande.xyz/install | bash"
