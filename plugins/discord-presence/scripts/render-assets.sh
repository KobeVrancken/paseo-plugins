#!/usr/bin/env bash
# Renders the four art assets the Discord application needs, from Paseo's own artwork.
#
# Usage: scripts/render-assets.sh [path-to-paseo-checkout]
#
# The large image is Paseo's app icon. The small images are the status dots Paseo draws on its own
# favicon, in Paseo's colours, as bare circles: Discord renders the small image at about 20px, where
# a whole icon with a dot on it is unreadable.
#
# Source: https://github.com/getpaseo/paseo, AGPLv3, packages/app/assets/images.
set -euo pipefail

PASEO_DIR="${1:-$HOME/Programming/misc/paseo}"
IMAGES="$PASEO_DIR/packages/app/assets/images"
OUT="$(cd "$(dirname "$0")/.." && pwd)/assets"

if [ ! -d "$IMAGES" ]; then
  echo "Paseo artwork not found at $IMAGES" >&2
  echo "Pass the path to a Paseo checkout: scripts/render-assets.sh /path/to/paseo" >&2
  exit 1
fi

for tool in magick rsvg-convert; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done

mkdir -p "$OUT"

# Discord requires art assets to be at least 512x512.
magick "$IMAGES/icon.png" -resize 512x512 -colorspace sRGB -type TrueColor "$OUT/paseo.png"

dot() {
  local name="$1" colour="$2"
  rsvg-convert -w 512 -h 512 -o "$OUT/$name.png" /dev/stdin <<SVG
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <circle cx="256" cy="256" r="256" fill="$colour"/>
</svg>
SVG
}

# The same colours Paseo uses for its running and attention favicons.
dot running "#3b82f6"
dot attention "#22c55e"
dot idle "#6b7280"

echo "Wrote:"
ls -1 "$OUT"
