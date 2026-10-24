var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// .agnx/src/index.ts
var index_exports = {};
__export(index_exports, {
  activate: () => activate,
  appId: () => appId,
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);

// .agnx/src/constants.ts
var ARTEMIS_APP_ID = "artemis";
var ARTEMIS_PANEL_ID = "artemis.main";
var ARTEMIS_OPEN_COMMAND_ID = "artemis.open";
var ARTEMIS_ENSURE_TOOL_REL = ".agnx/tools/ensure-artemis.mjs";
var ARTEMIS_DEFAULT_PORT = 8130;

// .agnx/src/panel.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var WEB_ROOT_STYLE = {
  flex: "1 1 0%",
  alignSelf: "stretch",
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  position: "relative"
};
var GUEST_HOST_STYLE = {
  flex: "1 1 auto",
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  position: "relative"
};
var LAYER = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  display: "flex",
  flexDirection: "column",
  background: "rgb(9,9,11)"
};
var ERROR_BOX = { padding: 24, color: "#fca5a5", fontSize: 13, lineHeight: 1.6 };
var boundHost = null;
function bindArtemisHost(host2) {
  boundHost = host2;
}
function host() {
  if (!boundHost) throw new Error("Artemis host \u672A\u7ED1\u5B9A");
  return boundHost;
}
function ArtemisPanel() {
  const guestHostRef = (0, import_react.useRef)(null);
  const [booting, setBooting] = (0, import_react.useState)(true);
  const [error, setError] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    const h = host();
    h.background?.requestRetain?.({
      appId: ARTEMIS_APP_ID,
      active: true,
      reason: "artemis-open"
    });
    return () => {
      h.background?.requestRetain?.({
        appId: ARTEMIS_APP_ID,
        active: false,
        reason: "artemis-open"
      });
    };
  }, []);
  (0, import_react.useEffect)(() => {
    const h = host();
    if (!h.guest?.mount || !guestHostRef.current) {
      setBooting(false);
      setError("\u5BBF\u4E3B\u672A\u63D0\u4F9B host.guest.mount\uFF08\u9700\u5347\u7EA7 Agnx \u5E76\u91CD\u65B0\u626B\u63CF\u5B50\u5E94\u7528\uFF09");
      return;
    }
    let cancelled = false;
    const unmount = h.guest.mount({
      container: guestHostRef.current,
      ensureTool: ARTEMIS_ENSURE_TOOL_REL,
      ensureArgs: ["--port", String(ARTEMIS_DEFAULT_PORT)],
      timeoutMs: 3e5,
      surfaceReadyTimeoutMs: 12e4,
      bootOverlay: false,
      onReady: () => {
        if (cancelled) return;
        window.setTimeout(() => {
          if (!cancelled) setBooting(false);
        }, 400);
      },
      onError: (d) => {
        if (cancelled) return;
        setBooting(false);
        setError(`${d.code}: ${d.message}`);
      }
    });
    return () => {
      cancelled = true;
      unmount?.();
    };
  }, []);
  const BrandPanel = host().ui?.BrandLogoLoaderPanel;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: WEB_ROOT_STYLE, "data-testid": `workspace-mini-app-${ARTEMIS_APP_ID}-root`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { ref: guestHostRef, "data-agnx-guest-surface-host": "true", style: GUEST_HOST_STYLE }),
    booting && !error && BrandPanel ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { "data-agnx-guest-boot-overlay": "true", style: LAYER, role: "status", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BrandPanel, { title: "\u6B63\u5728\u542F\u52A8 Artemis\u2026", testID: "artemis-boot-overlay" }) }) : null,
    error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...LAYER, overflow: "auto" }, role: "alert", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: ERROR_BOX, children: error }) }) : null
  ] });
}

// .agnx/src/index.ts
var appId = ARTEMIS_APP_ID;
function activate(host2) {
  bindArtemisHost(host2);
  const disposers = [];
  disposers.push(
    host2.registerMiniApp({
      id: ARTEMIS_PANEL_ID,
      appId: ARTEMIS_APP_ID,
      title: "Artemis",
      component: ArtemisPanel,
      primaryPanel: true,
      iframeShortcutCapture: true
    })
  );
  disposers.push(
    host2.registerCommand({
      id: ARTEMIS_OPEN_COMMAND_ID,
      appId: ARTEMIS_APP_ID,
      title: "Artemis",
      keywords: ["artemis", "android", "\u624B\u673A", "\u81EA\u52A8\u5316", "\u6D4B\u8BD5", "device"],
      sidebarAction: { defaultVisible: true, label: "Artemis", order: 71 },
      run: (context) => {
        host2.openSubAppTab({
          appId: ARTEMIS_APP_ID,
          panelId: ARTEMIS_PANEL_ID,
          serverId: context?.serverId,
          workspaceId: context?.workspaceId,
          currentPathname: context?.currentPathname
        });
      }
    })
  );
  return () => {
    for (const d of disposers.toReversed()) d();
  };
}
var moduleExport = { appId: ARTEMIS_APP_ID, activate };
var index_default = moduleExport;
