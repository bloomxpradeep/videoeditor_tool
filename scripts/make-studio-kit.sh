#!/usr/bin/env bash
# Pack what Reel Studio needs from this Mac's home folder into one zip for scripts/setup-studio-mac.sh:
# fonts, the AE text-style library, the reference build scripts the styles point at, and Claude's memory.
# API keys are NOT packed; the setup script asks for them.
#
#   bash scripts/make-studio-kit.sh [output.zip]     (default: ~/Desktop/ReelStudioKit-<date>.zip)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="${1:-$HOME/Desktop/ReelStudioKit-$(date +%Y%m%d).zip}"
STAGE="$(mktemp -d)/ReelStudioKit"
trap 'rm -rf "$(dirname "$STAGE")"' EXIT

# Claude Code names a project's folder after its path with every non-alphanumeric character turned into "-".
slug() { printf '%s' "$1" | sed 's/[^A-Za-z0-9]/-/g'; }

# Paths under ~ to copy as-is. Big renders, footage and AE logs are left out; Studio only needs the scripts.
HOME_ITEMS=(
  "Movies/_studio/text_styles/README.md"
  "Movies/_studio/text_styles/studio_text_styles.jsx"
  "Movies/_studio/text_styles/build_style_demo.jsx"
  "Movies/_studio/text_styles/person_matte.py"
  "Movies/_studio/text_styles/Style_Demo.aep"
  "Movies/_studio/text_styles/Style_Demo.mp4"
  "Movies/_studio/text_styles/thumbs"
  "Movies/Astro_arun/Moon_Reel_edit/build_moon_aep.jsx"
  "Movies/sakshiji/sakshiji_switchword/Switch_edit/build_switch.jsx"
  "Movies/sakshiji/sakshiji_switchword/Switch_edit/switch_words.jsx"
  "Movies/sakshiji/sakshiji_switchword/Switch_edit/switch_words.py"
  "Movies/sakshiji/sakshiji_switchword/Switch_edit/switch_script.txt"
  "Movies/sakshiji/sakshiji_switchword/Switch_edit/cutouts.py"
  "Movies/sakshiji/sakshiji_switchword/Switch_edit/gen_images.py"
  "Movies/sakshiji/sakshiji_switchword/Switch_edit/make_switch_audio.py"
  "Movies/sanjeevji/Ak360_edit/ak360_mograph.jsx"
)

echo "Staging kit..."
mkdir -p "$STAGE/home" "$STAGE/fonts" "$STAGE/claude/memory"

for item in "${HOME_ITEMS[@]}"; do
  if [[ ! -e "$HOME/$item" ]]; then
    echo "  skip (missing): ~/$item"
    continue
  fi
  mkdir -p "$STAGE/home/$(dirname "$item")"
  cp -R "$HOME/$item" "$STAGE/home/$item"
done

echo "Fonts from ~/Library/Fonts..."
cp -R "$HOME/Library/Fonts/." "$STAGE/fonts/"

echo "Claude memory..."
# This repo's memory goes under "repo" because its folder name depends on where the repo is cloned.
REPO_SLUG="$(slug "$REPO_ROOT")"
for dir in "$HOME/.claude/projects"/*/memory; do
  [[ -n "$(ls -A "$dir" 2>/dev/null)" ]] || continue
  name="$(basename "$(dirname "$dir")")"
  [[ "$name" == "$REPO_SLUG" ]] && name="repo"
  cp -R "$dir" "$STAGE/claude/memory/$name"
done
[[ -f "$HOME/.claude/settings.json" ]] && cp "$HOME/.claude/settings.json" "$STAGE/claude/settings.json"

# The setup script rewrites these into the new Mac's home folder and project slugs.
cat > "$STAGE/kit.env" <<EOF
KIT_OLD_HOME="$HOME"
KIT_OLD_HOME_SLUG="$(slug "$HOME")"
KIT_MCP_VERSION="$(node -p "require('$(npm root -g)/adobe-premiere-pro-mcp/package.json').version" 2>/dev/null || echo latest)"
KIT_CREATED="$(date '+%Y-%m-%d %H:%M')"
EOF

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
(cd "$(dirname "$STAGE")" && zip -qr -X "$OUT" ReelStudioKit)

echo
echo "Kit written: $OUT ($(du -h "$OUT" | cut -f1))"
echo "It contains your Claude memory but no API keys. Copy it to the other Mac with AirDrop or a USB drive."
