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

export function buildMusicPanel(guildId: string, snapshot: QueueSnapshot): MusicPanelPayload {
  const embed = new EmbedBuilder()
    .setTitle("Music Panel")
    .setColor(snapshot.current ? 0x2f80ed : 0x6b7280)
    .addFields(
      {
        name: "Status",
        value: buildStatus(snapshot),
        inline: true
      },
      {
        name: "Repeat",
        value: formatRepeatMode(snapshot.repeatMode),
        inline: true
      },
      {
        name: "Queue",
        value: buildQueueSummary(snapshot.queue),
        inline: false
      }
    )
    .setTimestamp(new Date());

  if (snapshot.current) {
    embed.setDescription(buildTrackDescription(snapshot.current));
  } else {
    embed.setDescription("Nothing is playing.");
  }

  return {
    embeds: [embed.toJSON()],
    components: buildPanelComponents(guildId, snapshot).map((row) => row.toJSON())
  };
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

function buildStatus(snapshot: QueueSnapshot): string {
  if (!snapshot.current) {
    return "Idle";
  }

  return snapshot.paused ? "Paused" : "Playing";
}

function buildTrackDescription(track: Track): string {
  const lines = [
    `**${track.title}**`,
    `Channel: ${track.channel ?? "unknown"}`,
    `Length: ${formatDuration(track.durationSeconds)}`,
    `Requested by: ${track.requestedBy}`
  ];
  return lines.join("\n");
}

function buildQueueSummary(queue: Track[]): string {
  if (queue.length === 0) {
    return "Queue is empty.";
  }

  const visible = queue.slice(0, 5).map((track, index) => {
    return `${index + 1}. ${track.title} (${formatDuration(track.durationSeconds)})`;
  });
  const remaining = queue.length - visible.length;
  if (remaining > 0) {
    visible.push(`...and ${remaining} more`);
  }
  return visible.join("\n");
}

function formatRepeatMode(mode: RepeatMode): string {
  switch (mode) {
    case "one":
      return "One track";
    case "all":
      return "All tracks";
    case "off":
      return "Off";
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
