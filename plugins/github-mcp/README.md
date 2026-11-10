# GitHub MCP（`mcp__github__*`）

给 DeepSeek Harness 用的 GitHub 读写工具：[stdio MCP](https://modelcontextprotocol.io) 服务，走 GitHub REST API + 本机 git。

## 认证

Token 放在 `~/.dsh/github-mcp/token`（一行），也可用环境变量 `GITHUB_TOKEN` / `GITHUB_TOKEN_FILE` 覆盖。

- classic PAT：勾 `repo`
- fine-grained：目标仓库的 Contents / Issues / Pull requests 读写

`git` 相关工具（clone/pull/push）用同一份 token，但通过 credential store 而不是把 token 写进 URL：

```bash
bash ../../scripts/set-git-credential.sh
```

## 工具

**API 读写**（无需本地克隆）

| 工具 | 说明 |
|---|---|
| `whoami` | 当前 token 对应账号 |
| `list_repos` | 列当前账号 / 指定用户或组织的仓库 |
| `get_repo` | 仓库信息与权限 |
| `list_dir` / `read_file` | 读目录 / 读文件（返回 sha） |
| `write_file` | 创建或更新文件并提交（自动取 sha，可指定分支） |
| `delete_file` | 删除文件并提交 |
| `list_branches` / `create_branch` | 分支 |
| `list_issues` / `create_issue` / `comment_issue` | Issue |
| `list_pulls` / `create_pull` | PR |
| `search_code` | 代码搜索（可限定仓库） |

**git 拉取 / 上传**（私有仓库可用）

| 工具 | 说明 |
|---|---|
| `clone_repo` | 克隆到工作区，支持 `branch`、`depth` |
| `pull_repo` | `fetch + pull --ff-only`，有本地改动或分叉时如实报告 |
| `push_repo` | `add -A` + commit + push，自动设置 upstream |
| `repo_status` | 分支、领先/落后远端、未提交改动 |

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `GITHUB_TOKEN` | — | 优先于 token 文件 |
| `GITHUB_TOKEN_FILE` | `~/.dsh/github-mcp/token` | token 文件路径 |
| `GITHUB_API_BASE` | `https://api.github.com` | 企业版/代理时改这里 |
| `GITHUB_WORKSPACE` | `/root/workspace` | 相对路径型 `path` 的根目录 |

## 例子

- 「把 OrbitPie 克隆到工作区」→ `clone_repo`
- 「拉一下 SZY-Tool-Hub 最新代码」→ `pull_repo`
- 「把 xxx 目录改完推上去」→ `push_repo`
- 「cg-site 的 README 改一句」→ `read_file` + `write_file`
