#!/usr/bin/env bash
# 卸载 dsh-plugins 安装的所有插件：移除 patch 条目与安装目录。凭据先备份到 /tmp。
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCH="$DSH_HOME/profiles/web/cordis.patch.yml"
BACKUP="/tmp/dsh-plugins-backup"
mkdir -p "$BACKUP"

for dir in "$ROOT"/plugins/*/; do
  name="$(basename "$dir")"
  meta="$dir/plugin.yml"
  [ -f "$meta" ] || continue
  id="$(sed -n 's/^id: *//p' "$meta" | head -1)"
  [ -n "$id" ] || continue

  if [ -f "$PATCH" ]; then
    cp "$PATCH" "$BACKUP/cordis.patch.yml.$(date +%s).bak"
    python3 - "$PATCH" "$id" <<'PY'
import re, sys
path, pid = sys.argv[1], sys.argv[2]
s = open(path, encoding='utf-8').read()
pat = re.compile(r'\n(?:# [^\n]*\n)?- insert:\n    - id: ' + re.escape(pid) + r'\n(?:      [^\n]*\n|        [^\n]*\n|          - [^\n]*\n)*')
s2, n = pat.subn('\n', s)
open(path, 'w', encoding='utf-8').write(s2)
print(f'  patch: 移除 {pid}（{n} 处）')
PY
  fi

  for f in "$DSH_HOME/$name"/token "$DSH_HOME/$name"/git-credentials "$DSH_HOME/$name"/config.json; do
    [ -f "$f" ] && cp "$f" "$BACKUP/$name-$(basename "$f")" && echo "  已备份 $(basename "$f") → $BACKUP/"
  done
  rm -rf "$DSH_HOME/$name"
  echo "  已删除 $DSH_HOME/$name"
done

echo "完成。重启 DSH 后工具消失；凭据备份在 $BACKUP"
