import type { PluginTheme } from "@paseo/plugin";
import { useRpc } from "@paseo/plugin";
import { useMutation, useQuery } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { DiagramItem, PresetId } from "./diagrams.shared";
import { listDiagrams, openDiagram, PRESETS, renderDiagram } from "./diagrams.shared";

type Layout = { compact: boolean; platform: "ios" | "android" | "web" };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function makeStyles(theme: PluginTheme, compact: boolean) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    header: {
      paddingHorizontal: compact ? 16 : 24,
      paddingTop: compact ? 12 : 16,
      paddingBottom: 8,
      gap: 2,
    },
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
    error: { color: theme.colors.statusDanger, fontSize: 13, textAlign: "center" },
    caption: { color: theme.colors.foregroundMuted, fontSize: 11 },
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

export function DiagramBrowser({
  theme,
  layout,
  directory,
  heading,
}: {
  theme: PluginTheme;
  layout: Layout;
  directory?: string;
  heading: string;
}) {
  const compact = layout.compact;
  const styles = useMemo(() => makeStyles(theme, compact), [theme, compact]);

  const list = useRpc(listDiagrams);
  const render = useRpc(renderDiagram);
  const open = useRpc(openDiagram);

  const [selected, setSelected] = useState<DiagramItem | null>(null);
  const [preset, setPreset] = useState<PresetId>("wide");
  const [scale, setScale] = useState(compact ? 1 : 2);
  const [stageWidth, setStageWidth] = useState(0);

  const catalog = useQuery({
    queryKey: ["diagrams", "list", directory ?? "library"],
    queryFn: () => list({ directory }),
    staleTime: 10_000,
  });

  const size = PRESETS.find((entry) => entry.id === preset) ?? PRESETS[0];

  const image = useQuery({
    queryKey: ["diagrams", "render", selected?.path ?? "", preset, scale],
    queryFn: () =>
      render({
        path: selected!.path,
        directory,
        width: size.width,
        height: size.height,
        scale,
      }),
    enabled: selected !== null,
    staleTime: Infinity,
    retry: false,
  });

  const openOnDaemon = useMutation({
    mutationFn: () => open({ path: selected!.path, directory }),
  });

  const items = catalog.data?.items ?? [];
  const showList = !compact || selected === null;
  const showViewer = !compact || selected !== null;

  const listView = (
    <ScrollView style={styles.listColumn} contentContainerStyle={styles.listContent}>
      {catalog.isPending ? <ActivityIndicator color={theme.colors.accent} /> : null}
      {catalog.isError ? <Text style={styles.error}>{messageOf(catalog.error)}</Text> : null}
      {!catalog.isPending && items.length === 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.bodyText}>No diagrams yet.</Text>
          <Text style={styles.mutedText}>
            Ask an agent for a diagram and have it save the .html into{"\n"}
            {catalog.data?.libraryDir ?? "your diagram library"}.
          </Text>
        </View>
      ) : null}
      {items.map((item) => {
        const active = selected?.path === item.path;
        return (
          <Pressable
            key={item.path}
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
              {item.source === "library" ? "library" : "workspace"}
              {item.location === "." ? "" : ` · ${item.location}`}
            </Text>
            <Text style={active ? styles.rowDetailSelected : styles.rowDetail}>
              {formatBytes(item.bytes)} · {formatWhen(item.modifiedAt)}
            </Text>
          </Pressable>
        );
      })}
      {catalog.data?.truncated ? (
        <Text style={styles.caption}>Showing the first 300 files found.</Text>
      ) : null}
    </ScrollView>
  );

  const aspect = image.data && image.data.width > 0 ? image.data.height / image.data.width : 0.625;
  const drawWidth = stageWidth > 0 ? stageWidth : 320;

  const viewerView = (
    <View style={styles.viewer}>
      <View style={styles.toolbar}>
        {compact && selected ? (
          <Chip label="‹ All" active={false} onPress={() => setSelected(null)} styles={styles} />
        ) : null}
        {PRESETS.map((entry) => (
          <Chip
            key={entry.id}
            label={entry.label}
            active={entry.id === preset}
            onPress={() => setPreset(entry.id)}
            styles={styles}
          />
        ))}
        <Chip
          label={scale === 1 ? "1x" : "2x"}
          active={scale === 2}
          onPress={() => setScale(scale === 1 ? 2 : 1)}
          styles={styles}
        />
        <Chip label="Refresh" active={false} onPress={() => void image.refetch()} styles={styles} />
        {selected && !compact ? (
          <Chip
            label="Open on this machine"
            active={false}
            onPress={() => openOnDaemon.mutate()}
            styles={styles}
          />
        ) : null}
      </View>

      <ScrollView
        style={styles.stage}
        contentContainerStyle={styles.stageContent}
        onLayout={(event) => setStageWidth(event.nativeEvent.layout.width - (compact ? 24 : 32))}
      >
        {!selected ? (
          <View style={styles.centered}>
            <Text style={styles.mutedText}>Pick a diagram to render it.</Text>
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
              {selected.name} · {image.data.width}×{image.data.height}px ·{" "}
              {formatBytes(image.data.bytes)}
            </Text>
            <Text style={styles.caption}>{selected.path}</Text>
            {openOnDaemon.isError ? (
              <Text style={styles.error}>{messageOf(openOnDaemon.error)}</Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{heading}</Text>
        <Text numberOfLines={1} style={styles.subtitle}>
          {items.length} diagram{items.length === 1 ? "" : "s"}
          {catalog.data?.libraryDir ? ` · ${catalog.data.libraryDir}` : ""}
        </Text>
      </View>
      <View style={styles.body}>
        {showList ? listView : null}
        {showViewer ? viewerView : null}
      </View>
    </View>
  );
}
