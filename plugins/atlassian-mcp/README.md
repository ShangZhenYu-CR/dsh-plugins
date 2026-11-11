# Atlassian MCP（`mcp__atlassian__*`）

给 DeepSeek Harness 用的 Confluence + Jira Cloud 读写工具（stdio MCP 服务）。

## 认证

服务同目录的 `config.json`（即 `$DSH_HOME/mcp-plugins/atlassian-mcp/config.json`）：

```json
{
  "site": "your-company.atlassian.net",
  "email": "you@example.com",
  "token": "ATATT..."
}
```

Token 在 <https://id.atlassian.com/manage-profile/security/api-tokens> 生成，**Confluence 与 Jira 共用同一个**。`site` 只填域名，不带 `https://`。文件权限建议 600。

可用环境变量 `ATLASSIAN_CONFIG` 指向别的配置文件。

## Confluence 工具

| 工具 | 说明 |
|---|---|
| `list_spaces` | 空间列表（返回 `id`，建页面要用） |
| `search_pages` | CQL 搜索，如 `space=DEV and title~"指南"` |
| `get_page` / `get_page_by_title` | 读页面内容（storage 格式 HTML）与版本号 |
| `get_page_children` | 子页面 |
| `create_page` | 建页面（`spaceId` + `title` + storage HTML） |
| `update_page` | 改内容/标题。自动读当前版本并 PUT 完整对象（含 `status: current`、`body: {representation, value}`），`version.number` 自动 +1，409 冲突重试 3 次；`append` 可在正文末尾追加 |
| `delete_page` | 删除（默认进回收站，`purge` 彻底删） |

### update_page 的入参

```json
{
  "id": "22511617",
  "title": "可省略=保持原标题",
  "body": "<p>整段新正文</p>",
  "append": "<p>只追加这段到末尾</p>",
  "status": "current 或 draft（默认 current）",
  "message": "版本说明"
}
```

内部会先 `GET /wiki/api/v2/pages/{id}?body-format=storage` 拿标题、版本号和现有正文，再按 Confluence v2 要求发送完整对象（`status` 必填、`body` 是对象、`version.number` 是当前 +1）。`body` 与 `append` 同时给时以 `body` 为准。

`body` 用 Confluence storage 格式，例如：

```html
<h2>安装</h2><p>第一步……</p><ul><li>要点一</li></ul>
```

## Jira 工具

| 工具 | 说明 |
|---|---|
| `list_projects` | 项目列表（键、名称、类型） |
| `search_issues` | JQL 搜索，如 `project = KAN AND status != Done` |
| `get_issue` | Issue 详情（描述转纯文本） |
| `create_issue` | 建 Issue（纯文本描述自动转 ADF） |
| `update_issue` | 改标题/描述/标签 |
| `comment_issue` | 评论 |
| `list_transitions` / `transition_issue` | 状态流转（先查 id 再执行） |

## 例子

- 「MQ5｜项目中心 里有没有讲安装的页面」→ `search_pages`
- 「给某页加一节更新日志」→ `get_page` + `update_page`
- 「在 KAN 建个 Bug：登录后白屏」→ `create_issue`
- 「把 KAN-12 移到 Done」→ `list_transitions` + `transition_issue`
