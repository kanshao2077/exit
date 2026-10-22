#!/bin/zsh
set -eu
EXIT_ROOT="${0:A:h}"
cd "$EXIT_ROOT"
EXIT_NODE="$(command -v node || true)"
if [[ -z "$EXIT_NODE" ]]; then
  EXIT_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$EXIT_NODE" ]]; then
  print '需要 Node.js 22.12+。安装 Chrome 扩展本身不需要 Node，请直接加载 dist。'
  exit 1
fi
if [[ ! -d node_modules/vite ]]; then
  print '请先运行 pnpm install --frozen-lockfile。安装扩展可直接使用 dist。'
  exit 1
fi
"$EXIT_NODE" scripts/personalization.mjs --personalized
open 'http://127.0.0.1:4180'
exec "$EXIT_NODE" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4180 --strictPort
