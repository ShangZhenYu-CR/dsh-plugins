#!/usr/bin/env node
// Atlassian MCP server (stdio): Confluence + Jira Cloud read/write via email + API token.
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = process.env.HOME || homedir();
const CONFIG_FILE = process.env.ATLASSIAN_CONFIG || join(HOME, '.dsh/atlassian-mcp/config.json');

function config() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function authHeader() {
  const c = config();
  if (!c.site || !c.email || !c.token) {
    throw new Error(`Atlassian 未配置：请在 ${CONFIG_FILE} 里填 {"site":"xxx.atlassian.net","email":"you@x.com","token":"..."}`);
  }
  return 'Basic ' + Buffer.from(`${c.email}:${c.token}`).toString('base64');
}

const siteBase = () => String(config().site || '').replace(/^https?:\/\//, '').replace(/\/$/, '');

async function call(method, path, body) {
  const res = await fetch(`https://${siteBase()}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: authHeader(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  if (!res.ok) {
    let msg = raw;
    try {
      const j = JSON.parse(raw);
      msg = j.message || (j.errorMessages || []).join('; ') || raw;
    } catch {}
    const err = new Error(`Atlassian ${method} ${path} → ${res.status} ${msg}`);
    err.status = res.status;
    throw err;
  }
  return raw ? JSON.parse(raw) : {};
}

const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const clip = (s, n = 60000) => (s.length > n ? s.slice(0, n) + `\n…（已截断，共 ${s.length} 字符）` : s);
const adf = (s) => ({
  type: 'doc',
  version: 1,
  content: String(s || '')
    .split(/\n{2,}/)
    .map((p) => ({ type: 'paragraph', content: p ? [{ type: 'text', text: p }] : [] })),
});
const adfPlain = (doc) => {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'text' && n.text) out.push(n.text);
    if (n.type === 'hardBreak') out.push('\n');
    (n.content || []).forEach(walk);
    if (n.type === 'paragraph' || n.type === 'heading') out.push('\n');
  };
  walk(doc);
  return out.join('').trim();
};

function register(server) {
  server.registerTool(
    'whoami',
    { title: '当前账号', description: '验证 Atlassian 认证，返回账号信息。' },
    async () => {
      const me = await call('GET', '/wiki/rest/api/user/current');
      return text({ accountId: me.accountId, displayName: me.publicName || me.displayName, email: me.email });
    },
  );

  // ---------- Confluence ----------
  server.registerTool(
    'list_spaces',
    {
      title: '列 Confluence 空间',
      description: '列出可访问的 Confluence 空间（返回 id、key、名称，建页面需要 spaceId）。',
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional() }),
    },
    async ({ limit = 50 }) => {
      const r = await call('GET', `/wiki/api/v2/spaces?limit=${limit}`);
      return text(r.results.map((s) => ({ id: s.id, key: s.key, name: s.name, type: s.type })));
    },
  );

  server.registerTool(
    'search_pages',
    {
      title: '搜 Confluence 页面',
      description: '用 CQL 搜索页面，例如 text~"部署" 或 space=DEV and title~"指南"。',
      inputSchema: z.object({ cql: z.string(), limit: z.number().int().min(1).max(50).optional() }),
    },
    async ({ cql, limit = 20 }) => {
      const r = await call('GET', `/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=space,version`);
      return text(
        (r.results || []).map((p) => ({ id: p.id, title: p.title, space: p.space?.key, version: p.version?.number, url: p._links?.webui })),
      );
    },
  );

  server.registerTool(
    'get_page',
    {
      title: '读 Confluence 页面',
      description: '按页面 id 读取内容（storage 格式 HTML）与版本号，改页面时需要版本号。',
      inputSchema: z.object({ id: z.string(), bodyFormat: z.enum(['storage', 'view', 'atlas_doc_format']).optional() }),
    },
    async ({ id, bodyFormat = 'storage' }) => {
      const p = await call('GET', `/wiki/api/v2/pages/${id}?body-format=${bodyFormat}`);
      const body = p.body?.[bodyFormat]?.value ?? '';
      return text({
        id: p.id,
        title: p.title,
        spaceId: p.spaceId,
        version: p.version?.number,
        link: p._links?.webui,
        body: clip(typeof body === 'string' ? body : JSON.stringify(body)),
      });
    },
  );

  server.registerTool(
    'get_page_by_title',
    {
      title: '按标题找页面',
      description: '在指定空间里按标题精确查找页面（返回 id 与内容），常用于先查再改。',
      inputSchema: z.object({ title: z.string(), spaceId: z.string().optional(), bodyFormat: z.enum(['storage', 'view']).optional() }),
    },
    async ({ title, spaceId, bodyFormat = 'storage' }) => {
      const q = `/wiki/api/v2/pages?title=${encodeURIComponent(title)}&body-format=${bodyFormat}${spaceId ? `&space-id=${spaceId}` : ''}`;
      const r = await call('GET', q);
      const p = r.results?.[0];
      if (!p) return text(`没有找到标题为「${title}」的页面`);
      const body = p.body?.[bodyFormat]?.value ?? '';
      return text({ id: p.id, title: p.title, spaceId: p.spaceId, version: p.version?.number, body: clip(typeof body === 'string' ? body : JSON.stringify(body)) });
    },
  );

  server.registerTool(
    'get_page_children',
    {
      title: '子页面',
      description: '列出某个页面的直接子页面。',
      inputSchema: z.object({ id: z.string() }),
    },
    async ({ id }) => {
      const r = await call('GET', `/wiki/api/v2/pages/${id}/children?limit=100`);
      return text((r.results || []).map((p) => ({ id: p.id, title: p.title, status: p.status })));
    },
  );

  server.registerTool(
    'create_page',
    {
      title: '建 Confluence 页面',
      description: '在空间下创建页面，body 用 storage 格式 HTML。parentId 可省略。',
      inputSchema: z.object({
        spaceId: z.string(),
        title: z.string(),
        body: z.string().describe('storage 格式 HTML'),
        parentId: z.string().optional(),
        status: z.enum(['current', 'draft']).optional(),
      }),
    },
    async ({ spaceId, title, body, parentId, status = 'current' }) => {
      const payload = { spaceId, title, status, body: { representation: 'storage', value: body } };
      if (parentId) payload.parentId = parentId;
      const p = await call('POST', '/wiki/api/v2/pages', payload);
      return text({ id: p.id, title: p.title, version: p.version?.number });
    },
  );

  server.registerTool(
    'update_page',
    {
      title: '改 Confluence 页面',
      description: '更新页面内容或标题。会自动取当前版本号 +1；可选更新说明。',
      inputSchema: z.object({
        id: z.string(),
        title: z.string().optional(),
        body: z.string().optional().describe('新的 storage 格式 HTML，省略=只改标题'),
        message: z.string().optional().describe('版本说明'),
      }),
    },
    async ({ id, title, body, message }) => {
      const cur = await call('GET', `/wiki/api/v2/pages/${id}`);
      const next = (cur.version?.number || 0) + 1;
      const payload = { id, title: title || cur.title, version: { number: next, message: message || 'updated by DSH' } };
      if (body !== undefined) payload.body = { representation: 'storage', value: body };
      const p = await call('PUT', `/wiki/api/v2/pages/${id}`, payload);
      return text({ id: p.id, title: p.title, version: p.version?.number, link: p._links?.webui });
    },
  );

  server.registerTool(
    'delete_page',
    {
      title: '删 Confluence 页面',
      description: '删除页面（默认放入回收站，可 purge 彻底删除）。危险操作。',
      inputSchema: z.object({ id: z.string(), purge: z.boolean().optional() }),
    },
    async ({ id, purge = false }) => {
      await call('DELETE', `/wiki/api/v2/pages/${id}${purge ? '?purge=true' : ''}`);
      return text({ deleted: id, purge });
    },
  );

  // ---------- Jira ----------
  server.registerTool(
    'list_projects',
    { title: '列 Jira 项目', description: '列出可访问的 Jira 项目（键、名称、类型）。' },
    async () => {
      const r = await call('GET', '/rest/api/3/project/search?maxResults=100');
      return text((r.values || []).map((p) => ({ key: p.key, name: p.name, type: p.projectTypeKey, id: p.id })));
    },
  );

  server.registerTool(
    'search_issues',
    {
      title: 'JQL 搜 Issue',
      description: '用 JQL 搜索，例如 project = DEV AND status != Done ORDER BY updated DESC。',
      inputSchema: z.object({ jql: z.string(), maxResults: z.number().int().min(1).max(100).optional() }),
    },
    async ({ jql, maxResults = 25 }) => {
      const r = await call(
        'GET',
        `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status,assignee,priority,issuetype,updated`,
      );
      return text(
        (r.issues || []).map((i) => ({
          key: i.key,
          summary: i.fields?.summary,
          status: i.fields?.status?.name,
          type: i.fields?.issuetype?.name,
          assignee: i.fields?.assignee?.displayName,
          updated: i.fields?.updated,
        })),
      );
    },
  );

  server.registerTool(
    'get_issue',
    {
      title: '读 Issue',
      description: '按 key 读取 Issue 详情（描述、状态、指派人、评论数）。',
      inputSchema: z.object({ key: z.string() }),
    },
    async ({ key }) => {
      const i = await call('GET', `/rest/api/3/issue/${encodeURIComponent(key)}`);
      const f = i.fields || {};
      return text({
        key: i.key,
        summary: f.summary,
        status: f.status?.name,
        type: f.issuetype?.name,
        assignee: f.assignee?.displayName,
        reporter: f.reporter?.displayName,
        priority: f.priority?.name,
        labels: f.labels,
        description: clip(f.description ? adfPlain(f.description) : ''),
        link: `https://${siteBase()}/browse/${i.key}`,
      });
    },
  );

  server.registerTool(
    'create_issue',
    {
      title: '建 Jira Issue',
      description: '在项目里创建 Issue（纯文本描述会自动转 ADF）。',
      inputSchema: z.object({
        projectKey: z.string(),
        summary: z.string(),
        description: z.string().optional(),
        issueType: z.string().optional().describe('默认 Task'),
        assigneeAccountId: z.string().optional(),
        labels: z.array(z.string()).optional(),
        priority: z.string().optional(),
      }),
    },
    async ({ projectKey, summary, description, issueType = 'Task', assigneeAccountId, labels, priority }) => {
      const fields = { project: { key: projectKey }, summary, issuetype: { name: issueType } };
      if (description) fields.description = adf(description);
      if (assigneeAccountId) fields.assignee = { id: assigneeAccountId };
      if (labels?.length) fields.labels = labels;
      if (priority) fields.priority = { name: priority };
      const r = await call('POST', '/rest/api/3/issue', { fields });
      return text({ key: r.key, id: r.id, url: `https://${siteBase()}/browse/${r.key}` });
    },
  );

  server.registerTool(
    'update_issue',
    {
      title: '改 Jira Issue',
      description: '更新 Issue 的标题/描述/标签。',
      inputSchema: z.object({ key: z.string(), summary: z.string().optional(), description: z.string().optional(), labels: z.array(z.string()).optional() }),
    },
    async ({ key, summary, description, labels }) => {
      const fields = {};
      if (summary) fields.summary = summary;
      if (description !== undefined) fields.description = adf(description);
      if (labels) fields.labels = labels;
      const r = await call('PUT', `/rest/api/3/issue/${encodeURIComponent(key)}`, { fields });
      return text({ updated: key, ok: !r || Object.keys(r).length === 0 ? true : r });
    },
  );

  server.registerTool(
    'comment_issue',
    { title: 'Issue 评论', description: '在 Issue 下添加评论。', inputSchema: z.object({ key: z.string(), body: z.string() }) },
    async ({ key, body }) => {
      const c = await call('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body: adf(body) });
      return text({ id: c.id, url: `https://${siteBase()}/browse/${key}` });
    },
  );

  server.registerTool(
    'list_transitions',
    { title: '可选状态流转', description: '列出 Issue 当前可执行的状态流转（拿到 id 后用 transition_issue）。', inputSchema: z.object({ key: z.string() }) },
    async ({ key }) => {
      const r = await call('GET', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
      return text((r.transitions || []).map((t) => ({ id: t.id, name: t.name, to: t.to?.name })));
    },
  );

  server.registerTool(
    'transition_issue',
    { title: '改 Issue 状态', description: '执行状态流转（transitionId 来自 list_transitions）。', inputSchema: z.object({ key: z.string(), transitionId: z.string() }) },
    async ({ key, transitionId }) => {
      await call('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: transitionId } });
      return text({ key, transitionId, ok: true });
    },
  );
}

serveStdio(() => {
  const server = new McpServer({ name: 'atlassian', version: '1.0.0' }, { capabilities: { tools: {} } });
  register(server);
  return server;
});
