# dsh-plugins

自建的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) MCP 插件集合。换设备时把这个仓库拉下来、跑一遍 `scripts/setup.sh`，工具就回来了。

| 插件 | 命名空间 | 能力 |
|---|---|---|
| [github-mcp](github-mcp/) | `mcp__github__*` | 仓库/文件/Issue/PR 读写，私有仓库 clone / pull / push |
| [atlassian-mcp](atlassian-mcp/) | `mcp__atlassian__*` | Confluence 空间/页面搜索与增删改，Jira 项目/JQL/Issue/状态流转 |

## 安装（新设备）

前提：已装好 DSH、node ≥ 20，`$DSH_HOME` 默认 `~/.dsh`。

```bash
git clone https://github.com/<you>/dsh-plugins.git
cd dsh-plugins
bash scripts/setup.sh          # 装依赖 + 写 cordis patch
# 填凭据：
#   GitHub   : echo 'ghp_xxx' > ~/.dsh/github-mcp/token    # chmod 600
#   Atlassian: 编辑 ~/.dsh/atlassian-mcp/config.json
bash scripts/set-git-credential.sh   # 让命令行 git 也能访问私有仓库
# 重启 DSH 引擎
```

安装脚本做的事：

1. 把 `server.mjs` + `package.json` 复制到 `$DSH_HOME/github-mcp`、`$DSH_HOME/atlassian-mcp`，并 `npm install`
2. 若 profile 里还没有对应条目，向 `$DSH_HOME/profiles/web/cordis.patch.yml` 追加 `mcp-github` / `mcp-atlassian` 的 insert 块（路径按 `$DSH_HOME` 展开）
3. 生成空白的 token / config 文件（权限 600），等你填

重复执行是安全的：已存在的 patch 条目不会重复写入。

## 凭据放哪

| 文件 | 内容 |
|---|---|
| `$DSH_HOME/github-mcp/token` | GitHub PAT，一行 |
| `$DSH_HOME/github-mcp/git-credentials` | git 的 credential store（由 `set-git-credential.sh` 生成） |
| `$DSH_HOME/atlassian-mcp/config.json` | `{"site":"xxx.atlassian.net","email":"you@x.com","token":"..."}` |

这些文件**不会被仓库收录**（见 `.gitignore`），也不要在对话里再次粘贴已保存的 token。

## 需要的权限

- GitHub PAT：classic 勾 `repo`；fine-grained 给目标仓库 Contents / Issues / Pull requests 读写
- Atlassian API Token：<https://id.atlassian.com/manage-profile/security/api-tokens>（Confluence 与 Jira 共用一个）

## 卸载

```bash
bash scripts/uninstall.sh
```

删除 `$DSH_HOME/{github,atlassian}-mcp` 并从 patch 里移除两个 insert 块，然后重启 DSH。

## 目录结构

```
github-mcp/      # GitHub MCP 服务（stdio）
atlassian-mcp/   # Atlassian MCP 服务（stdio）
profile/         # cordis.patch.yml 的 insert 片段模板
scripts/         # setup.sh / set-git-credential.sh / uninstall.sh
```

## License

MIT
