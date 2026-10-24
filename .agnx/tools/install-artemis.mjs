#!/usr/bin/env node
/**
 * 场景：Agnx 子应用 artemis 的首次安装脚本（一次性，可重复执行）。
 * 做四件事：
 *   1) 下载上游源码 tarball（codeload.github.com，github.com 直连在本机超时）到 .agnx/upstream
 *   2) 用 uv 建独立 venv 并 uv sync（Python 3.12，上游 requires-python >=3.12）
 *   3) npm ci + npm run build 编译上游 Angular showcase_ui（上游 `artemis ui` 的首页就是它）
 *   4) 自检：venv python 可 import artemis、showcase dist 里 index.html 存在
 *
 * 不改上游任何一行源码；上游目录内产生的 node_modules / dist / .venv / traces 都是原生气味。
 * 用法：node .agnx/tools/install-artemis.mjs [--skip-build]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, access, constants as fsConstants } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const UPSTREAM_DIR = path.join(repoRoot, ".agnx", "upstream");
const VENV_DIR = path.join(repoRoot, ".agnx", "venv");
const SHOWCASE = path.join(UPSTREAM_DIR, "apps", "showcase_ui");
const TARBALL_URL = "https://codeload.github.com/google/artemis/tar.gz/refs/heads/main";
const PY = "/usr/local/bin/python3.12";

const skipBuild = process.argv.includes("--skip-build");

function run(cmd, args, opts = {}) {
  console.log(`[install] $ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) {
    console.error(`[install] 失败：${cmd} ${args.join(" ")}（exit=${r.status}）`);
    process.exit(r.status ?? 1);
  }
}

async function exists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // 1) 上游源码
  if (await exists(path.join(UPSTREAM_DIR, "pyproject.toml"))) {
    console.log(`[install] 上游已存在，跳过下载：${UPSTREAM_DIR}`);
  } else {
    await mkdir(path.dirname(UPSTREAM_DIR), { recursive: true });
    const tmp = mkdtempSync(path.join(tmpdir(), "artemis-src-"));
    const tgz = path.join(tmp, "artemis-main.tgz");
    run("curl", ["-sS", "-L", "--max-time", "300", "-o", tgz, TARBALL_URL]);
    run("tar", ["xzf", tgz, "-C", tmp]);
    const extracted = existsSync(path.join(tmp, "artemis-main"))
      ? path.join(tmp, "artemis-main")
      : null;
    if (!extracted) throw new Error(`tarball 解包后找不到 artemis-main：${tmp}`);
    if (existsSync(UPSTREAM_DIR)) rmSync(UPSTREAM_DIR, { recursive: true, force: true });
    run("mv", [extracted, UPSTREAM_DIR]);
    rmSync(tmp, { recursive: true, force: true });
    console.log(`[install] 上游落盘：${UPSTREAM_DIR}`);
  }

  // 2) Python venv + uv sync（venv 放 .agnx/venv，不污染上游目录）
  if (!existsSync(path.join(VENV_DIR, "bin", "python"))) {
    if (!existsSync(PY)) throw new Error(`找不到 ${PY}（上游 requires-python>=3.12）`);
    run("uv", ["venv", "--python", PY, VENV_DIR]);
  } else {
    console.log(`[install] venv 已存在：${VENV_DIR}`);
  }
  run("uv", ["sync", "--no-dev", "--active"], {
    cwd: UPSTREAM_DIR,
    env: { ...process.env, VIRTUAL_ENV: VENV_DIR, UV_PROJECT_ENVIRONMENT: VENV_DIR },
  });

  // 3) 编译 Angular showcase_ui（上游首页）
  if (skipBuild) {
    console.log("[install] --skip-build：跳过 Angular 构建");
  } else if (existsSync(path.join(SHOWCASE, "dist", "frontend", "browser", "index.html"))) {
    console.log("[install] showcase_ui dist 已存在，跳过构建");
  } else {
    run("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=warn"], { cwd: SHOWCASE });
    run("npm", ["run", "build"], { cwd: SHOWCASE });
  }

  // 4) 自检
  const venvPython = path.join(VENV_DIR, "bin", "python");
  run(venvPython, ["-c", "import artemis, apps.admin_console.server as s; print('artemis import OK', artemis.__file__)"], {
    cwd: UPSTREAM_DIR,
  });
  const indexPath = path.join(SHOWCASE, "dist", "frontend", "browser", "index.html");
  if (!(await exists(indexPath))) throw new Error(`showcase UI 未构建：${indexPath}`);
  console.log(`[install] 完成：showcase = ${indexPath}`);
}

main().catch((err) => {
  console.error(`[install] 失败：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
