# dsh-plugins 仓库说明（写给 AI）

自建 DeepSeek Harness MCP 插件的公开仓库：<https://github.com/ShangZhenYu-CR/dsh-plugins>。
换设备时 `git clone` + `bash scripts/setup.sh` 即可恢复全部工具。

## 仓库里怎么放文件

```
plugins/<插件名>/        一个插件一个目录，新增插件只加目录，不改脚本
  plugin.yml             id / serverName / description / timeoutMs
  server.mjs             MCP 服务本体（stdio，@modelcontextprotocol/server v2）
  package.json           只依赖 @modelcontextprotocol/server + zod
  README.md              给用户看的用法与凭据说明
  install.sh             可选：安装后钩子，生成空白凭据文件
scripts/
  setup.sh               自动发现 plugins/*/，安装 + 注册
  uninstall.sh           按 plugin.yml 卸载，凭据备份到 /tmp/dsh-plugins-backup
  set-git-credential.sh  用 token 文件配置 git credential store
README.md                安装、凭据、新增插件的说明
```

约束：

- `id` 用 `mcp-<短名>`，决定 `cordis.patch.yml` 里的条目；**不要改名**，否则会重复注册
- `serverName` 是工具前缀：`mcp__<serverName>__<tool>`
- 只提交源码与文档；`token`、`config.json`、`node_modules`、`*credentials*` 一律不进仓库（`.gitignore` 已挡）
- 不把 token 写进任何被提交的文件，也不在 README 里贴真实凭据

## 本机安装布局

```
~/.dsh/mcp-plugins/<插件名>/       server.mjs + node_modules
                                   token / config.json / git-credentials（凭据跟目录走）
~/.dsh/profiles/web/cordis.patch.yml
                                   mcp-<短名> 的 insert 块，args 指向 mcp-plugins 下
```

`server.mjs` 用 `import.meta.url` 定位同目录凭据，所以整个插件目录可以整体搬走或备份。

## 加一个插件

1. `mkdir -p plugins/<name>`，抄现有 `server.mjs` 的结构，用 `registerTool` 注册工具
2. 写 `plugin.yml`（`id: mcp-<name>`、`serverName: <name>`、`timeoutMs: 120000`）
3. 需要凭据就加 `install.sh`，用 `$PLUGIN_DIR` 定位安装目录
4. `bash scripts/setup.sh` → 调 `mcp__<serverName>__*` 验证
5. 验证通过再 `git add -A && git commit && git push origin main`

## 现有插件

| 目录 | 命名空间 | 凭据 |
|---|---|---|
| `plugins/github-mcp` | `mcp__github__*` | `mcp-plugins/github-mcp/token`（PAT） |
| `plugins/atlassian-mcp` | `mcp__atlassian__*` | `mcp-plugins/atlassian-mcp/config.json` |
