#!/usr/bin/env bash
# 安装后钩子：准备 Atlassian 配置模板
set -euo pipefail
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
DIR="${PLUGIN_DIR:-$DSH_HOME/mcp-plugins/atlassian-mcp}"

if [ ! -f "$DIR/config.json" ]; then
  umask 077
  printf '%s\n' '{' '  "site": "",' '  "email": "",' '  "token": ""' '}' > "$DIR/config.json"
  chmod 600 "$DIR/config.json"
  echo "  已创建 $DIR/config.json（请填 site / email / token）"
fi
