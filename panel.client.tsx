import type { PluginWorkspacePanelProps } from "@paseo/plugin";
import { useWorkspace } from "@paseo/plugin";
import React from "react";
import { PreviewBrowser } from "./browser.client";

export function PreviewPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  return (
    <PreviewBrowser
      theme={theme}
      layout={layout}
      directory={directory ?? undefined}
      heading="Diagrams"
    />
  );
}
