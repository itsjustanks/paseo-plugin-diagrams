import { defineRpc } from "@paseo/plugin/server";
import { z } from "zod";

/**
 * Three things this plugin can draw: a self-contained HTML diagram, an n8n
 * workflow exported to JSON, and a workflow living on an n8n instance.
 */
export const ItemRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("html"), path: z.string() }),
  z.object({ kind: z.literal("workflow-file"), path: z.string() }),
  z.object({ kind: z.literal("workflow-instance"), id: z.string() }),
]);

export type ItemRef = z.output<typeof ItemRef>;

export const Item = z.object({
  ref: ItemRef,
  name: z.string(),
  location: z.string(),
  kind: z.enum(["diagram", "workflow"]),
  origin: z.enum(["library", "workspace", "instance"]),
  bytes: z.number().nullable(),
  nodeCount: z.number().nullable(),
  updatedAt: z.string().nullable(),
  active: z.boolean().nullable(),
  /** Deep link into the n8n editor, when we can work one out. */
  editorUrl: z.string().nullable(),
});

export type Item = z.output<typeof Item>;

export const listItems = defineRpc({
  name: "preview.list",
  input: z.object({ directory: z.string().optional() }),
  output: z.object({
    items: z.array(Item),
    diagramDir: z.string(),
    workflowDir: z.string(),
    instance: z.object({
      configured: z.boolean(),
      host: z.string().nullable(),
      error: z.string().nullable(),
    }),
  }),
});

export const renderItem = defineRpc({
  name: "preview.render",
  input: z.object({
    ref: ItemRef,
    directory: z.string().optional(),
    /** Canvas size for HTML diagrams. Workflows size themselves. */
    width: z.number().int().min(320).max(4000).optional(),
    height: z.number().int().min(240).max(4000).optional(),
    scale: z.number().min(1).max(3),
    dark: z.boolean(),
  }),
  output: z.object({
    dataUri: z.string(),
    width: z.number(),
    height: z.number(),
    bytes: z.number(),
    nodeCount: z.number().nullable(),
  }),
});

export const shareItem = defineRpc({
  name: "preview.share",
  input: z.object({
    ref: ItemRef,
    directory: z.string().optional(),
    dark: z.boolean(),
  }),
  output: z.object({
    url: z.string(),
    reach: z.enum(["tunnel", "local"]),
    provider: z.string(),
    note: z.string(),
  }),
});

export const shareStatus = defineRpc({
  name: "preview.share-status",
  input: z.object({}),
  output: z.object({
    active: z.boolean(),
    url: z.string().nullable(),
    reach: z.enum(["tunnel", "local"]).nullable(),
    provider: z.string().nullable(),
    published: z.array(z.string()),
  }),
});

export const stopShare = defineRpc({
  name: "preview.share-stop",
  input: z.object({}),
  output: z.object({ detail: z.string() }),
});

export const openItem = defineRpc({
  name: "preview.open",
  input: z.object({ ref: ItemRef, directory: z.string().optional() }),
  output: z.object({ detail: z.string(), url: z.string().nullable() }),
});

export const PRESETS = [
  { id: "wide", label: "Wide", width: 1600, height: 1000 },
  { id: "card", label: "Card", width: 1200, height: 630 },
  { id: "tall", label: "Tall", width: 1200, height: 1600 },
  { id: "square", label: "Square", width: 1400, height: 1400 },
] as const;

export type PresetId = (typeof PRESETS)[number]["id"];
