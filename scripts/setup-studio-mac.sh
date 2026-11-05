#!/usr/bin/env bash
# Set up Reel Studio on a Mac from a clone of this repo: tools, the Premiere MCP + CEP panel built from this clone, and
# Studio itself. Optionally also the studio kit (fonts, text-style library, reference scripts, Claude memory) made on
# the main Mac by scripts/make-studio-kit.sh. Claude sign-in happens later, in Studio's sidebar.
# Safe to run again; existing files are never overwritten.
#
#   npm run studio:setup
#   npm run studio:setup -- ~/Downloads/ReelStudioKit-20261102.zip

set -euo pipefail

KIT_ZIP="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMP_DIR="/tmp/premiere-mcp-bridge"
CEP_TARGET_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/MCPBridgeCEP"
WARNINGS=()

step() { printf '\n==> %s\n' "$1"; }
warn() { echo "  ! $1"; WARNINGS+=("$1"); }
slug() { printf '%s' "$1" | sed 's/[^A-Za-z0-9]/-/g'; }

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Reel Studio runs on macOS only."
  exit 1
fi
if [[ -n "$KIT_ZIP" && ! -f "$KIT_ZIP" ]]; then
  echo "Kit zip not found: $KIT_ZIP"
  echo "Usage: npm run studio:setup [-- <ReelStudioKit.zip>]"
  exit 1
fi

step "Homebrew tools (node, ffmpeg, whisper)"
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Install it, then run this script again:"
  echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  exit 1
fi
for pkg in node ffmpeg openai-whisper; do
  if brew list --formula "$pkg" >/dev/null 2>&1; then
    echo "  $pkg: installed"
  else
    brew install "$pkg"
  fi
done
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
[[ "$NODE_MAJOR" -ge 20 ]] || { echo "Node.js 20+ is required, found $(node -v). Run: brew upgrade node"; exit 1; }

step "Adobe apps"
ls -d /Applications/Adobe\ Premiere\ Pro* >/dev/null 2>&1 && echo "  Premiere Pro: found" || warn "Premiere Pro not found in /Applications. Install it from Creative Cloud."
ls -d /Applications/Adobe\ After\ Effects* >/dev/null 2>&1 && echo "  After Effects: found" || warn "After Effects not found in /Applications. Install it from Creative Cloud."

install_kit() {
step "Studio kit"
KIT_TMP="$(mktemp -d)"
trap 'rm -rf "$KIT_TMP"' EXIT
unzip -q "$KIT_ZIP" -d "$KIT_TMP"
KIT="$KIT_TMP/ReelStudioKit"
[[ -f "$KIT/kit.env" ]] || { echo "This zip is not a Reel Studio kit (kit.env missing)."; exit 1; }
# shellcheck disable=SC1091
. "$KIT/kit.env"
echo "  kit made $KIT_CREATED on $KIT_OLD_HOME"

# Copy without overwriting, then point the main Mac's absolute paths at this Mac's home folder.
copy_tree() {
  local src="$1" dest="$2"
  (cd "$src" && find . -type f) | while IFS= read -r rel; do
    rel="${rel#./}"
    if [[ -e "$dest/$rel" ]]; then
      continue
    fi
    mkdir -p "$dest/$(dirname "$rel")"
    cp "$src/$rel" "$dest/$rel"
    case "$rel" in
      *.jsx|*.py|*.md|*.txt|*.json)
        if [[ "$KIT_OLD_HOME" != "$HOME" ]]; then
          sed -i '' "s#$KIT_OLD_HOME/#$HOME/#g" "$dest/$rel"
        fi
        ;;
    esac
  done
}

copy_tree "$KIT/home" "$HOME"
echo "  text styles + reference scripts -> ~/Movies"
mkdir -p "$HOME/Library/Fonts"
copy_tree "$KIT/fonts" "$HOME/Library/Fonts"
echo "  fonts -> ~/Library/Fonts"

NEW_HOME_SLUG="$(slug "$HOME")"
for dir in "$KIT/claude/memory"/*; do
  [[ -d "$dir" ]] || continue
  name="$(basename "$dir")"
  if [[ "$name" == "repo" ]]; then
    target="$(slug "$REPO_ROOT")"
  else
    target="$NEW_HOME_SLUG${name#"$KIT_OLD_HOME_SLUG"}"
  fi
  dest="$HOME/.claude/projects/$target/memory"
  if [[ -f "$dest/MEMORY.md" ]] && ! sed "s#$KIT_OLD_HOME/#$HOME/#g" "$dir/MEMORY.md" | cmp -s - "$dest/MEMORY.md"; then
    warn "Kept the existing memory index in $dest/MEMORY.md; new memory files were added next to it but not indexed."
  fi
  copy_tree "$dir" "$dest"
done
echo "  Claude memory -> ~/.claude/projects/*/memory"
if [[ -f "$KIT/claude/settings.json" && ! -f "$HOME/.claude/settings.json" ]]; then
  cp "$KIT/claude/settings.json" "$HOME/.claude/settings.json"
  echo "  Claude settings -> ~/.claude/settings.json"
fi
}

if [[ -n "$KIT_ZIP" ]]; then
  install_kit
else
  step "Studio kit"
  warn "No kit zip given: fonts, AE text styles and the house-style memory were not installed. Run again with the kit zip to add them."
fi

step "API keys"
ask_key() {
  local file="$1" label="$2" key
  if [[ -s "$file" ]]; then
    echo "  $label: already in ${file/#$HOME/~}"
    return
  fi
  read -r -s -p "  $label key (Enter to skip): " key; echo
  if [[ -n "$key" ]]; then
    (umask 077 && printf '%s\n' "$key" > "$file")
  else
    warn "No $label key. Add it later to ${file/#$HOME/~} (chmod 600)."
  fi
}
ask_key "$HOME/.magnific_key" "Magnific"
ask_key "$HOME/.elevenlabs_key" "ElevenLabs"

step "Premiere MCP server + CEP panel (built from this clone)"
npm install --prefix "$REPO_ROOT"
npm run build --prefix "$REPO_ROOT"
MCP_ENTRY="$REPO_ROOT/dist/index.js"
[[ -f "$MCP_ENTRY" ]] || { echo "Build finished but dist/index.js is missing."; exit 1; }
# Same steps as scripts/install-macos.sh, minus its Claude Desktop config.
for v in 10 11 12; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
mkdir -p "$CEP_TARGET_DIR"
cp -R "$REPO_ROOT/cep-plugin/." "$CEP_TARGET_DIR/"
echo "  MCP Bridge panel -> ${CEP_TARGET_DIR/#$HOME/~}"
mkdir -p "$TEMP_DIR"
# Same entry Studio reads from ~/.claude.json on the main Mac (server/agent.ts userMcpServers).
CONFIG="$HOME/.claude.json" ENTRY="$MCP_ENTRY" TEMP_PATH="$TEMP_DIR" node -e '
const fs = require("fs");
const p = process.env.CONFIG;
let cfg = {};
if (fs.existsSync(p)) cfg = JSON.parse(fs.readFileSync(p, "utf8") || "{}");
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers["premiere-pro"] = {
  type: "stdio",
  command: "node",
  args: [process.env.ENTRY],
  env: { PREMIERE_TEMP_DIR: process.env.TEMP_PATH, PREMIERE_MCP_TOOLSET: "full" },
};
fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
'
echo "  premiere-pro registered in ~/.claude.json"

step "Reel Studio"
npm install --prefix "$REPO_ROOT/studio"
npm run build --prefix "$REPO_ROOT/studio"

echo
echo "Setup complete."
if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo "Needs attention:"
  for w in "${WARNINGS[@]}"; do echo "  - $w"; done
fi
cat <<EOF

Next:
  1. Open Premiere Pro, then Window > Extensions > MCP Bridge (CEP). Open After Effects once and turn on
     Settings > Scripting & Expressions > "Allow Scripts to Write Files and Access Network".
  2. Start Studio:   npm run studio      (it opens http://localhost:8787 in your browser)
  3. In Studio, click "Sign in with Claude" at the bottom of the sidebar and sign in with your Claude account.
EOF
