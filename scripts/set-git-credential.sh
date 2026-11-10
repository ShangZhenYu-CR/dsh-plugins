#!/usr/bin/env bash
# 用 token 文件配置 git credential helper，让命令行 git 能访问私有仓库。
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
TOKEN_FILE="$DSH_HOME/mcp-plugins/github-mcp/token"
CRED="$DSH_HOME/mcp-plugins/github-mcp/git-credentials"

if [ ! -s "$TOKEN_FILE" ]; then
  echo "先写入 token：$TOKEN_FILE"
  exit 1
fi

umask 077
printf 'https://x-access-token:%s@github.com\n' "$(tr -d '\r\n' < "$TOKEN_FILE")" > "$CRED"
chmod 600 "$CRED"
git config --global credential.helper "store --file=$CRED"
echo "git 凭据已配置：$CRED"
echo "验证：git ls-remote https://github.com/<owner>/<private-repo>.git HEAD"
