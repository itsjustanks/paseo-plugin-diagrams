import type { PluginContext } from "@paseo/plugin";
import { handleList, handleOpen, handleRender } from "./diagrams.server";
import { listDiagrams, openDiagram, renderDiagram } from "./diagrams.shared";
import { DiagramLibrary } from "./library.client";
import { DiagramsPanel } from "./panel.client";

export default function contribute(plugin: PluginContext) {
  plugin.handle(listDiagrams, handleList);
  plugin.handle(renderDiagram, handleRender);
  plugin.handle(openDiagram, handleOpen);

  plugin.addSurface("library", DiagramLibrary);
  plugin.addSidebarItem({
    id: "library",
    title: "Diagrams",
    icon: "Shapes",
    surface: "library",
  });

  plugin.addWorkspacePanel({
    id: "diagrams",
    title: "Diagrams",
    icon: "Workflow",
    context: "workspace",
    Component: DiagramsPanel,
  });

  plugin.addCommandCenterItem({
    id: "open-diagrams",
    title: "Open diagrams",
    icon: "Workflow",
    keywords: ["chart", "diagram", "svg", "render"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("diagrams");
    },
  });

  return () => {};
}
