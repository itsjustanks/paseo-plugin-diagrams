import type { PluginTheme } from "@paseo/plugin";
import { usePaseo, useRpc } from "@paseo/plugin";
import { useMutation, useQuery } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Item, PresetId } from "./items.shared";
import {
  listItems,
  openItem,
  PRESETS,
  renderItem,
  shareItem,
  shareStatus,
  stopShare,
} from "./items.shared";

type Layout = { compact: boolean; platform: "ios" | "android" | "web" };

/** Match a drawn workflow to the Paseo theme instead of asking the user. */
function isDarkSurface(hex: string): boolean {
  const value = hex.replace("#", "");
  if (value.length < 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  if ([r, g, b].some(Number.isNaN)) return false;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

function keyOf(item: Item | null): string {
  if (!item) return "";
  return item.ref.kind === "workflow-instance" ? `n8n:${item.ref.id}` : item.ref.path;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function makeStyles(theme: PluginTheme, compact: boolean) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    header: { paddingHorizontal: compact ? 16 : 24, paddingTop: compact ? 12 : 16, paddingBottom: 8, gap: 2 },
    title: { color: theme.colors.foreground, fontSize: compact ? 18 : 20, fontWeight: "600" },
    subtitle: { color: theme.colors.foregroundMuted, fontSize: 12 },
    body: { flex: 1, flexDirection: compact ? "column" : "row" },
    listColumn: {
      width: compact ? undefined : 300,
      flex: compact ? 1 : undefined,
      borderRightWidth: compact ? 0 : StyleSheet.hairlineWidth,
      borderRightColor: theme.colors.foregroundMuted,
    },
    listContent: { padding: compact ? 12 : 16, gap: 8 },
    row: {
      padding: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.foregroundMuted,
      gap: 2,
    },
    rowSelected: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    rowTitle: { color: theme.colors.foreground, fontSize: 14, fontWeight: "500" },
    rowTitleSelected: { color: theme.colors.accentForeground },
    rowDetail: { color: theme.colors.foregroundMuted, fontSize: 12 },
    rowDetailSelected: { color: theme.colors.accentForeground, opacity: 0.85 },
    viewer: { flex: 1 },
    toolbar: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: compact ? 12 : 16,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.foregroundMuted,
    },
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.foregroundMuted,
    },
    chipActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    chipText: { color: theme.colors.foregroundMuted, fontSize: 12 },
    chipTextActive: { color: theme.colors.accentForeground, fontSize: 12 },
    stage: { flex: 1 },
    stageContent: { padding: compact ? 12 : 16, gap: 12 },
    centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
    bodyText: { color: theme.colors.foreground, fontSize: 14, textAlign: "center" },
    mutedText: { color: theme.colors.foregroundMuted, fontSize: 12, textAlign: "center" },
    error: { color: theme.colors.statusDanger, fontSize: 13 },
    caption: { color: theme.colors.foregroundMuted, fontSize: 11 },
    linkBox: {
      padding: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.accent,
      gap: 6,
    },
    linkUrl: { color: theme.colors.foreground, fontSize: 13, fontWeight: "500" },
  });
}

function Chip({
  label,
  active,
  onPress,
  styles,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, active ? styles.chipActive : null]}
    >
      <Text style={active ? styles.chipTextActive : styles.chipText}>{label}</Text>
    </Pressable>
  );
}

export function PreviewBrowser({
  theme,
  layout,
  directory,
  heading,
  agentId,
}: {
  theme: PluginTheme;
  layout: Layout;
  directory?: string;
  heading: string;
  /** Present in an agent panel, which is what makes "Send to chat" possible. */
  agentId?: string;
}) {
  const compact = layout.compact;
  const styles = useMemo(() => makeStyles(theme, compact), [theme, compact]);

  const list = useRpc(listItems);
  const render = useRpc(renderItem);
  const share = useRpc(shareItem);
  const open = useRpc(openItem);
  const status = useRpc(shareStatus);
  const stop = useRpc(stopShare);
  const paseo = usePaseo();

  const [selected, setSelected] = useState<Item | null>(null);
  const [preset, setPreset] = useState<PresetId>("wide");
  const [scale, setScale] = useState(compact ? 1 : 2);
  const [dark, setDark] = useState(() => isDarkSurface(theme.colors.surface0));
  const [stageWidth, setStageWidth] = useState(0);

  const catalog = useQuery({
    queryKey: ["preview", "list", directory ?? "library"],
    queryFn: () => list({ directory }),
    staleTime: 10_000,
  });

  const size = PRESETS.find((entry) => entry.id === preset) ?? PRESETS[0];
  const isWorkflow = selected?.kind === "workflow";
  const key = keyOf(selected);

  const image = useQuery({
    queryKey: ["preview", "render", key, preset, scale, dark],
    queryFn: () =>
      render({
        ref: selected!.ref,
        directory,
        width: isWorkflow ? undefined : size.width,
        height: isWorkflow ? undefined : size.height,
        scale,
        dark,
      }),
    enabled: selected !== null,
    staleTime: Infinity,
    retry: false,
  });

  const sharing = useQuery({
    queryKey: ["preview", "share-status"],
    queryFn: () => status({}),
    staleTime: 5_000,
  });

  const startShare = useMutation({
    mutationFn: () => share({ ref: selected!.ref, directory, dark }),
    onSuccess: () => void sharing.refetch(),
  });
  const endShare = useMutation({
    mutationFn: () => stop({}),
    onSuccess: () => {
      startShare.reset();
      void sharing.refetch();
    },
  });
  const openTarget = useMutation({
    mutationFn: () => open({ ref: selected!.ref, directory }),
  });

  /**
   * Post the rendered picture into the agent's conversation. Paseo accepts
   * base64 images on a message, so the chart lands in chat rather than staying
   * trapped in this panel - and the agent can see what it drew.
   */
  const sendToChat = useMutation({
    mutationFn: async () => {
      const rendered =
        image.data ??
        (await render({
          ref: selected!.ref,
          directory,
          width: isWorkflow ? undefined : size.width,
          height: isWorkflow ? undefined : size.height,
          scale,
          dark,
        }));
      const base64 = rendered.dataUri.split(",")[1] ?? "";
      await paseo.agents.ref(agentId!).send(selected!.name, {
        images: [{ data: base64, mimeType: "image/png" }],
      });
      return rendered.bytes;
    },
  });

  const items = catalog.data?.items ?? [];
  const instance = catalog.data?.instance;
  const showList = !compact || selected === null;
  const showViewer = !compact || selected !== null;

  const listView = (
    <ScrollView style={styles.listColumn} contentContainerStyle={styles.listContent}>
      {catalog.isPending ? <ActivityIndicator color={theme.colors.accent} /> : null}
      {catalog.isError ? <Text style={styles.error}>{messageOf(catalog.error)}</Text> : null}
      {instance?.error ? <Text style={styles.error}>n8n: {instance.error}</Text> : null}
      {!catalog.isPending && items.length === 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.bodyText}>Nothing to preview yet.</Text>
          <Text style={styles.mutedText}>
            Diagram HTML goes in {catalog.data?.diagramDir}.{"\n"}
            Workflow JSON goes in {catalog.data?.workflowDir}.
          </Text>
        </View>
      ) : null}
      {items.map((item) => {
        const id = keyOf(item);
        const active = key === id;
        return (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Open ${item.name}`}
            onPress={() => setSelected(item)}
            style={[styles.row, active ? styles.rowSelected : null]}
          >
            <Text numberOfLines={1} style={[styles.rowTitle, active ? styles.rowTitleSelected : null]}>
              {item.name}
            </Text>
            <Text numberOfLines={1} style={active ? styles.rowDetailSelected : styles.rowDetail}>
              {item.kind === "workflow" ? "workflow" : "diagram"} · {item.origin}
              {item.location === "." ? "" : ` · ${item.location}`}
            </Text>
            <Text style={active ? styles.rowDetailSelected : styles.rowDetail}>
              {item.nodeCount !== null ? `${item.nodeCount} nodes` : null}
              {item.nodeCount !== null && item.bytes !== null ? " · " : null}
              {item.bytes !== null ? formatBytes(item.bytes) : null}
              {item.active === null ? "" : item.active ? " · active" : " · inactive"}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const aspect = image.data && image.data.width > 0 ? image.data.height / image.data.width : 0.625;
  const drawWidth = stageWidth > 0 ? stageWidth : 320;
  const shared = startShare.data;
  const opened = openTarget.data;

  const viewerView = (
    <View style={styles.viewer}>
      <View style={styles.toolbar}>
        {compact && selected ? (
          <Chip label="‹ All" active={false} onPress={() => setSelected(null)} styles={styles} />
        ) : null}
        {selected && !isWorkflow
          ? PRESETS.map((entry) => (
              <Chip
                key={entry.id}
                label={entry.label}
                active={entry.id === preset}
                onPress={() => setPreset(entry.id)}
                styles={styles}
              />
            ))
          : null}
        {selected && isWorkflow ? (
          <Chip label={dark ? "Dark" : "Light"} active={dark} onPress={() => setDark(!dark)} styles={styles} />
        ) : null}
        <Chip
          label={scale === 1 ? "1x" : "2x"}
          active={scale === 2}
          onPress={() => setScale(scale === 1 ? 2 : 1)}
          styles={styles}
        />
        <Chip label="Refresh" active={false} onPress={() => void image.refetch()} styles={styles} />
        {selected ? (
          <Chip
            label={isWorkflow ? "Link to n8n" : "Open here"}
            active={false}
            onPress={() => openTarget.mutate()}
            styles={styles}
          />
        ) : null}
        {selected && agentId ? (
          <Chip
            label={sendToChat.isPending ? "Sending…" : "Send to chat"}
            active={false}
            onPress={() => sendToChat.mutate()}
            styles={styles}
          />
        ) : null}
        {selected ? (
          <Chip
            label={startShare.isPending ? "Sharing…" : "Share"}
            active={false}
            onPress={() => startShare.mutate()}
            styles={styles}
          />
        ) : null}
        {sharing.data?.active ? (
          <Chip label="Stop sharing" active={false} onPress={() => endShare.mutate()} styles={styles} />
        ) : null}
      </View>

      <ScrollView
        style={styles.stage}
        contentContainerStyle={styles.stageContent}
        onLayout={(event) => setStageWidth(event.nativeEvent.layout.width - (compact ? 24 : 32))}
      >
        {!selected ? (
          <View style={styles.centered}>
            <Text style={styles.mutedText}>Pick something to preview.</Text>
          </View>
        ) : null}
        {selected && image.isFetching ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.mutedText}>Rendering {selected.name}…</Text>
          </View>
        ) : null}
        {selected && image.isError && !image.isFetching ? (
          <View style={styles.centered}>
            <Text style={styles.error}>{messageOf(image.error)}</Text>
          </View>
        ) : null}
        {selected && image.data && !image.isFetching ? (
          <>
            <Image
              accessibilityLabel={selected.name}
              source={{ uri: image.data.dataUri }}
              style={{ width: drawWidth, height: drawWidth * aspect, borderRadius: 8 }}
              resizeMode="contain"
            />
            <Text style={styles.caption}>
              {selected.name}
              {image.data.nodeCount !== null ? ` · ${image.data.nodeCount} nodes` : ""} ·{" "}
              {image.data.width}×{image.data.height}px · {formatBytes(image.data.bytes)}
            </Text>
          </>
        ) : null}

        {sendToChat.isError ? <Text style={styles.error}>{messageOf(sendToChat.error)}</Text> : null}
        {sendToChat.isSuccess ? (
          <Text style={styles.caption}>Sent to this agent's chat as an image.</Text>
        ) : null}
        {openTarget.isError ? <Text style={styles.error}>{messageOf(openTarget.error)}</Text> : null}
        {opened ? (
          <View style={styles.linkBox}>
            <Text style={styles.caption}>{opened.detail}</Text>
            {opened.url ? (
              <Text selectable style={styles.linkUrl}>
                {opened.url}
              </Text>
            ) : null}
          </View>
        ) : null}

        {startShare.isError ? <Text style={styles.error}>{messageOf(startShare.error)}</Text> : null}
        {shared ? (
          <View style={styles.linkBox}>
            <Text selectable style={styles.linkUrl}>
              {shared.url}
            </Text>
            <Text style={styles.caption}>
              {shared.reach === "tunnel" ? `via ${shared.provider}` : "loopback only"} — {shared.note}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{heading}</Text>
        <Text numberOfLines={1} style={styles.subtitle}>
          {items.length} item{items.length === 1 ? "" : "s"}
          {instance?.configured && instance.host ? ` · ${instance.host}` : " · local files only"}
        </Text>
      </View>
      <View style={styles.body}>
        {showList ? listView : null}
        {showViewer ? viewerView : null}
      </View>
    </View>
  );
}
