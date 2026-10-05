#!/bin/bash
set -euo pipefail

# Installs Ziggy for the coding agents on this machine:
#   runtime  → ~/.codex/tools/ziggy  (CLI + scripts + templates)
#   wrapper  → ~/.local/bin/ziggy
#   skill    → ~/.codex/skills/ziggy and ~/.claude/skills/ziggy (same SKILL.md for Codex and Claude Code)
#   config   → ~/.ziggy/config.json pointing at this checkout (tenants live in the repo)
#
# Secrets are not touched: keys live in hush (ziggy keys pull <tenant> --send <url>).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
CONFIG_DIR="$HOME/.ziggy"
BIN_DIR="${ZIGGY_BIN_DIR:-$HOME/.local/bin}"

absolute() { mkdir -p "$1"; (cd "$1" && pwd); }
CODEX_HOME="$(absolute "$CODEX_HOME")"
CLAUDE_HOME="$(absolute "$CLAUDE_HOME")"
CONFIG_DIR="$(absolute "$CONFIG_DIR")"
BIN_DIR="$(absolute "$BIN_DIR")"
TOOLS_DIR="$CODEX_HOME/tools/ziggy"

echo "Installing Ziggy from $REPO_DIR"

command -v node >/dev/null 2>&1 || { echo "node is required (20+)"; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "node 20+ is required (found $(node --version))"; exit 1; }

mkdir -p "$TOOLS_DIR"
cp "$SCRIPT_DIR/index.js" "$TOOLS_DIR/index.js"
cp "$SCRIPT_DIR/package.json" "$TOOLS_DIR/package.json"
rm -rf "$TOOLS_DIR/scripts" "$TOOLS_DIR/templates"
cp -R "$SCRIPT_DIR/scripts" "$TOOLS_DIR/scripts"
cp -R "$SCRIPT_DIR/templates" "$TOOLS_DIR/templates"
chmod +x "$TOOLS_DIR/index.js"

cat > "$BIN_DIR/ziggy" << EOF
#!/bin/sh
exec node "$TOOLS_DIR/index.js" "\$@"
EOF
chmod +x "$BIN_DIR/ziggy"

for SKILLS_ROOT in "$CODEX_HOME/skills" "$CLAUDE_HOME/skills"; do
  SKILL_DIR="$SKILLS_ROOT/ziggy"
  mkdir -p "$SKILL_DIR"
  cp "$SCRIPT_DIR/SKILL.md" "$SKILL_DIR/SKILL.md"
  rm -rf "$SKILL_DIR/agents" "$SKILL_DIR/references"
  cp -R "$SCRIPT_DIR/agents" "$SKILL_DIR/agents"
  cp -R "$SCRIPT_DIR/references" "$SKILL_DIR/references"
done

# config: point the installed copy at this checkout, which holds tenants/
if [ ! -f "$CONFIG_DIR/config.json" ]; then
  printf '{\n  "version": 1,\n  "repo": "%s",\n  "hyperframesVersion": "0.8.133"\n}\n' "$REPO_DIR" > "$CONFIG_DIR/config.json"
  chmod 600 "$CONFIG_DIR/config.json"
fi
cp "$REPO_DIR/ziggy.config.example.json" "$CONFIG_DIR/config.example.json"
mkdir -p "$CONFIG_DIR/tenants"
chmod 700 "$CONFIG_DIR"

echo "Installed Ziggy:"
echo "  tool:   $TOOLS_DIR/index.js"
echo "  cli:    $BIN_DIR/ziggy"
echo "  skill:  $CODEX_HOME/skills/ziggy/SKILL.md"
echo "          $CLAUDE_HOME/skills/ziggy/SKILL.md"
echo "  config: $CONFIG_DIR/config.json  (repo: $REPO_DIR)"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "  note: $BIN_DIR is not in PATH; add it to use 'ziggy' from any directory." ;;
esac
echo
echo "Next: ziggy doctor"
