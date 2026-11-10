#!/usr/bin/env node
// GitHub MCP server (stdio): read + write GitHub repos with a PAT.
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const exec = promisify(execFile);

const HOME = process.env.HOME || homedir();
const TOKEN_FILE = process.env.GITHUB_TOKEN_FILE || join(HOME, '.dsh/github-mcp/token');
const API = (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/$/, '');

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  try {
    return readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

const NO_TOKEN = 'GitHub 未认证：请把 Personal Access Token 写入 ' + TOKEN_FILE + '（或设置 GITHUB_TOKEN）。';

async function api(method, path, body) {
  const t = token();
  if (!t) throw new Error(NO_TOKEN);
  const res = await fetch(API + path, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${t}`,
      'User-Agent': 'dsh-github-mcp',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  if (!res.ok) {
    let msg = raw;
    try {
      msg = JSON.parse(raw).message || raw;
    } catch {}
    const err = new Error(`GitHub ${method} ${path} → ${res.status} ${msg}`);
    err.status = res.status;
    throw err;
  }
  return raw ? JSON.parse(raw) : {};
}

const repoArgs = { owner: z.string().describe('仓库所有者（用户名或组织）'), repo: z.string().describe('仓库名') };
const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const clip = (s, n = 60000) => (s.length > n ? s.slice(0, n) + `\n…（已截断，共 ${s.length} 字符）` : s);

// ---------- git helpers (拉取 / 上传) ----------
const WORKSPACE = process.env.GITHUB_WORKSPACE || '/root/workspace';
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' };

function localPath(p) {
  const abs = isAbsolute(p) ? p : resolve(WORKSPACE, p);
  return abs;
}

async function git(cwd, args, { allowFail = false } = {}) {
  try {
    const { stdout, stderr } = await exec('git', args, { cwd, env: GIT_ENV, maxBuffer: 32 * 1024 * 1024 });
    return { ok: true, out: (stdout || '').trim(), err: (stderr || '').trim() };
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim() || String(e.message);
    if (allowFail) return { ok: false, out: '', err: out };
    const err = new Error('git ' + args.join(' ') + ' 失败：' + out);
    throw err;
  }
}

function repoUrl(owner, repo) {
  return `https://github.com/${owner}/${repo}.git`;
}

let identity = null;
async function gitIdentity() {
  if (identity) return identity;
  const me = await api('GET', '/user');
  identity = {
    name: me.name || me.login,
    email: `${me.id}+${me.login}@users.noreply.github.com`,
    login: me.login,
  };
  return identity;
}

function repoSummary(r) {
  return {
    full_name: r.full_name,
    private: r.private,
    default_branch: r.default_branch,
    description: r.description,
    html_url: r.html_url,
    language: r.language,
    pushed_at: r.pushed_at,
    permissions: r.permissions,
  };
}

function register(server) {
  server.registerTool(
    'whoami',
    { title: '当前 GitHub 账号', description: '返回当前 Token 对应的 GitHub 账号。' },
    async () => {
      const me = await api('GET', '/user');
      return text({ login: me.login, name: me.name, id: me.id, html_url: me.html_url });
    },
  );

  server.registerTool(
    'list_repos',
    {
      title: '列仓库',
      description: '列出当前账号或某个用户/组织的仓库（按最近更新排序）。',
      inputSchema: z.object({
        owner: z.string().optional().describe('用户或组织；省略=当前账号'),
        visibility: z.enum(['all', 'public', 'private']).optional(),
        per_page: z.number().int().min(1).max(100).optional(),
      }),
    },
    async ({ owner, visibility = 'all', per_page = 20 }) => {
      const path = owner
        ? `/users/${owner}/repos?per_page=${per_page}&sort=updated`
        : `/user/repos?per_page=${per_page}&sort=updated&visibility=${visibility}`;
      const repos = await api('GET', path);
      return text(repos.map((r) => ({ full_name: r.full_name, private: r.private, description: r.description, pushed_at: r.pushed_at })));
    },
  );

  server.registerTool(
    'get_repo',
    { title: '仓库信息', description: '获取仓库基本信息（默认分支、是否私有、权限等）。', inputSchema: z.object(repoArgs) },
    async ({ owner, repo }) => text(repoSummary(await api('GET', `/repos/${owner}/${repo}`))),
  );

  server.registerTool(
    'list_dir',
    {
      title: '列目录',
      description: '列出仓库中某个目录下的文件与子目录。',
      inputSchema: z.object({ ...repoArgs, path: z.string().optional(), ref: z.string().optional() }),
    },
    async ({ owner, repo, path = '', ref }) => {
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const items = await api('GET', `/repos/${owner}/${repo}/contents/${encodeURI(path)}${q}`);
      const list = Array.isArray(items) ? items : [items];
      return text(list.map((i) => ({ name: i.name, type: i.type, size: i.size, sha: i.sha })));
    },
  );

  server.registerTool(
    'read_file',
    {
      title: '读文件',
      description: '读取仓库中一个文本文件的内容（返回内容和 sha，供写回时使用）。',
      inputSchema: z.object({ ...repoArgs, path: z.string(), ref: z.string().optional() }),
    },
    async ({ owner, repo, path, ref }) => {
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const data = await api('GET', `/repos/${owner}/${repo}/contents/${encodeURI(path)}${q}`);
      if (Array.isArray(data)) throw new Error(`${path} 是目录，请用 list_dir`);
      const content = data.content ? Buffer.from(data.content, 'base64').toString('utf8') : '';
      return text({ path: data.path, sha: data.sha, size: data.size, content: clip(content) });
    },
  );

  server.registerTool(
    'write_file',
    {
      title: '写文件',
      description: '创建或更新仓库中的文件并提交。已存在时会自动取最新 sha 覆盖；可指定分支。',
      inputSchema: z.object({
        ...repoArgs,
        path: z.string(),
        content: z.string().describe('完整的新文件内容'),
        message: z.string().describe('提交信息'),
        branch: z.string().optional(),
        sha: z.string().optional().describe('可选：已知的文件 sha，省略则自动获取'),
      }),
    },
    async ({ owner, repo, path, content, message, branch, sha }) => {
      let current = sha;
      if (!current) {
        try {
          const q = branch ? `?ref=${encodeURIComponent(branch)}` : '';
          const data = await api('GET', `/repos/${owner}/${repo}/contents/${encodeURI(path)}${q}`);
          current = Array.isArray(data) ? undefined : data.sha;
        } catch (e) {
          if (e.status !== 404) throw e;
        }
      }
      const body = { message, content: Buffer.from(content, 'utf8').toString('base64') };
      if (current) body.sha = current;
      if (branch) body.branch = branch;
      const r = await api('PUT', `/repos/${owner}/${repo}/contents/${encodeURI(path)}`, body);
      return text({ path: r.content?.path, sha: r.content?.sha, commit: r.commit?.sha, url: r.commit?.html_url });
    },
  );

  server.registerTool(
    'delete_file',
    {
      title: '删文件',
      description: '删除仓库中的文件并提交（需要文件的 sha）。',
      inputSchema: z.object({ ...repoArgs, path: z.string(), message: z.string(), branch: z.string().optional(), sha: z.string().optional() }),
    },
    async ({ owner, repo, path, message, branch, sha }) => {
      let current = sha;
      if (!current) {
        const q = branch ? `?ref=${encodeURIComponent(branch)}` : '';
        const data = await api('GET', `/repos/${owner}/${repo}/contents/${encodeURI(path)}${q}`);
        current = Array.isArray(data) ? undefined : data.sha;
      }
      if (!current) throw new Error(`${path} 不存在`);
      const body = { message, sha: current };
      if (branch) body.branch = branch;
      const r = await api('DELETE', `/repos/${owner}/${repo}/contents/${encodeURI(path)}`, body);
      return text({ deleted: path, commit: r.commit?.sha });
    },
  );

  server.registerTool(
    'list_branches',
    { title: '列分支', description: '列出仓库分支。', inputSchema: z.object(repoArgs) },
    async ({ owner, repo }) => {
      const bs = await api('GET', `/repos/${owner}/${repo}/branches?per_page=100`);
      return text(bs.map((b) => b.name));
    },
  );

  server.registerTool(
    'create_branch',
    {
      title: '建分支',
      description: '从某个分支（默认仓库默认分支）创建新分支，返回是否成功。',
      inputSchema: z.object({ ...repoArgs, branch: z.string(), from: z.string().optional() }),
    },
    async ({ owner, repo, branch, from }) => {
      let base = from;
      if (!base) base = (await api('GET', `/repos/${owner}/${repo}`)).default_branch;
      const ref = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
      const created = await api('POST', `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: ref.object.sha });
      return text({ branch, from: base, sha: created.object?.sha });
    },
  );

  server.registerTool(
    'list_issues',
    {
      title: '列 Issue',
      description: '列出仓库 Issue / PR（默认 open）。',
      inputSchema: z.object({
        ...repoArgs,
        state: z.enum(['open', 'closed', 'all']).optional(),
        per_page: z.number().int().min(1).max(100).optional(),
      }),
    },
    async ({ owner, repo, state = 'open', per_page = 20 }) => {
      const list = await api('GET', `/repos/${owner}/${repo}/issues?state=${state}&per_page=${per_page}`);
      return text(
        list.map((i) => ({ number: i.number, title: i.title, state: i.state, is_pr: !!i.pull_request, user: i.user?.login, comments: i.comments })),
      );
    },
  );

  server.registerTool(
    'create_issue',
    {
      title: '新建 Issue',
      description: '在仓库中创建 Issue。',
      inputSchema: z.object({ ...repoArgs, title: z.string(), body: z.string().optional(), labels: z.array(z.string()).optional() }),
    },
    async ({ owner, repo, title, body, labels }) => {
      const i = await api('POST', `/repos/${owner}/${repo}/issues`, { title, body, labels });
      return text({ number: i.number, url: i.html_url });
    },
  );

  server.registerTool(
    'comment_issue',
    {
      title: '回复 Issue/PR',
      description: '在 Issue 或 PR 下添加评论。',
      inputSchema: z.object({ ...repoArgs, number: z.number().int(), body: z.string() }),
    },
    async ({ owner, repo, number, body }) => {
      const c = await api('POST', `/repos/${owner}/${repo}/issues/${number}/comments`, { body });
      return text({ id: c.id, url: c.html_url });
    },
  );

  server.registerTool(
    'list_pulls',
    {
      title: '列 PR',
      description: '列出仓库 Pull Request。',
      inputSchema: z.object({ ...repoArgs, state: z.enum(['open', 'closed', 'all']).optional(), per_page: z.number().int().min(1).max(100).optional() }),
    },
    async ({ owner, repo, state = 'open', per_page = 20 }) => {
      const list = await api('GET', `/repos/${owner}/${repo}/pulls?state=${state}&per_page=${per_page}`);
      return text(list.map((p) => ({ number: p.number, title: p.title, state: p.state, head: p.head?.label, base: p.base?.label, user: p.user?.login })));
    },
  );

  server.registerTool(
    'create_pull',
    {
      title: '新建 PR',
      description: '创建 Pull Request（head 分支需已推送到仓库）。',
      inputSchema: z.object({
        ...repoArgs,
        title: z.string(),
        head: z.string().describe('源分支'),
        base: z.string().describe('目标分支，通常是 main'),
        body: z.string().optional(),
        draft: z.boolean().optional(),
      }),
    },
    async ({ owner, repo, title, head, base, body, draft }) => {
      const p = await api('POST', `/repos/${owner}/${repo}/pulls`, { title, head, base, body, draft });
      return text({ number: p.number, url: p.html_url, state: p.state });
    },
  );

  server.registerTool(
    'search_code',
    {
      title: '搜代码',
      description: '在 GitHub 上搜索代码（默认限定在某个仓库）。',
      inputSchema: z.object({ query: z.string(), owner: z.string().optional(), repo: z.string().optional() }),
    },
    async ({ query, owner, repo }) => {
      let q = query;
      if (owner && repo) q += ` repo:${owner}/${repo}`;
      const r = await api('GET', `/search/code?q=${encodeURIComponent(q)}&per_page=20`);
      return text({ total: r.total_count, items: (r.items || []).map((i) => ({ repo: i.repository?.full_name, path: i.path })) });
    },
  );
  // ---------- 私有仓库拉取 / 上传（git） ----------
  server.registerTool(
    'clone_repo',
    {
      title: '克隆仓库到本地',
      description:
        '把仓库（含私有仓库）克隆到本机工作区。path 省略时用仓库名；已存在同名目录会报错。返回本地路径与当前分支。',
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        path: z.string().optional().describe('本地目标目录（相对工作区 /root/workspace 或绝对路径）'),
        branch: z.string().optional(),
        depth: z.number().int().min(1).max(1000).optional().describe('浅克隆深度，省略=完整历史'),
      }),
    },
    async ({ owner, repo, path, branch, depth }) => {
      const target = localPath(path || repo);
      if (existsSync(target)) {
        const hasGit = existsSync(join(target, '.git'));
        throw new Error(`${target} 已存在${hasGit ? '（已是 git 仓库，可直接用 pull_repo）' : '，换个 path'}`);
      }
      const args = ['clone'];
      if (branch) args.push('--branch', branch);
      if (depth) args.push('--depth', String(depth));
      args.push(repoUrl(owner, repo), target);
      await git(WORKSPACE, args);
      const head = await git(target, ['rev-parse', '--short', 'HEAD']);
      const br = await git(target, ['rev-parse', '--abbrev-ref', 'HEAD']);
      const files = await git(target, ['ls-files']);
      return text({
        path: target,
        branch: br.out,
        head: head.out,
        files: files.out ? files.out.split('\n').length : 0,
        private_ok: true,
      });
    },
  );

  server.registerTool(
    'pull_repo',
    {
      title: '拉取最新代码',
      description: '在本地仓库执行 fetch + pull --ff-only。本地有未提交改动或分叉时不会强拉，会返回提示。',
      inputSchema: z.object({ path: z.string().describe('本地仓库目录') }),
    },
    async ({ path: p }) => {
      const target = localPath(p);
      if (!existsSync(join(target, '.git'))) throw new Error(`${target} 不是 git 仓库，先 clone_repo`);
      const before = (await git(target, ['rev-parse', '--short', 'HEAD'])).out;
      const branch = (await git(target, ['rev-parse', '--abbrev-ref', 'HEAD'])).out;
      const pull = await git(target, ['pull', '--ff-only'], { allowFail: true });
      const after = (await git(target, ['rev-parse', '--short', 'HEAD'])).out;
      if (!pull.ok) {
        return text({ path: target, branch, head: after, pulled: false, note: '拉取未完成（可能有本地改动或分支分叉）', detail: clip(pull.err) });
      }
      const log = await git(target, ['log', '--oneline', `${before}..${after}`], { allowFail: true });
      return text({ path: target, branch, head: after, pulled: before !== after, newCommits: log.ok ? log.out.split('\n').filter(Boolean) : [] });
    },
  );

  server.registerTool(
    'push_repo',
    {
      title: '提交并上传代码',
      description: '把本地改动 git add -A + commit + push 到 origin（自动设置 upstream）。没有改动时只报告已是最新。',
      inputSchema: z.object({
        path: z.string(),
        message: z.string().optional().describe('提交信息，默认 sync from DSH'),
        branch: z.string().optional().describe('推送到指定分支名（默认当前 HEAD）'),
      }),
    },
    async ({ path: p, message = 'sync from DSH', branch }) => {
      const target = localPath(p);
      if (!existsSync(join(target, '.git'))) throw new Error(`${target} 不是 git 仓库，先 clone_repo`);
      const id = await gitIdentity();
      const status = await git(target, ['status', '--porcelain']);
      const changed = status.out ? status.out.split('\n').filter(Boolean) : [];
      let commit = null;
      if (changed.length) {
        await git(target, ['add', '-A']);
        await git(target, ['-c', `user.name=${id.name}`, '-c', `user.email=${id.email}`, 'commit', '-m', message]);
        commit = (await git(target, ['rev-parse', '--short', 'HEAD'])).out;
      }
      const pushTarget = branch ? `refs/heads/${branch}:refs/heads/${branch}` : 'HEAD';
      const args = branch ? ['push', '-u', 'origin', pushTarget] : ['push', '-u', 'origin', 'HEAD'];
      const push = await git(target, args, { allowFail: true });
      if (!push.ok) throw new Error('推送失败：' + clip(push.err, 2000));
      const head = (await git(target, ['rev-parse', '--short', 'HEAD'])).out;
      const current = (await git(target, ['rev-parse', '--abbrev-ref', 'HEAD'])).out;
      return text({ path: target, branch: branch || current, head, commit, changedFiles: changed.length, push: clip(push.err || push.out, 1500) });
    },
  );

  server.registerTool(
    'repo_status',
    {
      title: '本地仓库状态',
      description: '查看本地仓库的分支、领先/落后远端数量、未提交改动。',
      inputSchema: z.object({ path: z.string() }),
    },
    async ({ path: p }) => {
      const target = localPath(p);
      if (!existsSync(join(target, '.git'))) throw new Error(`${target} 不是 git 仓库`);
      const branch = (await git(target, ['rev-parse', '--abbrev-ref', 'HEAD'])).out;
      const head = (await git(target, ['rev-parse', '--short', 'HEAD'])).out;
      const status = await git(target, ['status', '--porcelain']);
      const changed = status.out ? status.out.split('\n').filter(Boolean) : [];
      const ab = await git(target, ['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`], { allowFail: true });
      let ahead = null;
      let behind = null;
      if (ab.ok) {
        const [b, a] = ab.out.split(/\s+/).map(Number);
        ahead = a;
        behind = b;
      }
      return text({ path: target, branch, head, ahead, behind, dirty: changed.slice(0, 50), dirtyCount: changed.length });
    },
  );
}

serveStdio(() => {
  const server = new McpServer({ name: 'github', version: '1.0.0' }, { capabilities: { tools: {} } });
  register(server);
  return server;
});
