import type { PluginWorkspacePanelProps } from "@paseo/plugin";
import { useWorkspace } from "@paseo/plugin";
import React from "react";
import { DiagramBrowser } from "./browser.client";

export function DiagramsPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  return (
    <DiagramBrowser
      theme={theme}
      layout={layout}
      directory={directory ?? undefined}
      heading="Diagrams"
    />
  );
}
