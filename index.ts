import type { PluginContext } from "@paseo/plugin";
import { handleOpen, handleRender, handleShare } from "./handlers.server";
import {
  listItems,
  openItem,
  renderItem,
  shareItem,
  shareStatus,
  stopShare,
} from "./items.shared";
import { PreviewLibrary } from "./library.client";
import { PreviewPanel } from "./panel.client";
import { status, stop } from "./share.server";
import { listAll } from "./sources.server";

export default function contribute(plugin: PluginContext) {
  plugin.handle(listItems, ({ directory }) => listAll(directory));
  plugin.handle(renderItem, handleRender);
  plugin.handle(shareItem, handleShare);
  plugin.handle(openItem, handleOpen);
  plugin.handle(shareStatus, () => status());
  plugin.handle(stopShare, () => stop());

  plugin.addSurface("library", PreviewLibrary);
  plugin.addSidebarItem({
    id: "library",
    title: "Diagrams",
    icon: "Shapes",
    surface: "library",
  });

  plugin.addWorkspacePanel({
    id: "diagrams",
    title: "Diagrams",
    icon: "Shapes",
    context: "workspace",
    Component: PreviewPanel,
  });

  plugin.addCommandCenterItem({
    id: "open-diagrams",
    title: "Open diagrams and workflows",
    icon: "Shapes",
    keywords: ["diagram", "chart", "svg", "n8n", "workflow"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("diagrams");
    },
  });

  // Never leave a tunnel or listener behind when the plugin stops.
  return () => stop();
}
