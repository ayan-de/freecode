#!/usr/bin/env bash
# =============================================================================
# FreeCode installer
#
#   curl -fsSL https://freecode.ayande.xyz/install | bash
#
# Downloads the latest self-contained `freecode` binary for this platform from
# GitHub Releases, installs it under ~/.freecode/builds/versions/<version>, and
# links a launcher into ~/.local/bin. Re-run any time to update in place.
# =============================================================================
set -euo pipefail

REPO="ayan-de/freecode"
IS_WINDOWS=false

info() { printf '\033[1;34m%s\033[0m\n' "$*"; }
err()  { printf '\033[1;31merror: %s\033[0m\n' "$*" >&2; exit 1; }

tmpdir=""
cleanup() { [ -z "$tmpdir" ] || rm -rf "$tmpdir"; }
trap cleanup EXIT

# ---- platform detection ----------------------------------------------------
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Linux)
    case "$ARCH" in
      x86_64)         ARTIFACT="freecode-linux-x86_64" ;;
      aarch64|arm64)  ARTIFACT="freecode-linux-aarch64" ;;
      *) err "Unsupported Linux architecture: $ARCH" ;;
    esac ;;
  Darwin)
    case "$ARCH" in
      arm64)   ARTIFACT="freecode-macos-aarch64" ;;
      x86_64)  ARTIFACT="freecode-macos-x86_64" ;;
      *) err "Unsupported macOS architecture: $ARCH" ;;
    esac ;;
  MINGW*|MSYS*|CYGWIN*)
    IS_WINDOWS=true
    ARTIFACT="freecode-windows-x86_64.exe"
    err "On Windows, install with PowerShell:
    irm https://freecode.ayande.xyz/install.ps1 | iex" ;;
  *) err "Unsupported OS: $OS" ;;
esac

# ---- paths -----------------------------------------------------------------
FREECODE_HOME="${FREECODE_HOME:-$HOME/.freecode}"
INSTALL_DIR="${FREECODE_INSTALL_DIR:-$HOME/.local/bin}"
builds_dir="$FREECODE_HOME/builds"
stable_dir="$builds_dir/stable"
version_dir="$builds_dir/versions"
launcher_path="$INSTALL_DIR/freecode"

# ---- resolve latest version ------------------------------------------------
info "Resolving latest release..."
VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o '"tag_name" *: *"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$VERSION" ] || err "Failed to determine latest version"
version="${VERSION#v}"

EXISTING=""
[ -x "$launcher_path" ] && EXISTING=$("$launcher_path" --version 2>/dev/null | head -1 || echo "")
if [ -n "$EXISTING" ]; then
  if [ "$EXISTING" = "$version" ]; then
    info "freecode $VERSION is already installed — reinstalling"
  else
    info "Updating freecode $EXISTING → $version"
  fi
else
  info "Installing freecode $VERSION"
fi

# ---- download --------------------------------------------------------------
URL="https://github.com/$REPO/releases/download/$VERSION/$ARTIFACT"
tmpdir=$(mktemp -d)
info "  downloading $ARTIFACT"
curl -fSL --progress-bar "$URL" -o "$tmpdir/freecode" \
  || err "Download failed: $URL"

# ---- install into versioned dir + link stable + launcher -------------------
dest_version_dir="$version_dir/$version"
mkdir -p "$INSTALL_DIR" "$stable_dir" "$dest_version_dir"
mv "$tmpdir/freecode" "$dest_version_dir/freecode"
chmod +x "$dest_version_dir/freecode"

ln -sfn "$dest_version_dir/freecode" "$stable_dir/freecode"
printf '%s\n' "$version" > "$builds_dir/stable-version"
ln -sfn "$stable_dir/freecode" "$launcher_path"

# macOS: clear the quarantine flag so Gatekeeper doesn't block the binary.
if [ "$OS" = "Darwin" ]; then
  xattr -d com.apple.quarantine "$dest_version_dir/freecode" 2>/dev/null || true
fi

# ---- PATH setup ------------------------------------------------------------
PATH_LINE="export PATH=\"$INSTALL_DIR:\$PATH\""
added_to=""
_have() { command -v "$1" >/dev/null 2>&1; }

ensure_rc() {
  rc="$1"; create="$2"
  if [ ! -f "$rc" ]; then
    [ "$create" = "yes" ] || return 0
    mkdir -p "$(dirname "$rc")"
  fi
  if ! grep -qF "$INSTALL_DIR" "$rc" 2>/dev/null; then
    printf '\n# Added by freecode installer\n%s\n' "$PATH_LINE" >> "$rc"
    added_to="$added_to $rc"
  fi
}
ensure_fish_rc() {
  create="$1"
  rc="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"
  if [ ! -f "$rc" ]; then
    [ "$create" = "yes" ] || return 0
    mkdir -p "$(dirname "$rc")"
  fi
  if ! grep -qF "$INSTALL_DIR" "$rc" 2>/dev/null; then
    {
      printf '\n# Added by freecode installer\n'
      printf 'if not contains "%s" $PATH\n' "$INSTALL_DIR"
      printf '    set -gx PATH "%s" $PATH\n' "$INSTALL_DIR"
      printf 'end\n'
    } >> "$rc"
    added_to="$added_to $rc"
  fi
}

if _have zsh || [ "$OS" = "Darwin" ] || [ -f "$HOME/.zshenv" ] || [ -f "$HOME/.zshrc" ]; then
  ensure_rc "$HOME/.zshenv" yes
fi
if _have bash || [ -f "$HOME/.bashrc" ] || [ -f "$HOME/.bash_profile" ]; then
  ensure_rc "$HOME/.bashrc" yes
fi
ensure_rc "$HOME/.profile" yes
if _have fish || [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish" ]; then
  ensure_fish_rc yes
fi
for rc in "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.bash_profile"; do
  ensure_rc "$rc" no
done
[ -n "$added_to" ] && info "Added $INSTALL_DIR to PATH in:$added_to"

echo ""
info "✅ freecode $VERSION installed!"
echo ""
if command -v freecode >/dev/null 2>&1 && [ "$(command -v freecode)" = "$launcher_path" ]; then
  info "Run 'freecode' in any project to get started."
else
  echo "  Start now with:"
  echo ""
  printf '    \033[1;32mexport PATH="%s:$PATH" && freecode\033[0m\n' "$INSTALL_DIR"
  echo ""
  echo "  New terminals will have freecode on PATH automatically."
fi
echo "  Update later with:  freecode update"
echo "  Uninstall with:     curl -fsSL https://freecode.ayande.xyz/uninstall | bash"
