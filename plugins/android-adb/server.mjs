#!/usr/bin/env node
// Android adb MCP server (stdio): install APKs on the phone, launch, logcat, screenshot.
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, statSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { isAbsolute, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = process.env.ADB_WORKSPACE || process.env.GITHUB_WORKSPACE || '/root/workspace';
const ADB = process.env.ADB_BIN || 'adb';

const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const clip = (s, n = 6000) => (s.length > n ? s.slice(0, n) + `\n…（已截断，共 ${s.length} 字符）` : s);

function localPath(p) {
  return isAbsolute(p) ? p : resolve(WORKSPACE, p);
}

async function adb(args, { allowFail = false, timeout = 240000 } = {}) {
  try {
    const { stdout, stderr } = await exec(ADB, args, { timeout, maxBuffer: 32 * 1024 * 1024 });
    return { ok: true, out: (stdout || '').trim(), err: (stderr || '').trim() };
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim() || String(e.message);
    if (allowFail) return { ok: false, out: '', err: out };
    throw new Error('adb ' + args.join(' ') + ' 失败：' + clip(out, 2000));
  }
}

async function ensureDevice() {
  await adb(['start-server'], { allowFail: true });
  const r = await adb(['devices']);
  const lines = r.out.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  const online = lines.filter((l) => /\bdevice$/.test(l)).map((l) => l.split(/\s+/)[0]);
  if (!online.length) {
    const detail = lines.length ? lines.join('; ') : '没有已连接设备';
    throw new Error(
      `没有可用的手机连接（${detail}）。无线调试需要手机连着 WiFi 才能打开；无法用 adb 时可以先 stage_apk 把包放进下载目录，手动点装。`,
    );
  }
  return online[0];
}

function register(server) {
  server.registerTool(
    'adb_devices',
    {
      title: '看设备连接',
      description: '列出 adb 已连接设备；没有设备时给出开启无线调试的提示。',
    },
    async () => {
      await adb(['start-server'], { allowFail: true });
      const r = await adb(['devices', '-l']);
      const lines = r.out.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
      return text(lines.length ? lines : '没有已连接设备：先在手机开启「开发者选项 → 无线调试」');
    },
  );

  server.registerTool(
    'adb_pair',
    {
      title: '配对无线调试',
      description: '用手机上「无线调试 → 使用配对码配对设备」显示的端口和 6 位配对码配对一次。',
      inputSchema: z.object({
        port: z.number().int().describe('配对端口（配对弹窗里显示的那个，不是主端口）'),
        code: z.string().describe('6 位配对码'),
        host: z.string().optional().describe('默认 127.0.0.1'),
      }),
    },
    async ({ port, code, host = '127.0.0.1' }) => {
      const r = await adb(['pair', `${host}:${port}`, String(code)], { allowFail: true });
      const ok = /Successfully paired/i.test(r.out + r.err);
      if (!ok) throw new Error('配对失败：' + clip(r.out + r.err, 1000));
      return text({ paired: true, host, port });
    },
  );

  server.registerTool(
    'adb_connect',
    {
      title: '连接设备',
      description: '连接「无线调试」主端口（配对后才有意义）。省略 port 时尝试常见的 5555。',
      inputSchema: z.object({ port: z.number().int().optional(), host: z.string().optional() }),
    },
    async ({ port = 5555, host = '127.0.0.1' }) => {
      const r = await adb(['connect', `${host}:${port}`], { allowFail: true });
      const out = (r.out + r.err).trim();
      if (!/connected/i.test(out)) throw new Error('连接失败：' + clip(out, 800) + '（确认无线调试开着，端口是最新显示的那个）');
      const d = await adb(['devices']);
      return text({ connected: `${host}:${port}`, devices: d.out });
    },
  );

  server.registerTool(
    'stage_apk',
    {
      title: '把 APK 放到手机下载目录',
      description: '不需要设备连接：把工作区里的 APK 复制到 /sdcard/Download/DSH-Go/，用户在文件管理器点一下即可安装（无 WiFi 时的兜底）。',
      inputSchema: z.object({
        path: z.string().optional().describe('APK 路径，相对 /root/workspace；默认 OrbitEdge 的 release 包'),
        name: z.string().optional().describe('目标文件名（不含 .apk），默认沿用原文件名'),
      }),
    },
    async ({ path, name }) => {
      const apk = localPath(path || 'OrbitEdge/app/build/outputs/apk/release/app-release.apk');
      if (!existsSync(apk)) throw new Error(`找不到 APK：${apk}`);
      const outDir = '/sdcard/Download/DSH-Go';
      mkdirSync(outDir, { recursive: true });
      const target = join(outDir, `${name || apk.split('/').pop().replace(/\.apk$/i, '')}.apk`);
      copyFileSync(apk, target);
      let info = {};
      try {
        const a = await exec('aapt', ['dump', 'badging', apk], { timeout: 30000 });
        info = {
          package: (a.stdout.match(/package: name='([^']+)'/) || [])[1],
          versionName: (a.stdout.match(/versionName='([^']+)'/) || [])[1],
          versionCode: (a.stdout.match(/versionCode='(\d+)'/) || [])[1],
        };
      } catch {}
      return text({ staged: target, mb: Math.round((statSync(target).size / 1048576) * 10) / 10, ...info });
    },
  );

  server.registerTool(
    'install_apk',
    {
      title: '安装 APK',
      description: '把工作区里的 APK 装到手机（覆盖安装），可选装完直接启动。默认取 OrbitEdge 的 release 包。',
      inputSchema: z.object({
        path: z.string().optional().describe('APK 路径，相对 /root/workspace 或绝对路径'),
        launch: z.boolean().optional().describe('装完是否启动，默认 true'),
        downgrade: z.boolean().optional().describe('允许降级安装，默认 false'),
      }),
    },
    async ({ path, launch = true, downgrade = false }) => {
      const apk = localPath(
        path || 'OrbitEdge/app/build/outputs/apk/release/app-release.apk',
      );
      if (!existsSync(apk)) throw new Error(`找不到 APK：${apk}`);
      const size = statSync(apk).size;
      await ensureDevice();
      const args = ['install', '-r'];
      if (downgrade) args.push('-d');
      args.push(apk);
      const r = await adb(args, { allowFail: true });
      const out = (r.out + '\n' + r.err).trim();
      if (!/Success/i.test(out)) throw new Error('安装失败：' + clip(out, 2000));

      let pkg = null;
      try {
        const aapt = await exec('aapt2', ['dump', 'badging', apk], { timeout: 30000 });
        pkg = (aapt.stdout.match(/package: name='([^']+)'/) || [])[1] || null;
      } catch {}
      if (!pkg) {
        try {
          const a = await exec('aapt', ['dump', 'badging', apk], { timeout: 30000 });
          pkg = (a.stdout.match(/package: name='([^']+)'/) || [])[1] || null;
        } catch {}
      }

      let launched = false;
      if (launch && pkg) {
        const l = await adb(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], { allowFail: true });
        launched = /Events injected/.test(l.out + l.err);
      }
      return text({ apk, mb: Math.round((size / 1048576) * 10) / 10, package: pkg, installed: true, launched, adb: clip(out, 400) });
    },
  );

  server.registerTool(
    'app_info',
    {
      title: '看已装版本',
      description: '查手机上某个包的版本号与安装时间（确认装的是不是最新那个）。',
      inputSchema: z.object({ package: z.string() }),
    },
    async ({ package: pkg }) => {
      await ensureDevice();
      const r = await adb(['shell', 'dumpsys', 'package', pkg], { allowFail: true });
      if (!r.ok || !r.out) throw new Error(`没查到 ${pkg}，可能没装`);
      const ver = (r.out.match(/versionName=([^\s]+)/) || [])[1];
      const code = (r.out.match(/versionCode=(\d+)/) || [])[1];
      const first = (r.out.match(/firstInstallTime=([^\n]+)/) || [])[1];
      return text({ package: pkg, versionName: ver, versionCode: code, firstInstallTime: first?.trim(), installed: /Package \[/.test(r.out) });
    },
  );

  server.registerTool(
    'launch_app',
    {
      title: '启动/停止 App',
      description: '启动或强制停止某个包。',
      inputSchema: z.object({ package: z.string(), stop: z.boolean().optional() }),
    },
    async ({ package: pkg, stop = false }) => {
      await ensureDevice();
      if (stop) {
        await adb(['shell', 'am', 'force-stop', pkg]);
        return text({ package: pkg, stopped: true });
      }
      const r = await adb(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], { allowFail: true });
      const ok = /Events injected/.test(r.out + r.err);
      if (!ok) throw new Error('启动失败：' + clip(r.out + r.err, 800));
      return text({ package: pkg, launched: true });
    },
  );

  server.registerTool(
    'uninstall_app',
    { title: '卸载 App', description: '卸载某个包（危险操作）。', inputSchema: z.object({ package: z.string() }) },
    async ({ package: pkg }) => {
      await ensureDevice();
      const r = await adb(['uninstall', pkg], { allowFail: true });
      const out = (r.out + r.err).trim();
      if (!/Success/i.test(out)) throw new Error('卸载失败：' + clip(out, 800));
      return text({ package: pkg, uninstalled: true });
    },
  );

  server.registerTool(
    'logcat',
    {
      title: '看日志',
      description: '抓最近的 logcat（可过滤包名/关键字），用于排查 App 崩溃。',
      inputSchema: z.object({
        lines: z.number().int().min(1).max(2000).optional(),
        filter: z.string().optional().describe('grep 关键字，比如包名或 FATAL EXCEPTION'),
        clear: z.boolean().optional().describe('先清空再抓'),
      }),
    },
    async ({ lines = 200, filter, clear = false }) => {
      await ensureDevice();
      if (clear) await adb(['logcat', '-c'], { allowFail: true });
      const r = await adb(['logcat', '-d', '-t', String(lines)], { allowFail: true });
      let out = r.out || r.err;
      if (filter) out = out.split('\n').filter((l) => l.includes(filter)).join('\n');
      return text(out ? clip(out) : '没有日志');
    },
  );

  server.registerTool(
    'screenshot',
    {
      title: '手机截图',
      description: '截图并保存到工作区，返回路径（可直接给用户看）。',
      inputSchema: z.object({ path: z.string().optional() }),
    },
    async ({ path }) => {
      await ensureDevice();
      const target = localPath(path || join('generated', `screenshot-${Date.now()}.png`));
      mkdirSync(dirname(target), { recursive: true });
      const { stdout } = await exec(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' });
      writeFileSync(target, stdout);
      return text({ path: target, bytes: stdout.length });
    },
  );

  server.registerTool(
    'adb_shell',
    {
      title: '执行 adb shell',
      description: '直接跑一条 adb shell 命令（调试用，可用于 am/pm/dumpsys 等）。',
      inputSchema: z.object({ command: z.string() }),
    },
    async ({ command }) => {
      await ensureDevice();
      const r = await adb(['shell', command], { allowFail: true });
      return text(clip((r.out || '') + (r.err ? '\n' + r.err : '')) || '（无输出）');
    },
  );
}

serveStdio(() => {
  const server = new McpServer({ name: 'adb', version: '1.0.0' }, { capabilities: { tools: {} } });
  register(server);
  return server;
});
