#!/usr/bin/env node
/**
 * 场景：Agnx 子应用 artemis 的受管 sidecar 启动脚本。
 * 用法：node .agnx/tools/ensure-artemis.mjs --port 8130 --work-dir <dataRoot> [--supervised]
 * 输出（stdout 最后一行 JSON）：
 *   - 已就绪复用：{"ok":true,"reused":true,"origin":"http://127.0.0.1:8130","pid":N}
 *   - 需拉起：    {"ok":true,"reused":false,"plan":{command,args,cwd,env,fingerprint,healthUrl,port}}
 *
 * 上游启动命令（官方 CLI，不改一行上游代码）：
 *   <venv>/bin/python -m artemis ui --port 8130 --host 127.0.0.1 --no-open
 *   · --host / --port / --open 都是上游 `artemis ui` 自带的 typer 选项（artemis/interfaces/cli/commands/ui.py）
 *   · --no-open 关掉上游启动后自动拉系统浏览器（否则会把用户从 Tab 里带走）
 *
 * 上游端口/数据目录约定（全部是上游自己读的环境变量，依据 artemis/config/paths.py + constants.py）：
 *   ARTEMIS_APP_DIR        → app 目录（.env / 数据库 / IPC 文件都落这里）
 *   ARTEMIS_TRACES_DIR     → traces 目录（SQLite 库 traces/data_engine.db 就落这里）
 *   ARTEMIS_USE_USER_DIR   → 强制使用用户目录模式（源码 checkout 下默认写 repo 内）
 *   ARTEMIS_DISABLE_ORIGIN_GUARD=1 → 关掉上游 SameOriginBoundaryMiddleware 的 Origin 校验。
 *     必须开：父页是 http://localhost:<Agnx 端口>，iframe 内是 http://127.0.0.1:8130，
 *     上游对 WebSocket 升级请求同样校验 Origin（scope.type == "websocket" 走同一中间件），
 *     而 WS 的 Origin 是由浏览器强制写入父页原点的、不可伪造，不关就 1008 断开。
 *     这是上游官方提供的开关（apps/admin_console/core/security.py），不是我们的补丁。
 *
 * 上游 x-frame-options: DENY 问题由 .agnx/tools/embed-proxy.mjs 处理（见 EMBED.md）。
 */
import { spawn } from "node:child_process";
import { access, constants as fsConstants, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const APP_ID = "artemis";
const STATE_FILE = "artemis.json";
const DEFAULT_PORT = 8130;
const UPSTREAM_REL = path.join(".agnx", "upstream");
const VENV_PY_REL = path.join(".agnx", "venv", "bin", "python");
const PROXY_REL = path.join(".agnx", "tools", "embed-proxy.mjs");
// 端口三角（与 manifest.sidecar 一致，改任一处必须同步改另一处）：
//   manifest.sidecar.defaultPort = 8135 → 交给宿主当 iframe origin（= 本反代）
//   manifest.sidecar.extraPorts  = [8130] → 上游 uvicorn 裸端口（带 X-Frame-Options: DENY，宿主不直连）
//   --port 参数（面板传 8130）= 上游裸端口；反代始终转发到它
const PROXY_PORT = 8135;

function parseArgs(argv) {
  const out = {
    port: Number(process.env.ARTEMIS_PORT ?? DEFAULT_PORT),
    workDir: process.env.AGNX_APP_DATA_ROOT || "",
    supervised: false,
    forceRestart: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--port" && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) out.port = n;
      i += 1;
    } else if ((arg === "--work-dir" || arg === "--workDir") && next) {
      out.workDir = String(next).trim();
      i += 1;
    } else if (arg === "--supervised") {
      out.supervised = true;
    } else if (arg === "--force-restart") {
      out.forceRestart = true;
    }
  }
  return out;
}

async function exists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function statePath(workDir) {
  return path.join(workDir, STATE_FILE);
}

async function readState(workDir) {
  try {
    return JSON.parse(await readFile(statePath(workDir), "utf8"));
  } catch {
    return null;
  }
}

function healthOnce(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthOnce(url)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** 数据根：宿主注入 --work-dir；缺失就是宿主协议不一致，必须显式报错，不能瞎写到 repo 里。 */
function resolveWorkDir(args) {
  if (!args.workDir) return null;
  return path.resolve(args.workDir);
}

function buildEnv(workDir, port) {
  const appDir = path.join(workDir, "app");
  const tracesDir = path.join(workDir, "traces");
  const home = path.join(workDir, "home");
  const tmp = path.join(workDir, "tmp");
  return {
    // 上游自己读的重定向变量
    ARTEMIS_APP_DIR: appDir,
    ARTEMIS_TRACES_DIR: tracesDir,
    ARTEMIS_USE_USER_DIR: "true",
    // 关掉上游 Origin 强校验（父页 origin ≠ 127.0.0.1:8130，浏览器 WS 无法带对 Origin）
    ARTEMIS_DISABLE_ORIGIN_GUARD: "1",
    // 宿主里不要自动拉系统浏览器（这里再双保险，CLI 已带 --no-open）
    BROWSER: "/usr/bin/true",
    // HOME/XDG 重定向：adbutils/uiautomator2 会写缓存、uv 也可能读 HOME
    HOME: home,
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    TMPDIR: tmp,
    PYTHONUNBUFFERED: "1",
    PYTHONIOENCODING: "utf-8",
    ARTEMIS_PORT: String(port),
    PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
  };
}

function fingerprintOf(port, workDir) {
  return createHash("sha256").update(`${APP_ID}:${port}:${workDir}`).digest("hex").slice(0, 16);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = args.port;
  // 上游裸 origin（内部健康检查用）——它带 x-frame-options: DENY，绝不能交给宿主当 iframe 地址
  const upstreamOrigin = `http://127.0.0.1:${port}`;
  // 交给宿主的 origin 必须是反代端口：反代剥掉 x-frame-options，iframe 才能渲染
  const origin = `http://127.0.0.1:${PROXY_PORT}`;
  // 上游没有 /health，用 readiness 做就绪探针（apps/admin_console/routers/system.py: /api/system/readiness）
  const healthUrl = `${upstreamOrigin}/api/system/readiness`;

  const workDir = resolveWorkDir(args);
  if (!workDir) {
    console.error("ENSURE_MISSING_DATA_ROOT: 需要 --work-dir 或 AGNX_APP_DATA_ROOT");
    process.exit(2);
  }
  await mkdir(workDir, { recursive: true });
  for (const sub of ["app", "traces", "home", "tmp"]) {
    await mkdir(path.join(workDir, sub), { recursive: true });
  }

  const upstreamRoot = path.join(repoRoot, UPSTREAM_REL);
  const venvPython = path.join(repoRoot, VENV_PY_REL);
  if (!(await exists(upstreamRoot))) {
    console.error(`ENSURE_UPSTREAM_MISSING: ${upstreamRoot}`);
    process.exit(3);
  }
  if (!(await exists(venvPython))) {
    console.error(`ENSURE_VENV_MISSING: ${venvPython}（先跑 .agnx/tools/install-artemis.mjs）`);
    process.exit(3);
  }
  const proxyScript = path.join(repoRoot, PROXY_REL);
  if (!(await exists(proxyScript))) {
    console.error(`ENSURE_PROXY_MISSING: ${proxyScript}`);
    process.exit(3);
  }

  const env = buildEnv(workDir, port);
  const fingerprint = fingerprintOf(port, workDir);
  const runtimeDir = path.join(repoRoot, ".agnx-runtime");
  await mkdir(runtimeDir, { recursive: true });
  const logFile = path.join(runtimeDir, `${APP_ID}.log`);

  // 1) 上游已就绪 → 只补反代（可能上一次反代先挂了）
  const upstreamReady = await healthOnce(healthUrl);
  if (upstreamReady) {
    const state = await readState(workDir);
    const proxy = await ensureProxy(proxyScript, repoRoot, PROXY_PORT, port, env, runtimeDir);
    console.log(
      JSON.stringify({ ok: true, reused: true, origin, pid: state?.pid ?? null, port, proxy }),
    );
    return;
  }

  if (args.supervised) {
    // 只输出 plan，交给 daemon supervisor 拉起（它负责 pid / 日志 / 退出清理）
    console.log(
      JSON.stringify({
        ok: true,
        reused: false,
        plan: {
          command: venvPython,
          args: [
            "-m",
            "artemis",
            "ui",
            "--port",
            String(port),
            "--host",
            "127.0.0.1",
            "--no-open",
          ],
          cwd: upstreamRoot,
          env,
          fingerprint,
          healthUrl,
          port,
          logFile,
        },
      }),
    );
    return;
  }

  // 2) 短跑模式：自己 spawn（stdio 重定向到日志文件，绝不用 pipe）
  const fs = await import("node:fs");
  const out = fs.openSync(logFile, "a");
  const child = spawn(
    venvPython,
    ["-m", "artemis", "ui", "--port", String(port), "--host", "127.0.0.1", "--no-open"],
    {
      cwd: upstreamRoot,
      env: { ...process.env, ...env },
      detached: true,
      stdio: ["ignore", out, out],
    },
  );
  child.unref();

  const ok = await waitForHealth(healthUrl, 240_000);
  if (!ok) {
    console.error(`ENSURE_HEALTH_TIMEOUT: ${healthUrl}（日志：${logFile}）`);
    process.exit(4);
  }
  const proxy = await ensureProxy(proxyScript, repoRoot, PROXY_PORT, port, env, runtimeDir);
  await writeFile(
    statePath(workDir),
    JSON.stringify({ appId: APP_ID, port, pid: child.pid, fingerprint, logFile, proxy }, null, 2),
    "utf8",
  );
  console.log(JSON.stringify({ ok: true, reused: false, origin, pid: child.pid, port, proxy }));
}

/**
 * 反代进程（处理上游 x-frame-options: DENY）。已就绪则复用，否则拉起并等它健康。
 * 反代挂在 8135（manifest.sidecar.extraPorts），确保宿主清场时能一并看到。
 */
async function ensureProxy(proxyScript, cwd, proxyPort, upstreamPort, env, runtimeDir) {
  const proxyHealthUrl = `http://127.0.0.1:${proxyPort}/__agnx_proxy_health`;
  if (await healthOnce(proxyHealthUrl)) {
    return { ok: true, reused: true, port: proxyPort };
  }
  const fs = await import("node:fs");
  const logFile = path.join(runtimeDir, `${APP_ID}-proxy.log`);
  const out = fs.openSync(logFile, "a");
  const child = spawn(
    process.execPath,
    [proxyScript, "--port", String(proxyPort), "--upstream", String(upstreamPort)],
    {
      cwd,
      env: { ...process.env, ...env },
      detached: true,
      stdio: ["ignore", out, out],
    },
  );
  child.unref();
  const ok = await waitForHealth(proxyHealthUrl, 15_000);
  if (!ok) {
    console.error(`ENSURE_PROXY_TIMEOUT: ${proxyHealthUrl}（日志：${logFile}）`);
    process.exit(5);
  }
  return { ok: true, reused: false, port: proxyPort, pid: child.pid };
}

main().catch((err) => {
  console.error(`ENSURE_FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
