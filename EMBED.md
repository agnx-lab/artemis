## 上游嵌入

- 上游：`google/artemis`（Apache-2.0，★13.7k，Python）
- **上游原生平台**：桌面 ❌ ｜ 网页 ✅ ｜ 移动 **partial**
  - 网页 ✅：上游自带 `artemis ui` 命令起 **FastAPI + Angular** 单端口 Web 控制台（设备连接向导、实时投屏、提示沙箱、执行回放），
    落点 `apps/admin_console/`（FastAPI，`server.py`）+ `apps/showcase_ui/`（Angular，`npm run build` 产物）。
    依据：`start.sh` 末尾 `exec uv run python -m artemis ui`，README 写明 `http://localhost:8000`。
  - 桌面 ❌：仓库无 Electron / Tauri / 系统托盘等桌面壳工程。本子应用在桌面 Tab 里嵌的是它的**网页形态**，不是桌面端。
  - 移动 **partial**：`packages/artemis-accessibility-helper` 是**真实 Android APK 工程**（真机上跑的无障碍辅助端），
    但它不是「可嵌入的移动 UI」——它是被 Web 工作台通过 adb 驱动的辅助端。
    按 skill §9.1，「上游有移动形态」成立，但「有可嵌的移动 UI」不成立，故取 `partial` 而非 `supported`。

- **工作方式**：**原样嵌入（首选路线）**。不 patch 上游 Python、不 fork、不改 Angular 源码。
  - 启动走上游官方 CLI `artemis ui`，端口 / 绑定地址 / 是否自动开浏览器全部用**上游自带的 typer 选项**注入：
    `--port` / `--host` / `--no-open`（依据 `artemis/interfaces/cli/commands/ui.py`）。
  - 数据目录用上游自己读的环境变量 `ARTEMIS_APP_DIR` / `ARTEMIS_TRACES_DIR` 指到本子应用 data root。

- **上游改动清单**：**无源码改动**。有两处**上游官方提供的开关**被我们打开（不是补丁）：
  1. `ARTEMIS_DISABLE_ORIGIN_GUARD=1` —— 关掉上游 `SameOriginBoundaryMiddleware` 的 Origin 校验。
     原因：父页是 `http://localhost:<Agnx端口>`，iframe 内是 `http://127.0.0.1:8135`，跨源；
     上游对 **WebSocket 升级**请求同样校验 Origin（`scope.type == "websocket"` 走同一中间件），
     而浏览器强制写入的 WS Origin 不可伪造，不关就是 1008 断开。
     依据：`apps/admin_console/core/security.py` 里该开关由上游自己实现。
  2. `--no-open` —— 关掉上游启动后自动拉系统浏览器（否则会把用户从 Tab 里带走）。

- **挂载**：`guest.kind=web`、`guest.auth=none`、`preferStrategy=auto` → 实际 **`direct-iframe`**（`http://127.0.0.1:8135`）。

> **端口分工（重要）**：**8135 是子应用侧反代**（`embed-proxy.mjs`，剥 `x-frame-options`），**8130 是上游 uvicorn 裸端口**。
> 面板必须嵌 **8135**，不能嵌 8130 —— 8130 带 `X-Frame-Options: DENY`，浏览器会拒绝。
  - 上游主控制台带 `X-Frame-Options: DENY`，跨源 iframe 会被浏览器拒掉。
    处置放在 **`.agnx/tools/embed-proxy.mjs`**：由子应用侧薄反代剥掉该响应头，**不动上游 Python**。
  - 这属于「宿主能力缺口」而不是「上游缺陷」，见下方缺口表第 1 行。

- **上游**：`google/artemis` @ **`351ca8422f7b5b54e80a9c1ce03a222e02415b6b`**（`main`，提交时间 2026-09-29T00:29:02Z）
  - 取得方式：`codeload.github.com/google/artemis/tar.gz/refs/heads/main` + GitHub API 探 `/commits/main` 拿 SHA。
  - 许可：**Apache-2.0**（上游 `LICENSE`）。

### 面板与 Tab

| 面板 id | 名字 | 走 `targetUrl` 还是 `ensureTool` |
| --- | --- | --- |
| `artemis.main` | Artemis | `ensureTool` = `.agnx/tools/ensure-artemis.mjs`（拉起上游 `artemis ui` 后取 origin） |

### 真实启动命令（本机实测，可复现）

**落位路径**（tarball 下载后已从 `/tmp/artemis-work/` 迁入正式位置，`/tmp` 已不再依赖）：

| 件 | 绝对路径 |
| --- | --- |
| 上游源码 | `~/.agnx-dev/apps/artemis/.agnx/upstream/` |
| Python venv | `~/.agnx-dev/apps/artemis/.agnx/venv/`（Python 3.12.12，958MB） |
| Angular 构建产物 | `.agnx/upstream/apps/showcase_ui/dist/frontend/browser/`（`index.html` + `main-F2RQQJSW.js` 1.40MB） |
| 运行数据 | `~/.agnx-dev/apps/data/artemis/{app,traces,home,tmp}/`（SQLite 库在 `traces/data_engine.db`） |
| 运行日志 | `~/.agnx-dev/apps/artemis/.agnx-runtime/{artemis.log,artemis-proxy.log}` |

**A. 换机首次安装**（一次性；上游源码 + 依赖 + Angular 构建）

```bash
cd ~/.agnx-dev/apps/artemis
node .agnx/tools/install-artemis.mjs
```

**B. 宿主调用路径**（宿主自己会跑这条，`--supervised` 下只输出 plan 交给 supervisor 拉起）

```bash
cd ~/.agnx-dev/apps/artemis
node .agnx/tools/ensure-artemis.mjs --port 8130 --work-dir ~/.agnx-dev/apps/data/artemis --supervised
```

**C. 本机手动复现**（不经宿主，直接验证上游 + 反代都能起）

```bash
# 1) 拉起上游 + 反代，返回发给宿主的 origin
cd ~/.agnx-dev/apps/artemis
node .agnx/tools/ensure-artemis.mjs --port 8130 --work-dir ~/.agnx-dev/apps/data/artemis
# 实测输出：
# {"ok":true,"reused":false,"origin":"http://127.0.0.1:8135","pid":81517,"port":8130,
#  "proxy":{"ok":true,"reused":false,"port":8135,"pid":82019}}

# 2) 验证端口
lsof -nP -iTCP:8130 -sTCP:LISTEN   # python3.1x  → 上游 uvicorn
lsof -nP -iTCP:8135 -sTCP:LISTEN   # node        → embed-proxy

# 3) 验证嵌入头被剥（8130 有 DENY / 8135 没有）
curl -sS -D - -o /dev/null http://127.0.0.1:8130/ | grep -i x-frame   # x-frame-options: DENY
curl -sS -D - -o /dev/null http://127.0.0.1:8135/ | grep -iE "^HTTP|x-frame"  # 仅 HTTP/1.1 200 OK

# 4) 验证上游真在服务
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8135/api/system/readiness   # 200
```

ensure 实际 spawn 的上游命令（不改一行上游代码）：

```bash
<venv>/bin/python -m artemis ui --port 8130 --host 127.0.0.1 --no-open
```

ensure 注入的上游环境变量（全部是上游 `artemis/config/paths.py` + `core/security.py` 自己读的）：

| 变量 | 值 | 作用 |
| --- | --- | --- |
| `ARTEMIS_APP_DIR` | `<dataRoot>/app` | app 目录（`.env` 等） |
| `ARTEMIS_TRACES_DIR` | `<dataRoot>/traces` | traces 目录（SQLite 库落这里） |
| `ARTEMIS_USE_USER_DIR` | `true` | 强制用户目录模式，不写 repo 内 |
| `ARTEMIS_DISABLE_ORIGIN_GUARD` | `1` | 关上游 Origin 强校验（WS 升级靠它） |
| `BROWSER` / `--no-open` | `/usr/bin/true` | 禁止自动拉系统浏览器 |
| `HOME` / `XDG_*` / `TMPDIR` | `<dataRoot>/{home,tmp}/...` | 缓存与临时文件重定向 |

### 首次安装踩到的坑（真实记录）

1. **github.com 直连超时**（`git clone` 75s 失败）→ 改用 `codeload.github.com` 的 `main` tarball，23.6MB 正常。
2. **Angular CLI 要 Node ≥ v22.22.3，本机是 v22.22.1**（`ng build` 直接 exit 3）。
   → 用 nvm 里已有的 **Node v24.21.0** 构建（`PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"`），构建成功。
3. **`opencv-python==5.0.0.93`（uv.lock 锁的版本）没有 macOS x86_64 wheel**，从源码编译时
   撞 FFmpeg 头文件 API 不兼容：`error: no member named 'pix_fmts' in 'AVCodec'`。
   → `uv sync` 受 `uv.lock` 硬锁、`UV_CONSTRAINT` 对已锁版本不生效；
   改用 `uv pip install --python .agnx/venv/bin/python -e .` 走 `pyproject.toml` 约束（`opencv-python>=4.9.0.80`），
   落到有预编译 wheel 的 **4.11.0.86**。**未改上游 `pyproject.toml` / `uv.lock`。**
4. **pypi.org 间歇性 `tls handshake eof`** → 用 `UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple` 装完 196 个包。
5. **venv 迁移后 editable 安装指向旧 `/tmp` 路径** → 在新位置 `uv pip install --no-deps -e . -e packages/artemis-client` 重装修复，并批量修 `venv/bin/*` 的 shebang。

### 验收证据

- **桌面 Tab 截图**（本机实测，`logs/artemis-desktop-accept.png`）：
  Agnx 桌面端 Tab 内完整渲染上游 Showcase UI 主页 —— 顶部 `New / Home` 切换、
  任务输入框「What would you like to do on your phone?」、Flash / Pro 档位、
  Recommended Tasks 卡片（Maps / Gmail + Calendar），全部是上游真实 Angular 界面，非自画平行 UI。
- **嵌入链路实测**（复现命令 + 真实输出）：
  - 裸端口带 DENY：`curl -sS -D - -o /dev/null http://127.0.0.1:8130/ | grep -i x-frame`
    → `x-frame-options: DENY`
  - 走反代被剥：`curl -sS -D - -o /dev/null http://127.0.0.1:8135/ | grep -iE "^HTTP|x-frame"`
    → 仅 `HTTP/1.1 200 OK`（无 x-frame-options）
- **设备态（上游真实空态，非伪造）**：本机 adb 无设备连接。
  - 上游 readiness API 实测：`curl http://127.0.0.1:8135/api/system/readiness`
    → `active_device = None`、设备探针 `summary = "No Device Found"`；
  - 前端对应分支：`home.component.html` 的 `STATE B-3: NO DEVICE DETECTED / READY TO CONNECT GUIDE`，
    页面顶部横幅「Prerequisites incomplete: runtime, credentials, or Android device is not ready」即截图所见。
  - 按验收约定，空设备态可接受；接上设备后同一面板即可看到真实投屏。

- **桌面验收截图**：`logs/artemis-desktop-accept.png`、`logs/artemis-desktop-1792683548538.png`

## 嵌页宿主能力缺口

| 上游能力 | 信号位置 | 嵌后风险 | 处置 (A–E) | 主路径 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `X-Frame-Options: DENY` | 上游 admin_console 响应头 | 跨源 iframe 被浏览器拒绝加载 | A（子应用侧薄反代剥头） | direct-iframe 经 `embed-proxy.mjs` | 不动上游 Python |
| WebSocket Origin 校验 | `apps/admin_console/core/security.py` | WS 升级 1008 断开 | B（用上游官方开关 `ARTEMIS_DISABLE_ORIGIN_GUARD=1`） | 环境变量注入 | 上游自带，非补丁 |
| adb / Android 设备 | 上游 `adbutils` 设备子系统 | 无设备时面板为空态 | D（如实呈现上游空态） | 接设备后自动可用 | 不伪造设备 |
| 上游启动后拉系统浏览器 | `artemis ui` 默认行为 | 把用户从 Tab 带走 | B（`--no-open`） | 上游自带选项 | — |
| 上游重依赖（opencv 5.0.0.93 无 macOS x86_64 wheel） | `pyproject.toml` / `uv.lock` | `uv sync` 走源码编译，撞 FFmpeg `pix_fmts` 报错，装不下来 | C（安装脚本改用 `uv pip install -e .` 走 pyproject 约束，落到有 wheel 的 `opencv-python==4.11.0.86`） | `install-artemis.mjs` | 不改上游 pyproject/uv.lock；已实测装成 |

## 已知缺口

| # | 缺口 | 影响 | 处置 |
| --- | --- | --- | --- |
| G1 | 上游 `opencv-python==5.0.0.93` 无 macOS x86_64 wheel，源码编译撞 FFmpeg `AVCodec.pix_fmts` 报错 | `uv sync` 直接失败，上游起不来 | 安装脚本改走 `uv pip install -e .`，落 `4.11.0.86` 预编译 wheel；**未改上游文件** |
| G2 | Angular CLI 需 Node ≥ v22.22.3，本机默认 v22.22.1 | `ng build` exit 3，首页只剩「UI not built」提示页 | 构建时切 nvm 的 **v24.21.0**；换机需保证 Node ≥22.22.3 |
| G3 | 本机 adb 无设备连接 | 看不到实时投屏 / 真实任务执行 | 如实呈现上游空态（`active_device=None`、`No Device Found`）；接设备后自动可用 |
| G4 | LLM 凭证缺失（readiness 显示 `Key Missing`） | 无法发起真实任务执行 | 上游正常行为；属用户需自行配置的 API key，非嵌页问题 |
| G5 | venv 958MB + 上游含 `node_modules`(283MB) | 换机需重装，不能随仓库分发 | `install-artemis.mjs` 一键重建；`.agnx/upstream` 与 `.agnx/venv` 属可再生件 |
| G6 | `x-frame-options: DENY` 依赖子应用侧反代绕过 | 反代进程若被杀，Tab 会白屏 | ensure 每次都会补拉反代（`ensureProxy`）；宿主清场能看到 8130+8135 两口 |

---

宿主 commit：`f3b5da6c94eca748ea16a1571b716f1dac99ae48`
