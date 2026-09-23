#!/bin/zsh
set -euo pipefail
EXT="/Users/admin/gateway/extension"
PROFILE="$HOME/Library/Application Support/Google/ChromeVerifier"
SRC="$HOME/Library/Application Support/Google/Chrome"

# Sync login cookies from normal Chrome when nothing is running
if ! pgrep -f "Google Chrome" >/dev/null 2>&1; then
  mkdir -p "$PROFILE/Default"
  for f in "Cookies" "Cookies-journal" "Login Data" "Login Data-journal" "Web Data" "Web Data-journal" "Network"; do
    if [ -e "$SRC/Default/$f" ]; then
      rm -rf "$PROFILE/Default/$f"
      cp -a "$SRC/Default/$f" "$PROFILE/Default/$f"
    fi
  done
  cp -a "$SRC/Local State" "$PROFILE/Local State" 2>/dev/null || true
fi

exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$PROFILE" \
  --profile-directory=Default \
  --enable-unsafe-extension-debugging \
  --load-extension="$EXT" \
  "$@"
