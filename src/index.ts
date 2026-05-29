import {
  ChannelType,
  Client,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  type BaseGuildVoiceChannel,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
  type Message,
  type RepliableInteraction,
  type StringSelectMenuInteraction
} from "discord.js";
import { trimDiscordMessage, voiceChannelTypes } from "./commands";
import { loadConfig } from "./config";
import { MusicPlayerManager } from "./player";
import { buildMusicPanel, parsePanelCustomId } from "./ui";
import { resolveTrack } from "./youtube";

const config = loadConfig();
const panelChannelIds = new Map<string, string>();
const panelMessages = new Map<string, Message>();
const players = new MusicPlayerManager(config.idleDisconnectMs, (guildId) => {
  void updateMusicPanel(guildId);
});
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

client.once("clientReady", () => {
  if (config.musicPanelChannelId) {
    void publishPanelFromChannelId(config.musicPanelChannelId).catch((error) => {
      console.error(`Could not publish configured music panel:`, error);
    });
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
      return;
    }

    if (interaction.isButton()) {
      await handlePanelButton(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      await handlePanelSelect(interaction);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const name = interaction.isChatInputCommand() ? interaction.commandName : interaction.id;
    console.error(`Interaction ${name} failed:`, error);
    if (interaction.isRepliable()) {
      await replySafely(interaction, `앗, 처리하지 못했어요. ${message}`);
    }
  }
});

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "서버 안에서만 사용할 수 있어요.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const player = players.get(interaction.guildId);

  switch (interaction.commandName) {
    case "play": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const query = interaction.options.getString("query", true);
      const voiceChannel = getMemberVoiceChannel(interaction);
      if (!voiceChannel) {
        await interaction.editReply("먼저 음성 채널에 들어와 주세요.");
        return;
      }

      const resolved = await resolveTrack(query);
      const track = {
        ...resolved,
        requestedBy: interaction.user.displayName
      };
      await player.enqueue(track, voiceChannel);
      await updateMusicPanel(interaction.guildId);
      await deleteReplySafely(interaction);
      return;
    }

    case "queue":
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await updateMusicPanel(interaction.guildId);
      await deleteReplySafely(interaction);
      return;

    case "jump": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const index = interaction.options.getInteger("index", true);
      await player.jump(index);
      await updateMusicPanel(interaction.guildId);
      await deleteReplySafely(interaction);
      return;
    }

    case "skip": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const skipped = await player.skip();
      if (!skipped) {
        await interaction.editReply("지금 넘길 곡이 없어요.");
        return;
      }
      await updateMusicPanel(interaction.guildId);
      await deleteReplySafely(interaction);
      return;
    }

    case "stop": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      player.stop();
      await updateMusicPanel(interaction.guildId);
      await deleteReplySafely(interaction);
      return;
    }

    case "now":
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await updateMusicPanel(interaction.guildId);
      await deleteReplySafely(interaction);
      return;

    case "leave": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      player.leave();
      await updateMusicPanel(interaction.guildId);
      await deleteReplySafely(interaction);
      return;
    }

    case "panel": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.editReply("이 패널은 서버 관리 권한이 있어야 옮길 수 있어요.");
        return;
      }

      const channel = interaction.options.getChannel("channel", true);
      if (
        channel.type !== ChannelType.GuildText ||
        !("guildId" in channel) ||
        channel.guildId !== interaction.guildId
      ) {
        await interaction.editReply("이 서버의 텍스트 채널을 골라 주세요.");
        return;
      }

      await publishPanel(channel as GuildTextBasedChannel);
      await deleteReplySafely(interaction);
      return;
    }

    default:
      await interaction.reply({
        content: "알 수 없는 명령이에요.",
        flags: MessageFlags.Ephemeral
      });
  }
}

async function handlePanelButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parsePanelInteraction(interaction.customId, interaction.guildId);
  if (!parsed) {
    await interaction.reply({
      content: "이 패널은 더 이상 사용할 수 없어요. 새 패널을 사용해 주세요.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferUpdate();
  const player = players.get(parsed.guildId);

  switch (parsed.action) {
    case "previous":
      const previous = await player.previous();
      if (!previous) {
        await replySafely(interaction, "이전 곡 기록이 없어요.");
        return;
      }
      break;

    case "pause":
      if (!player.pause()) {
        await replySafely(interaction, "지금 일시정지할 곡이 없어요.");
        return;
      }
      break;

    case "resume":
      if (!player.resume()) {
        await replySafely(interaction, "다시 재생할 곡이 없어요.");
        return;
      }
      break;

    case "next": {
      const skipped = await player.skip();
      if (!skipped) {
        await replySafely(interaction, "지금 넘길 곡이 없어요.");
        return;
      }
      break;
    }

    case "repeat-one":
      player.toggleRepeatOne();
      break;

    case "repeat-all":
      player.toggleRepeatAll();
      break;

    case "stop":
      player.stop();
      break;

    case "leave":
      player.leave();
      break;

    default:
      await replySafely(interaction, "알 수 없는 패널 동작이에요.");
      return;
  }

  await updateMusicPanel(parsed.guildId);
}

async function handlePanelSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const parsed = parsePanelInteraction(interaction.customId, interaction.guildId);
  if (!parsed || parsed.action !== "jump") {
    await interaction.reply({
      content: "이 패널은 더 이상 사용할 수 없어요. 새 패널을 사용해 주세요.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferUpdate();
  const index = Number.parseInt(interaction.values[0] ?? "", 10);
  await players.get(parsed.guildId).jump(index);
  await updateMusicPanel(parsed.guildId);
}

function parsePanelInteraction(
  customId: string,
  currentGuildId: string | null
): { guildId: string; action: string } | undefined {
  const parsed = parsePanelCustomId(customId);
  if (!parsed || !currentGuildId || parsed.guildId !== currentGuildId) {
    return undefined;
  }

  return parsed;
}

async function publishPanelFromChannelId(channelId: string): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(`MUSIC_PANEL_CHANNEL_ID must point to a text channel: ${channelId}`);
  }

  await publishPanel(channel as GuildTextBasedChannel);
}

async function publishPanel(channel: GuildTextBasedChannel): Promise<void> {
  panelChannelIds.set(channel.guildId, channel.id);
  const message = await channel.send(buildMusicPanel(channel.guildId, players.get(channel.guildId).snapshot()));
  panelMessages.set(channel.guildId, message);
}

async function updateMusicPanel(guildId: string): Promise<void> {
  const channelId = panelChannelIds.get(guildId);
  if (!channelId) {
    return;
  }

  const payload = buildMusicPanel(guildId, players.get(guildId).snapshot());
  const existing = panelMessages.get(guildId);
  if (existing) {
    try {
      await existing.edit(payload);
      return;
    } catch {
      panelMessages.delete(guildId);
    }
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    return;
  }

  const message = await (channel as GuildTextBasedChannel).send(payload);
  panelMessages.set(guildId, message);
}

function getMemberVoiceChannel(
  interaction: ChatInputCommandInteraction
): BaseGuildVoiceChannel | undefined {
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  const channel = member?.voice.channel;
  if (!channel || !voiceChannelTypes.includes(channel.type)) {
    return undefined;
  }
  return channel;
}

async function replySafely(
  interaction: RepliableInteraction,
  content: string
): Promise<void> {
  const payload = {
    content: trimDiscordMessage(content),
    flags: MessageFlags.Ephemeral as const
  };
  if (interaction.deferred || interaction.replied) {
    if ("isMessageComponent" in interaction && interaction.isMessageComponent()) {
      await interaction.followUp(payload).catch(() => undefined);
      return;
    }

    await interaction.editReply(payload.content).catch(() => undefined);
    return;
  }
  await interaction.reply(payload).catch(() => undefined);
}

async function deleteReplySafely(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    return;
  }

  await interaction.deleteReply().catch(() => undefined);
}

client.login(config.token).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
