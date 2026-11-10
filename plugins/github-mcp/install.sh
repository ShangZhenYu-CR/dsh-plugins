#!/usr/bin/env bash
# 安装后钩子：准备 GitHub 的 token 文件
set -euo pipefail
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
DIR="$DSH_HOME/github-mcp"

if [ ! -f "$DIR/token" ]; then
  umask 077
  : > "$DIR/token"
  chmod 600 "$DIR/token"
  echo "  已创建 $DIR/token（请填入 GitHub PAT）"
fi
