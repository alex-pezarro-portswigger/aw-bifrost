#!/bin/zsh
# Starts a local Bifrost gateway for the aw-bifrost extension.
#
#   BIFROST_BIN       path to the bifrost binary (on macOS keep it under ~/Projects)
#   BIFROST_APP_DIR   Bifrost's data dir: config.json, config.db, logs.db
#   BIFROST_PORT      default 8080; the server binds 127.0.0.1 only
#   OPENAI_OP_REF     1Password reference for the OpenAI key, e.g. op://Vault/item/password
#   ANTHROPIC_OP_REF  1Password reference for the Anthropic key
#
# Keys are read with `op read` into this process's environment and nowhere else:
# config.json names them as env.OPENAI_API_KEY / env.ANTHROPIC_API_KEY.
set -euo pipefail

: "${BIFROST_BIN:?set BIFROST_BIN to the bifrost binary}"
: "${BIFROST_APP_DIR:?set BIFROST_APP_DIR to Bifrost's data directory}"
: "${OPENAI_OP_REF:?set OPENAI_OP_REF to a 1Password reference}"
: "${ANTHROPIC_OP_REF:?set ANTHROPIC_OP_REF to a 1Password reference}"
BIFROST_PORT="${BIFROST_PORT:-8080}"

repo="${0:A:h:h}"
mkdir -p "$BIFROST_APP_DIR"
[[ -f "$BIFROST_APP_DIR/config.json" ]] || cp "$repo/config.example.json" "$BIFROST_APP_DIR/config.json"

export OPENAI_API_KEY="$(op read "$OPENAI_OP_REF")"
export ANTHROPIC_API_KEY="$(op read "$ANTHROPIC_OP_REF")"

# The sqlite store paths in config.json are relative to the working directory.
cd "$BIFROST_APP_DIR"
exec "$BIFROST_BIN" -app-dir "$BIFROST_APP_DIR" -host 127.0.0.1 -port "$BIFROST_PORT"
