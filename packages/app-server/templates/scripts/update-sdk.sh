#!/usr/bin/env bash
set -euo pipefail

REMOTE_URL="https://github.com/lobby-ws/sdk.git"
REMOTE_BRANCH="main"

SYNC_DIRS=(docs scripts skills .cursor)
SYNC_FILES=(
  .env.example
  .gitignore
  .bun-version
  AGENTS.md
  CLAUDE.md
  bun.lock
  package.json
  README.md
  tsconfig.json
)

SCRIPT_PATH="scripts/update-sdk.sh"

usage() {
  cat <<'EOF'
Sync selected folders/files from lobby-ws/sdk while preserving local app/world content.

Usage:
  bash scripts/update-sdk.sh [--branch <branch>] [--remote-url <url>]

Options:
  --branch <branch>    Remote branch to use (default: main).
  --remote-url <url>   Remote URL to fetch from.
  -h, --help           Show this help text.

Notes:
  - This script never stages or commits changes.
  - Preserved local paths include apps/, assets/, .lobby/, world.json, shared/, and any non-allowlisted files.
  - Allowlisted paths are authoritative from sdk; if missing in sdk they are deleted locally.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      [[ $# -ge 2 ]] || { echo "--branch requires a value."; exit 1; }
      REMOTE_BRANCH="$2"
      shift 2
      ;;
    --remote-url)
      [[ $# -ge 2 ]] || { echo "--remote-url requires a value."; exit 1; }
      REMOTE_URL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "This script must run inside a git repository."
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required."
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" == "HEAD" ]]; then
  echo "Detached HEAD is not supported. Checkout a branch first."
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is dirty. Commit or stash first."
  exit 1
fi

TMP_DIR="$(mktemp -d /tmp/sdk-sync-XXXXXX)"
EXPORT_DIR="$TMP_DIR/export"
SELF_BACKUP="$TMP_DIR/update-sdk.sh"
mkdir -p "$EXPORT_DIR"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if [[ -f "$SCRIPT_PATH" ]]; then
  cp "$SCRIPT_PATH" "$SELF_BACKUP"
fi

echo "Fetching $REMOTE_URL ($REMOTE_BRANCH)..."
git fetch "$REMOTE_URL" "$REMOTE_BRANCH"

EXISTING_PATHS=()
for path in "${SYNC_DIRS[@]}" "${SYNC_FILES[@]}"; do
  if git cat-file -e "FETCH_HEAD:$path" 2>/dev/null; then
    EXISTING_PATHS+=("$path")
  fi
done

if (( ${#EXISTING_PATHS[@]} > 0 )); then
  git archive --format=tar FETCH_HEAD "${EXISTING_PATHS[@]}" | tar -xf - -C "$EXPORT_DIR"
fi

echo "Replacing allowlisted directories..."
for dir in "${SYNC_DIRS[@]}"; do
  rm -rf -- "$dir"
done

echo "Replacing allowlisted files..."
for file in "${SYNC_FILES[@]}"; do
  rm -f -- "$file"
done

for dir in "${SYNC_DIRS[@]}"; do
  if [[ -d "$EXPORT_DIR/$dir" ]]; then
    cp -a "$EXPORT_DIR/$dir" "$dir"
  fi
done

for file in "${SYNC_FILES[@]}"; do
  if [[ -f "$EXPORT_DIR/$file" ]]; then
    mkdir -p "$(dirname "$file")"
    cp -a "$EXPORT_DIR/$file" "$file"
  fi
done

# Keep this script available even though scripts/ is synced from sdk.
if [[ -f "$SELF_BACKUP" ]]; then
  mkdir -p "$(dirname "$SCRIPT_PATH")"
  cp "$SELF_BACKUP" "$SCRIPT_PATH"
  chmod +x "$SCRIPT_PATH"
fi

echo "Ensuring gamedev is latest..."
bun add --dev gamedev@latest

echo "Sync complete (no commit, no staging)."
