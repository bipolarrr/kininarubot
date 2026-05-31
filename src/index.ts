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
  type InteractionReplyOptions,
  type MessageComponentInteraction,
  type Message,
  type RepliableInteraction,
  type StringSelectMenuInteraction
} from "discord.js";
import { voiceChannelTypes } from "./commands";
import { loadConfig } from "./config";
import { MusicPlayerManager } from "./player";
import {
  buildMusicPanel,
  buildNotice,
  buildProblemNotice,
  buildQueuePage,
  buildTrackNotice,
  getPlaybackTone,
  parsePanelCustomId,
  parseQueueCustomId,
  type NoticePayload
} from "./ui";
import { resolveTrack } from "./youtube";

const config = loadConfig();
const NOTICE_AUTO_DISMISS_MS = 10_000;
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
      await replySafely(interaction, buildProblemNotice(`앗, 처리하지 못했어요. ${message}`));
    }
  }
});

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId || !interaction.guild) {
    await replySafely(interaction, buildProblemNotice("서버 안에서만 사용할 수 있어요."));
    return;
  }

  const player = players.get(interaction.guildId);

  switch (interaction.commandName) {
    case "play": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const query = interaction.options.getString("query", true);
      const voiceChannel = getMemberVoiceChannel(interaction);
      if (!voiceChannel) {
        await replySafely(interaction, buildProblemNotice("먼저 음성 채널에 들어와 주세요."));
        return;
      }

      const resolved = await resolveTrack(query);
      const track = {
        ...resolved,
        requestedBy: interaction.user.displayName
      };
      const result = await player.enqueue(track, voiceChannel);
      await updateMusicPanel(interaction.guildId);
      await editReplyWithAutoDismiss(
        interaction,
        buildTrackNotice(result.started ? "재생을 시작했어요" : "대기열에 추가했어요", track, {
          tone: "active",
          fields: result.started
            ? undefined
            : [{ name: "대기열 위치", value: `\`${result.position}\``, inline: true }]
        })
      );
      return;
    }

    case "queue":
      await interaction.reply({
        ...buildQueuePage(interaction.guildId, interaction.user.id, player.snapshot(), 0),
        flags: MessageFlags.Ephemeral
      });
      return;

    case "remove": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const index = interaction.options.getInteger("index", true);
      const removed = player.remove(index);
      await updateMusicPanel(interaction.guildId);
      await editReplyWithAutoDismiss(
        interaction,
        buildTrackNotice("대기열에서 제거했어요", removed, {
          tone: getPlaybackTone(player.snapshot()),
          fields: [{ name: "제거한 번호", value: `\`${index}\``, inline: true }]
        })
      );
      return;
    }

    case "jump": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const index = interaction.options.getInteger("index", true);
      const target = await player.jump(index);
      await updateMusicPanel(interaction.guildId);
      await editReplyWithAutoDismiss(
        interaction,
        buildTrackNotice("선택한 곡으로 이동했어요", target, {
          tone: "active",
          fields: [{ name: "이동한 번호", value: `\`${index}\``, inline: true }]
        })
      );
      return;
    }

    case "skip": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const skipped = await player.skip();
      if (!skipped) {
        await replySafely(interaction, buildProblemNotice("지금 넘길 곡이 없어요."));
        return;
      }
      await updateMusicPanel(interaction.guildId);
      await editReplyWithAutoDismiss(interaction, buildTrackNotice("곡을 넘겼어요", skipped, { tone: getPlaybackTone(player.snapshot()) }));
      return;
    }

    case "stop": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      player.stop();
      await updateMusicPanel(interaction.guildId);
      await editReplyWithAutoDismiss(interaction, buildNotice("재생을 멈췄어요", "**대기열을 비우고 재생을 중단했어요.**", { tone: "idle" }));
      return;
    }

    case "now":
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await updateMusicPanel(interaction.guildId);
      const nowSnapshot = player.snapshot();
      if (nowSnapshot.current) {
        await editReplyWithAutoDismiss(interaction, buildTrackNotice("지금 재생 중", nowSnapshot.current, { tone: "active" }));
      } else {
        await editReplyWithAutoDismiss(interaction, buildNotice("지금 재생 중인 곡이 없어요", "**대기열이 비어 있어요.**", { tone: "idle" }));
      }
      return;

    case "leave": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      player.leave();
      await updateMusicPanel(interaction.guildId);
      await editReplyWithAutoDismiss(interaction, buildNotice("음성 채널에서 나갔어요", "**재생 세션을 정리했어요.**", { tone: "idle" }));
      return;
    }

    case "panel": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await replySafely(interaction, buildProblemNotice("이 패널은 서버 관리 권한이 있어야 옮길 수 있어요."));
        return;
      }

      const channel = interaction.options.getChannel("channel", true);
      if (
        channel.type !== ChannelType.GuildText ||
        !("guildId" in channel) ||
        channel.guildId !== interaction.guildId
      ) {
        await replySafely(interaction, buildProblemNotice("이 서버의 텍스트 채널을 골라 주세요."));
        return;
      }

      await publishPanel(channel as GuildTextBasedChannel);
      await editReplyWithAutoDismiss(interaction, buildNotice("패널을 게시했어요", `**<#${channel.id}>** 채널에 뮤직 패널을 만들었어요.`, { tone: getPlaybackTone(player.snapshot()) }));
      return;
    }

    default:
      await replySafely(interaction, buildProblemNotice("알 수 없는 명령이에요."));
  }
}

async function handlePanelButton(interaction: ButtonInteraction): Promise<void> {
  const queueAction = parseQueueInteraction(interaction.customId, interaction.guildId);
  if (queueAction) {
    await handleQueueButton(interaction, queueAction);
    return;
  }

  const parsed = parsePanelInteraction(interaction.customId, interaction.guildId);
  if (!parsed) {
    await replySafely(interaction, buildProblemNotice("이 패널은 더 이상 사용할 수 없어요. 새 패널을 사용해 주세요."));
    return;
  }

  await interaction.deferUpdate();
  const player = players.get(parsed.guildId);

  switch (parsed.action) {
    case "previous":
      const previous = await player.previous();
      if (!previous) {
        await replySafely(interaction, buildProblemNotice("이전 곡 기록이 없어요."));
        return;
      }
      await replySafely(interaction, buildTrackNotice("이전 곡으로 돌아갔어요", previous, { tone: "active" }));
      break;

    case "pause":
      if (!player.pause()) {
        await replySafely(interaction, buildProblemNotice("지금 일시정지할 곡이 없어요."));
        return;
      }
      await replySafely(interaction, buildNotice("일시정지했어요", "**현재 곡을 잠시 멈췄어요.**", { tone: "active" }));
      break;

    case "resume":
      if (!player.resume()) {
        await replySafely(interaction, buildProblemNotice("다시 재생할 곡이 없어요."));
        return;
      }
      await replySafely(interaction, buildNotice("다시 재생해요", "**일시정지된 곡을 이어서 재생합니다.**", { tone: "active" }));
      break;

    case "next": {
      const skipped = await player.skip();
      if (!skipped) {
        await replySafely(interaction, buildProblemNotice("지금 넘길 곡이 없어요."));
        return;
      }
      await replySafely(interaction, buildTrackNotice("곡을 넘겼어요", skipped, { tone: getPlaybackTone(player.snapshot()) }));
      break;
    }

    case "repeat-one":
      await replySafely(interaction, buildNotice("반복 설정을 바꿨어요", `**한 곡 반복**: ${formatRepeatNotice(player.toggleRepeatOne())}`, { tone: getPlaybackTone(player.snapshot()) }));
      break;

    case "repeat-all":
      await replySafely(interaction, buildNotice("반복 설정을 바꿨어요", `**전체 반복**: ${formatRepeatNotice(player.toggleRepeatAll())}`, { tone: getPlaybackTone(player.snapshot()) }));
      break;

    case "stop":
      player.stop();
      await replySafely(interaction, buildNotice("재생을 멈췄어요", "**대기열을 비우고 재생을 중단했어요.**", { tone: "idle" }));
      break;

    case "leave":
      player.leave();
      await replySafely(interaction, buildNotice("음성 채널에서 나갔어요", "**재생 세션을 정리했어요.**", { tone: "idle" }));
      break;

    default:
      await replySafely(interaction, buildProblemNotice("알 수 없는 패널 동작이에요."));
      return;
  }

  await updateMusicPanel(parsed.guildId);
}

async function handleQueueButton(
  interaction: ButtonInteraction,
  parsed: { guildId: string; userId: string; page: number; action: string }
): Promise<void> {
  if (interaction.user.id !== parsed.userId) {
    await replySafely(interaction, buildProblemNotice("이 큐 화면은 명령어를 입력한 사용자만 조작할 수 있어요."));
    return;
  }

  if (parsed.action === "close") {
    await interaction.deferUpdate();
    await interaction.deleteReply().catch(() => undefined);
    return;
  }

  const nextPage =
    parsed.action === "prev"
      ? parsed.page - 1
      : parsed.action === "next"
        ? parsed.page + 1
        : parsed.page;

  if (parsed.action !== "prev" && parsed.action !== "next") {
    await replySafely(interaction, buildProblemNotice("알 수 없는 큐 동작이에요."));
    return;
  }

  await interaction.update(
    buildQueuePage(parsed.guildId, parsed.userId, players.get(parsed.guildId).snapshot(), nextPage)
  );
}

async function handlePanelSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const parsed = parsePanelInteraction(interaction.customId, interaction.guildId);
  if (!parsed || parsed.action !== "jump") {
    await replySafely(interaction, buildProblemNotice("이 패널은 더 이상 사용할 수 없어요. 새 패널을 사용해 주세요."));
    return;
  }

  await interaction.deferUpdate();
  const index = Number.parseInt(interaction.values[0] ?? "", 10);
  const target = await players.get(parsed.guildId).jump(index);
  await updateMusicPanel(parsed.guildId);
  await replySafely(interaction, buildTrackNotice("선택한 곡으로 이동했어요", target, {
    tone: "active",
    fields: [{ name: "이동한 번호", value: `\`${index}\``, inline: true }]
  }));
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

function parseQueueInteraction(
  customId: string,
  currentGuildId: string | null
): { guildId: string; userId: string; page: number; action: string } | undefined {
  const parsed = parseQueueCustomId(customId);
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
  payload: NoticePayload | string
): Promise<void> {
  const replyPayload: InteractionReplyOptions = {
    ...normalizeReplyPayload(payload),
    flags: MessageFlags.Ephemeral as const
  };
  if (interaction.deferred || interaction.replied) {
    if ("isMessageComponent" in interaction && interaction.isMessageComponent()) {
      await followUpWithAutoDismiss(interaction, replyPayload);
      return;
    }

    const { flags: _flags, ...editPayload } = replyPayload;
    await editReplyWithAutoDismiss(interaction, editPayload);
    return;
  }
  await interaction.reply(replyPayload).catch(() => undefined);
  scheduleDeleteReply(interaction);
}

function normalizeReplyPayload(payload: NoticePayload | string): Omit<InteractionReplyOptions, "flags"> {
  if (typeof payload === "string") {
    return buildProblemNotice(payload);
  }
  return payload;
}

async function editReplyWithAutoDismiss(
  interaction: RepliableInteraction,
  payload: NoticePayload | Omit<InteractionReplyOptions, "flags">
): Promise<void> {
  await interaction.editReply(payload).catch(() => undefined);
  scheduleDeleteReply(interaction);
}

async function followUpWithAutoDismiss(
  interaction: MessageComponentInteraction,
  payload: InteractionReplyOptions
): Promise<void> {
  const message = await interaction.followUp(payload).catch(() => undefined);
  if (!message) {
    return;
  }

  setTimeout(() => {
    void interaction.webhook.deleteMessage(message.id).catch(() => undefined);
  }, NOTICE_AUTO_DISMISS_MS);
}

function scheduleDeleteReply(interaction: RepliableInteraction): void {
  setTimeout(() => {
    void interaction.deleteReply().catch(() => undefined);
  }, NOTICE_AUTO_DISMISS_MS);
}

function formatRepeatNotice(mode: string): string {
  return mode === "off" ? "**꺼짐**" : "**켜짐**";
}

client.login(config.token).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
