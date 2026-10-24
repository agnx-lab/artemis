/**
 * 场景：Artemis 子应用入口 —— 注册一个主面板（= 一类 Tab）+ 一个打开命令。
 * 上游 google/artemis 的原生形态是 FastAPI + Angular 的单端口 Web 控制台，故只有一张「控制台」Tab。
 */
import type { WorkspaceAppHostApi, WorkspaceAppModule } from "@agnx-lab/app-sdk";
import { ARTEMIS_APP_ID, ARTEMIS_OPEN_COMMAND_ID, ARTEMIS_PANEL_ID } from "./constants";
import { ArtemisPanel, bindArtemisHost } from "./panel";

export const appId = ARTEMIS_APP_ID;

export function activate(host: WorkspaceAppHostApi): () => void {
  bindArtemisHost(host);

  const disposers: Array<() => void> = [];

  disposers.push(
    host.registerMiniApp({
      id: ARTEMIS_PANEL_ID,
      appId: ARTEMIS_APP_ID,
      title: "Artemis",
      component: ArtemisPanel,
      primaryPanel: true,
      iframeShortcutCapture: true,
    }),
  );

  disposers.push(
    host.registerCommand({
      id: ARTEMIS_OPEN_COMMAND_ID,
      appId: ARTEMIS_APP_ID,
      title: "Artemis",
      keywords: ["artemis", "android", "手机", "自动化", "测试", "device"],
      sidebarAction: { defaultVisible: true, label: "Artemis", order: 71 },
      run: (context) => {
        host.openSubAppTab({
          appId: ARTEMIS_APP_ID,
          panelId: ARTEMIS_PANEL_ID,
          serverId: context?.serverId,
          workspaceId: context?.workspaceId,
          currentPathname: context?.currentPathname,
        });
      },
    }),
  );

  return () => {
    for (const d of disposers.toReversed()) d();
  };
}

const moduleExport: WorkspaceAppModule = { appId: ARTEMIS_APP_ID, activate };
export default moduleExport;
