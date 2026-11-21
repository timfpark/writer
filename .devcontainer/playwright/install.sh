#!/usr/bin/env bash
# Installs the browsers for one Playwright release into /ms-playwright, with
# the system libraries they need, at image build time. The browser tests then
# run without downloading anything. npx resolves the package through the npm
# registry proxy that the Dockerfile configures in /etc/npmrc.
set -euo pipefail

version="${VERSION:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "playwright feature: set the version option to the exact @playwright/test release in webapp/package.json, got '$version'" >&2
  exit 2
fi

# The node feature installs Node.js through nvm before this feature runs.
export PATH="/usr/local/share/nvm/current/bin:$PATH"
if ! command -v npx >/dev/null 2>&1; then
  echo "playwright feature: npx not found; the node feature must install first" >&2
  exit 2
fi

export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Chromium's headless shell is all headless runs need, and is smaller than the
# full browser.
npx --yes "playwright@${version}" install --with-deps --only-shell chromium webkit
chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH"
rm -rf /root/.npm /var/lib/apt/lists/*
