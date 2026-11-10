#!/usr/bin/env bash
# 安装 dsh-plugins 到本机 DSH。可重复执行。
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCH="$DSH_HOME/profiles/web/cordis.patch.yml"

command -v node >/dev/null 2>&1 || { echo "缺少 node（需 ≥ 20）"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "缺少 npm"; exit 1; }

echo "DSH_HOME = $DSH_HOME"

for p in github-mcp atlassian-mcp; do
  echo "== 安装 $p =="
  mkdir -p "$DSH_HOME/$p"
  cp "$ROOT/$p/server.mjs" "$ROOT/$p/package.json" "$DSH_HOME/$p/"
  ( cd "$DSH_HOME/$p" && npm install --omit=dev --silent --no-audit --no-fund )
done

# 空白凭据文件（已存在就不动）
mkdir -p "$DSH_HOME/github-mcp"
if [ ! -f "$DSH_HOME/github-mcp/token" ]; then
  : > "$DSH_HOME/github-mcp/token"
  chmod 600 "$DSH_HOME/github-mcp/token"
  echo "已创建 $DSH_HOME/github-mcp/token（请填入 PAT）"
fi
if [ ! -f "$DSH_HOME/atlassian-mcp/config.json" ]; then
  umask 077
  printf '%s\n' '{' '  "site": "",' '  "email": "",' '  "token": ""' '}' > "$DSH_HOME/atlassian-mcp/config.json"
  chmod 600 "$DSH_HOME/atlassian-mcp/config.json"
  echo "已创建 $DSH_HOME/atlassian-mcp/config.json（请填 site / email / token）"
fi

# 注册到 profile patch
mkdir -p "$(dirname "$PATCH")"
touch "$PATCH"
for block in github atlassian; do
  id="mcp-$block"
  if grep -q "id: $id" "$PATCH" 2>/dev/null; then
    echo "patch 已含 $id，跳过"
  else
    echo "" >> "$PATCH"
    sed "s|{{DSH_HOME}}|$DSH_HOME|g" "$ROOT/profile/$block.patch.yml" >> "$PATCH"
    echo "已向 $PATCH 追加 $id"
  fi
done

cat <<EOF

完成。接下来：
  1) 填凭据
     GitHub    : echo 'ghp_xxx' > $DSH_HOME/github-mcp/token && chmod 600 $DSH_HOME/github-mcp/token
     Atlassian : 编辑 $DSH_HOME/atlassian-mcp/config.json
  2) 配置 git 凭据（私有仓库拉取/上传）
     bash $ROOT/scripts/set-git-credential.sh
  3) 重启 DSH 引擎，工具会出现在 mcp__github__ / mcp__atlassian__ 下
EOF
