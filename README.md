# dsh-plugins

自建的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) MCP 插件集合。换设备时把这个仓库拉下来、跑一遍 `scripts/setup.sh`，工具就回来了。

每个插件一个文件夹，互不干扰，新增插件不需要改脚本。

| 插件 | 命名空间 | 能力 |
|---|---|---|
| [plugins/github-mcp](plugins/github-mcp/) | `mcp__github__*` | 仓库/文件/Issue/PR 读写，私有仓库 clone / pull / push |
| [plugins/atlassian-mcp](plugins/atlassian-mcp/) | `mcp__atlassian__*` | Confluence 空间/页面搜索与增删改，Jira 项目/JQL/Issue/状态流转 |

## 目录结构

```
plugins/
  github-mcp/
    plugin.yml        # id / serverName / timeoutMs（setup.sh 按它注册）
    server.mjs        # MCP 服务本体
    package.json
    README.md
    install.sh        # 可选：安装后钩子（建凭据模板等）
  atlassian-mcp/
    ...
scripts/
  setup.sh            # 装全部插件 + 写 cordis patch
  set-git-credential.sh
  uninstall.sh        # 按 plugin.yml 逐个卸载
```

## 安装（新设备）

前提：已装好 DSH、node ≥ 20，`$DSH_HOME` 默认 `~/.dsh`。

```bash
git clone https://github.com/ShangZhenYu-CR/dsh-plugins.git
cd dsh-plugins
bash scripts/setup.sh          # 装依赖 + 注册到 profile patch
# 填凭据：
#   GitHub   : echo 'ghp_xxx' > ~/.dsh/github-mcp/token && chmod 600 同文件
#   Atlassian: 编辑 ~/.dsh/atlassian-mcp/config.json
bash scripts/set-git-credential.sh   # 让命令行 git 也能访问私有仓库
# 重启 DSH 引擎
```

`setup.sh` 做的事（对每个 `plugins/*/`）：

1. 把 `server.mjs` + `package.json` 复制到 `$DSH_HOME/<插件目录名>`，`npm install --omit=dev`
2. 有 `install.sh` 就执行（创建空白凭据文件，已存在则不动）
3. 若 profile patch 里还没有该 `id`，追加一个 `mcp-client` insert 块，`args` 指向 `$DSH_HOME/<插件目录名>/server.mjs`

重复执行是安全的：已存在的条目不重复写。**装到哪个目录 = 仓库里的文件夹名**，所以改名要同时改目录名。

## 新增一个插件

```bash
mkdir -p plugins/my-tool
# server.mjs + package.json 照隔壁抄，工具用 registerTool 注册
cat > plugins/my-tool/plugin.yml <<'YML'
id: mcp-my-tool
serverName: mytool
description: 一句话说明
timeoutMs: 120000
YML
bash scripts/setup.sh
```

工具名会出现在 `mcp__mytool__*`。需要凭据的话在同目录放 `install.sh` 生成空白模板。

## 凭据放哪

| 文件 | 内容 |
|---|---|
| `$DSH_HOME/github-mcp/token` | GitHub PAT，一行 |
| `$DSH_HOME/github-mcp/git-credentials` | git credential store（由 `set-git-credential.sh` 生成） |
| `$DSH_HOME/atlassian-mcp/config.json` | `{"site":"xxx.atlassian.net","email":"you@x.com","token":"..."}` |

这些文件**不会被仓库收录**（见 `.gitignore`），也不要在对话里再次粘贴已保存的 token。

## 需要的权限

- GitHub PAT：classic 勾 `repo`；fine-grained 给目标仓库 Contents / Issues / Pull requests 读写
- Atlassian API Token：<https://id.atlassian.com/manage-profile/security/api-tokens>（Confluence 与 Jira 共用一个）

## 卸载

```bash
bash scripts/uninstall.sh
```

删除 `$DSH_HOME/<插件目录>` 并从 patch 里移除对应 insert 块，凭据先备份到 `/tmp/dsh-plugins-backup/`，然后重启 DSH。

## License

MIT
