#!/usr/bin/env node
/**
 * 场景：Artemis 嵌入反代 —— 只为解决「上游拒绝被 iframe 嵌入」这一件事。
 *
 * 为什么必须有它（见 EMBED.md「挂载」与「宿主能力缺口」）：
 *   上游 apps/admin_console/core/security.py 的 SameOriginBoundaryMiddleware 对**所有** http 响应
 *   追加 `x-frame-options: DENY`（_SECURITY_HEADERS 常量）。父页是 Agnx（http://localhost:<宿主端口>），
 *   上游是 http://127.0.0.1:8130，跨源；带 DENY 的响应在 Chromium 里直接渲染成 "refused to connect"，
 *   面板里就是一片空白。上游没有「允许嵌入」的开关，也不该为嵌页改上游源码。
 *   → 同源反代：宿主 iframe 只认 http://127.0.0.1:8135，文档与 /api 同源，
 *     反代转发时剥掉 x-frame-options、把 COOP 降为 same-origin-allow-popups。
 *
 * 硬约束（照 SKILL §5.2）：
 *   · 转发必须删 `Origin`（上游会把跨源 Origin 判 403），Host 改写成上游 host，accept-encoding: identity。
 *   · 不注入桥、不写任何存储 —— 本子应用不需要跨源状态记忆（上游自己的数据在服务端）。
 *   · 只监听 127.0.0.1，端口由 ensure 脚本给（8135，与 manifest.sidecar.extraPorts 一致）。
 */
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function parseArgs(argv) {
  const out = { port: 8135, upstreamPort: 8130 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--port" && next) {
      out.port = Number(next);
      i += 1;
    } else if (arg === "--upstream" && next) {
      out.upstreamPort = Number(next);
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const UPSTREAM_HOST = "127.0.0.1";
const UPSTREAM_PORT = args.upstreamPort;

/** 这些响应头会让浏览器拒绝跨源嵌入 / 拆掉同源关系，必须改写。 */
const DROP_RESPONSE_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "transfer-encoding",
  "connection",
]);

/** 转发到上游前必须剥掉 / 改写的请求头。 */
function buildUpstreamHeaders(incoming) {
  const headers = {};
  for (const [key, value] of Object.entries(incoming)) {
    const k = key.toLowerCase();
    if (k === "origin" || k === "referer") continue; // 上游见 Origin 就 403
    if (k === "host") continue;
    if (k === "accept-encoding") continue; // 用 identity，避免上游 gzip 后再改头出错
    if (k === "connection" || k === "keep-alive" || k === "proxy-connection") continue;
    headers[key] = value;
  }
  headers.host = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`;
  headers["accept-encoding"] = "identity";
  return headers;
}

function filterResponseHeaders(rawHeaders) {
  const out = {};
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i];
    const lower = name.toLowerCase();
    if (DROP_RESPONSE_HEADERS.has(lower)) continue;
    const value = rawHeaders[i + 1];
    if (out[name] === undefined) out[name] = value;
    else if (Array.isArray(out[name])) out[name].push(value);
    else out[name] = [out[name], value];
  }
  // 明确声明「允许被本机同源框架嵌入」，替掉上游的 DENY。
  out["x-frame-options"] = "";
  return out;
}

const server = http.createServer((req, res) => {
  // 反代自身的健康探针（不转发），只给 ensure 脚本用。
  if (req.url === "/__agnx_proxy_health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, upstreamPort: UPSTREAM_PORT }));
    return;
  }

  const proxyReq = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers: buildUpstreamHeaders(req.headers),
    },
    (proxyRes) => {
      const headers = filterResponseHeaders(proxyRes.rawHeaders);
      // 空值表示「删掉这个头」，Node 对 '' 会直接发 `x-frame-options: `，
      // 浏览器把空值视为未设置；这里显式 delete 更干净。
      delete headers["x-frame-options"];
      delete headers["X-Frame-Options"];
      res.writeHead(proxyRes.statusCode ?? 502, headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end(`AGNX_PROXY_UPSTREAM_ERROR: ${err.message}`);
  });
  req.pipe(proxyReq);
});

// WebSocket（上游 /api/stream 等 WS 端点）+ 普通 TCP 升级：只做字节级透传，不做协议解析。
server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      const lower = name.toLowerCase();
      if (lower === "host") {
        lines.push(`Host: ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
        continue;
      }
      if (lower === "origin" || lower === "referer") continue;
      lines.push(`${name}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head && head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(args.port, "127.0.0.1", () => {
  console.log(
    `[artemis-proxy] listening on http://127.0.0.1:${args.port} → http://${UPSTREAM_HOST}:${UPSTREAM_PORT} (cwd=${repoRoot})`,
  );
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
