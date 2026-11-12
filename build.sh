#!/usr/bin/env bash
# Builds dist/ from app/: stamps the git sha (R6) and writes config.js with the session.
# The session stays out of git: SESSION_FILE points at a private file (default ../session.txt).
set -euo pipefail
cd "$(dirname "$0")"
git diff --quiet HEAD -- app || { echo "app/ has uncommitted changes: commit first, so the sha names this build" >&2; exit 1; }
sha=$(git rev-parse HEAD)
session=$(cat "${SESSION_FILE:-../session.txt}")
rm -rf dist && cp -R app dist
sed -i.bak "s/__BUILD_SHA__/$sha/g" dist/index.html && rm dist/index.html.bak
cat > dist/config.js <<JS
export const API = 'https://hq.mega.dev/challenges/show-me-when/api';
export const SESSION = '$session';
JS
echo "$sha"
