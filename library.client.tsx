import type { PluginSurfaceProps } from "@paseo/plugin";
import React from "react";
import { DiagramBrowser } from "./browser.client";

export function DiagramLibrary({ theme, layout }: PluginSurfaceProps) {
  return <DiagramBrowser theme={theme} layout={layout} heading="Diagram library" />;
}
