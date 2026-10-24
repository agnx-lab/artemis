/**
 * 场景：Artemis 子应用常量。appId / panelId / 端口 / ensure 路径的唯一出处。
 * 端口 8130 为批次台账独占分配（避免 6767 daemon / 3054 Bridge / 9333 CDP / 8081 Metro / 8120-8127 / 3000-3001 / 3011，实测 lsof 空闲）。
 * 上游默认端口是 8000，本子应用通过 `artemis ui --port <port>` 显式改端口，属上游官方启动参数，不改上游代码。
 */
export const ARTEMIS_APP_ID = "artemis";
export const ARTEMIS_PANEL_ID = "artemis.main";
export const ARTEMIS_OPEN_COMMAND_ID = "artemis.open";
export const ARTEMIS_ENSURE_TOOL_REL = ".agnx/tools/ensure-artemis.mjs";
export const ARTEMIS_DEFAULT_PORT = 8130;
