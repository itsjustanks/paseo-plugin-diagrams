import { defineRpc } from "@paseo/plugin/server";
import { z } from "zod";

/** A diagram HTML file discovered on the daemon machine. */
export const DiagramItem = z.object({
  path: z.string(),
  name: z.string(),
  /** Directory shown under the name, relative to its root where possible. */
  location: z.string(),
  bytes: z.number(),
  modifiedAt: z.string(),
  source: z.enum(["library", "workspace"]),
});

export type DiagramItem = z.output<typeof DiagramItem>;

export const listDiagrams = defineRpc({
  name: "diagrams.list",
  input: z.object({
    /** Workspace directory to scan in addition to the library. */
    directory: z.string().optional(),
  }),
  output: z.object({
    items: z.array(DiagramItem),
    libraryDir: z.string(),
    truncated: z.boolean(),
  }),
});

export const renderDiagram = defineRpc({
  name: "diagrams.render",
  input: z.object({
    path: z.string(),
    directory: z.string().optional(),
    width: z.number().int().min(320).max(4000),
    height: z.number().int().min(240).max(4000),
    scale: z.number().min(1).max(3),
  }),
  output: z.object({
    dataUri: z.string(),
    width: z.number(),
    height: z.number(),
    bytes: z.number(),
  }),
});

export const openDiagram = defineRpc({
  name: "diagrams.open",
  input: z.object({
    path: z.string(),
    directory: z.string().optional(),
  }),
  output: z.object({ detail: z.string() }),
});

/** Render presets offered in the panel. */
export const PRESETS = [
  { id: "wide", label: "Wide", width: 1600, height: 1000 },
  { id: "card", label: "Card", width: 1200, height: 630 },
  { id: "tall", label: "Tall", width: 1200, height: 1600 },
  { id: "square", label: "Square", width: 1400, height: 1400 },
] as const;

export type PresetId = (typeof PRESETS)[number]["id"];
