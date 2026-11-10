#!/usr/bin/env bash
# 卸载 dsh-plugins：移除 patch 条目与安装目录。凭据文件先备份到 /tmp。
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PATCH="$DSH_HOME/profiles/web/cordis.patch.yml"

if [ -f "$PATCH" ]; then
  cp "$PATCH" "/tmp/cordis.patch.yml.$(date +%s).bak"
  # 删除从注释行到 insert 块结尾（只针对本仓库写入的两个块）
  python3 - "$PATCH" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
for pid, title in (('mcp-github', 'GitHub'), ('mcp-atlassian', 'Atlassian')):
    pat = re.compile(r'\n# ' + title + r'[^\n]*\n- insert:\n    - id: ' + pid + r'\n(?:      [^\n]*\n|        [^\n]*\n|          - [^\n]*\n)*')
    s = pat.sub('\n', s)
open(p, 'w', encoding='utf-8').write(s)
print('patch 已清理')
PY
fi

mkdir -p /tmp/dsh-plugins-backup
for f in github-mcp/token github-mcp/git-credentials atlassian-mcp/config.json; do
  [ -f "$DSH_HOME/$f" ] && cp "$DSH_HOME/$f" "/tmp/dsh-plugins-backup/$(basename "$f")" && echo "已备份 $f → /tmp/dsh-plugins-backup/"
done

rm -rf "$DSH_HOME/github-mcp" "$DSH_HOME/atlassian-mcp"
echo "已删除安装目录，重启 DSH 后工具消失"
