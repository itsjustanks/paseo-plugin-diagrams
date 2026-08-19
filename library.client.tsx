import type { PluginSurfaceProps } from "@paseo/plugin";
import React from "react";
import { PreviewBrowser } from "./browser.client";

export function PreviewLibrary({ theme, layout }: PluginSurfaceProps) {
  return <PreviewBrowser theme={theme} layout={layout} heading="Diagrams" />;
}
