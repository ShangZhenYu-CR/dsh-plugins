#!/usr/bin/env bash
# 安装 dsh-plugins 里的全部插件。可重复执行；新增插件只需放进 plugins/<名字>/。
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCH="$DSH_HOME/profiles/web/cordis.patch.yml"

command -v node >/dev/null 2>&1 || { echo "缺少 node（需 ≥ 20）"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "缺少 npm"; exit 1; }

echo "DSH_HOME = $DSH_HOME"
mkdir -p "$(dirname "$PATCH")"
touch "$PATCH"

for dir in "$ROOT"/plugins/*/; do
  name="$(basename "$dir")"
  meta="$dir/plugin.yml"
  if [ ! -f "$meta" ]; then
    echo "跳过 $name（没有 plugin.yml）"
    continue
  fi

  id="$(sed -n 's/^id: *//p' "$meta" | head -1)"
  server="$(sed -n 's/^serverName: *//p' "$meta" | head -1)"
  timeout="$(sed -n 's/^timeoutMs: *//p' "$meta" | head -1)"
  [ -n "$timeout" ] || timeout=120000
  [ -n "$id" ] && [ -n "$server" ] || { echo "跳过 $name（plugin.yml 缺 id/serverName）"; continue; }

  echo "== 安装 $name（id=$id, serverName=$server）=="
  mkdir -p "$DSH_HOME/$name"
  cp "$dir/server.mjs" "$dir/package.json" "$DSH_HOME/$name/"
  ( cd "$DSH_HOME/$name" && npm install --omit=dev --silent --no-audit --no-fund )

  if [ -x "$dir/install.sh" ] || [ -f "$dir/install.sh" ]; then
    DSH_HOME="$DSH_HOME" bash "$dir/install.sh"
  fi

  if grep -q "id: $id" "$PATCH" 2>/dev/null; then
    echo "  patch 已含 $id，跳过"
  else
    {
      echo ""
      echo "# $name（来自 dsh-plugins）"
      echo "- insert:"
      echo "    - id: $id"
      echo "      name: '@deepseek-ai/dsh-mcp-client'"
      echo "      config:"
      echo "        serverName: $server"
      echo "        transport: stdio"
      echo "        command: !!js process.execPath"
      echo "        args:"
      echo "          - $DSH_HOME/$name/server.mjs"
      echo "        toolCallTimeoutMs: $timeout"
      echo "        failOnStartupError: false"
    } >> "$PATCH"
    echo "  已向 $PATCH 追加 $id"
  fi
done

cat <<EOF

完成。接下来：
  1) 填凭据（见各插件 README：plugins/*/README.md）
  2) 需要命令行 git 访问私有仓库时：bash $ROOT/scripts/set-git-credential.sh
  3) 重启 DSH 引擎，工具会出现在 mcp__<serverName>__* 下
EOF
