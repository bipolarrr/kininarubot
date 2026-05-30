import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIEmbed,
  type APIStringSelectComponent
} from "discord.js";
import { formatDuration } from "./format";
import type { QueueSnapshot, RepeatMode } from "./player";
import type { Track } from "./types";

export type MusicPanelPayload = {
  embeds: APIEmbed[];
  components: Array<
    APIActionRowComponent<APIButtonComponent | APIStringSelectComponent>
  >;
};

export type QueuePagePayload = {
  embeds: APIEmbed[];
  components: APIActionRowComponent<APIButtonComponent>[];
};

export type NoticePayload = {
  embeds: APIEmbed[];
};

export type NoticeTone = "active" | "idle" | "problem";

const QUEUE_PAGE_SIZE = 10;
export const THEME_COLORS = {
  active: 0x2f80ed,
  idle: 0xf2f4f7,
  problem: 0xe5484d
} as const;

export function buildMusicPanel(guildId: string, snapshot: QueueSnapshot): MusicPanelPayload {
  const embed = new EmbedBuilder()
    .setTitle(snapshot.current ? "Now Playing" : "Music Panel")
    .setColor(getPlaybackTone(snapshot) === "active" ? THEME_COLORS.active : THEME_COLORS.idle)
    .addFields(
      {
        name: "상태",
        value: buildStatus(snapshot),
        inline: true
      },
      {
        name: "반복",
        value: formatRepeatMode(snapshot.repeatMode),
        inline: true
      },
      {
        name: "대기열",
        value: buildQueueSummary(snapshot.queue),
        inline: false
      }
    )
    .setTimestamp(new Date());

  if (snapshot.current) {
    embed.setDescription(buildTrackDescription(snapshot.current));
    const thumbnail = getYouTubeThumbnailUrl(snapshot.current);
    if (thumbnail) {
      embed.setThumbnail(thumbnail);
    }
  } else {
    embed.setDescription("**재생 중인 곡이 없어요.**\n`/play`로 곡을 추가해 주세요.");
  }

  return {
    embeds: [embed.toJSON()],
    components: buildPanelComponents(guildId, snapshot).map((row) => row.toJSON())
  };
}

export function buildQueuePage(
  guildId: string,
  userId: string,
  snapshot: QueueSnapshot,
  page: number
): QueuePagePayload {
  const totalPages = getQueuePageCount(snapshot.queue.length);
  const safePage = clampPage(page, totalPages);
  const start = safePage * QUEUE_PAGE_SIZE;
  const visible = snapshot.queue.slice(start, start + QUEUE_PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setTitle("대기열")
    .setColor(getPlaybackTone(snapshot) === "active" ? THEME_COLORS.active : THEME_COLORS.idle)
    .setDescription(buildQueuePageDescription(snapshot, visible, start))
    .setFooter({
      text: `페이지 ${safePage + 1}/${totalPages} · 대기열 ${snapshot.queue.length}곡`
    });

  return {
    embeds: [embed.toJSON()],
    components: [
      new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(queueCustomId(guildId, userId, "prev", safePage))
            .setLabel("Previous")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage === 0),
          new ButtonBuilder()
            .setCustomId(queueCustomId(guildId, userId, "next", safePage))
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= totalPages - 1),
          new ButtonBuilder()
            .setCustomId(queueCustomId(guildId, userId, "close", safePage))
            .setLabel("Close")
            .setStyle(ButtonStyle.Danger)
        )
        .toJSON()
    ]
  };
}

export function buildNotice(
  title: string,
  description: string,
  options: {
    tone?: NoticeTone;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  } = {}
): NoticePayload {
  const tone = options.tone ?? "idle";
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(THEME_COLORS[tone])
    .setDescription(description)
    .setTimestamp(new Date());

  if (options.fields?.length) {
    embed.addFields(options.fields);
  }

  return { embeds: [embed.toJSON()] };
}

export function buildProblemNotice(message: string): NoticePayload {
  return buildNotice("문제가 생겼어요", `**처리하지 못했어요.**\n${message}`, { tone: "problem" });
}

export function buildTrackNotice(
  title: string,
  track: Track,
  options: {
    tone?: NoticeTone;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  } = {}
): NoticePayload {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(THEME_COLORS[options.tone ?? "active"])
    .setDescription(buildTrackDescription(track))
    .setTimestamp(new Date());

  const thumbnail = getYouTubeThumbnailUrl(track);
  if (thumbnail) {
    embed.setThumbnail(thumbnail);
  }

  if (options.fields?.length) {
    embed.addFields(options.fields);
  }

  return { embeds: [embed.toJSON()] };
}

export function getPlaybackTone(snapshot: QueueSnapshot): NoticeTone {
  return snapshot.current || snapshot.queue.length > 0 ? "active" : "idle";
}

function buildPanelComponents(
  guildId: string,
  snapshot: QueueSnapshot
): Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> {
  const hasCurrent = Boolean(snapshot.current);
  const hasQueue = snapshot.queue.length > 0;
  const hasHistory = snapshot.history.length > 0;

  const playbackRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(panelCustomId(guildId, "previous"))
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasHistory),
    new ButtonBuilder()
      .setCustomId(panelCustomId(guildId, snapshot.paused ? "resume" : "pause"))
      .setLabel(snapshot.paused ? "Resume" : "Pause")
      .setStyle(snapshot.paused ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!hasCurrent),
    new ButtonBuilder()
      .setCustomId(panelCustomId(guildId, "next"))
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasQueue),
    new ButtonBuilder()
      .setCustomId(panelCustomId(guildId, "repeat-one"))
      .setLabel("Repeat One")
      .setStyle(snapshot.repeatMode === "one" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(panelCustomId(guildId, "repeat-all"))
      .setLabel("Repeat All")
      .setStyle(snapshot.repeatMode === "all" ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  const sessionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(panelCustomId(guildId, "stop"))
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasCurrent && !hasQueue),
    new ButtonBuilder()
      .setCustomId(panelCustomId(guildId, "leave"))
      .setLabel("Leave")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!snapshot.connected)
  );

  const rows: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> = [
    playbackRow,
    sessionRow
  ];

  if (hasQueue) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(panelCustomId(guildId, "jump"))
          .setPlaceholder("Jump to a queued track")
          .addOptions(
            snapshot.queue.slice(0, 25).map((track, index) => ({
              label: truncate(`${index + 1}. ${track.title}`, 100),
              description: truncate(track.channel ?? formatDuration(track.durationSeconds), 100),
              value: String(index + 1)
            }))
          )
      )
    );
  }

  return rows;
}

export function panelCustomId(guildId: string, action: string): string {
  return `music:${guildId}:${action}`;
}

export function queueCustomId(
  guildId: string,
  userId: string,
  action: string,
  page: number
): string {
  return `queue:${guildId}:${userId}:${page}:${action}`;
}

export function parsePanelCustomId(customId: string): { guildId: string; action: string } | undefined {
  const match = /^music:([^:]+):(.+)$/.exec(customId);
  if (!match) {
    return undefined;
  }

  return {
    guildId: match[1],
    action: match[2]
  };
}

export function parseQueueCustomId(
  customId: string
): { guildId: string; userId: string; page: number; action: string } | undefined {
  const match = /^queue:([^:]+):([^:]+):(\d+):(.+)$/.exec(customId);
  if (!match) {
    return undefined;
  }

  return {
    guildId: match[1],
    userId: match[2],
    page: Number.parseInt(match[3], 10),
    action: match[4]
  };
}

function buildStatus(snapshot: QueueSnapshot): string {
  if (!snapshot.current) {
    return "**대기 중**";
  }

  return snapshot.paused ? "**일시정지**" : "**재생 중**";
}

function buildTrackDescription(track: Track): string {
  const lines = [
    `### ${formatTrackLink(track)}`,
    `**채널**: ${track.channel ?? "알 수 없음"}`,
    `**길이**: \`${formatDuration(track.durationSeconds)}\``,
    `**요청자**: ${track.requestedBy}`
  ];
  return lines.join("\n");
}

function buildQueueSummary(queue: Track[]): string {
  if (queue.length === 0) {
    return "**대기열이 비어 있어요.**\n`/play`로 곡을 추가해 주세요.";
  }

  const visible = queue.slice(0, 5).map((track, index) => {
    return formatQueueLine(track, index + 1);
  });
  const remaining = queue.length - visible.length;
  if (remaining > 0) {
    visible.push(`그리고 **${remaining}곡** 더 있어요.`);
  }
  return visible.join("\n");
}

function buildQueuePageDescription(
  snapshot: QueueSnapshot,
  visible: Track[],
  start: number
): string {
  const lines: string[] = [];
  if (snapshot.current) {
    lines.push(`**지금 재생 중**: ${formatTrackLink(snapshot.current)}`);
    lines.push("");
  }

  if (snapshot.queue.length === 0) {
    lines.push("**대기열이 비어 있어요.**");
    lines.push("`/play`로 곡을 추가해 주세요.");
    return lines.join("\n");
  }

  lines.push(
    ...visible.map((track, index) => {
      return formatQueueLine(track, start + index + 1);
    })
  );
  return lines.join("\n");
}

function getQueuePageCount(queueLength: number): number {
  return Math.max(1, Math.ceil(queueLength / QUEUE_PAGE_SIZE));
}

function clampPage(page: number, totalPages: number): number {
  if (!Number.isInteger(page) || page < 0) {
    return 0;
  }
  return Math.min(page, totalPages - 1);
}

function formatRepeatMode(mode: RepeatMode): string {
  switch (mode) {
    case "one":
      return "**한 곡 반복**";
    case "all":
      return "**전체 반복**";
    case "off":
      return "**꺼짐**";
  }
}

function formatQueueLine(track: Track, index: number): string {
  const channel = track.channel ? ` · ${track.channel}` : "";
  return `**${index.toString().padStart(2, "0")}.** ${formatTrackLink(track)} · \`${formatDuration(track.durationSeconds)}\`${channel}`;
}

function formatTrackLink(track: Track): string {
  return `[${escapeMarkdownLinkText(track.title)}](${track.webpageUrl})`;
}

function escapeMarkdownLinkText(value: string): string {
  return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function getYouTubeThumbnailUrl(track: Track): string | undefined {
  const id = getYouTubeVideoId(track.webpageUrl) ?? (/^[\w-]{11}$/.test(track.id) ? track.id : undefined);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : undefined;
}

function getYouTubeVideoId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") {
      return url.pathname.slice(1).split("/")[0] || undefined;
    }
    return url.searchParams.get("v") ?? undefined;
  } catch {
    return undefined;
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
