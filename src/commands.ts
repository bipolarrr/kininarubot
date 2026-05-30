import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody
} from "discord.js";

export const commandData: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a YouTube URL or search result.")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("YouTube URL or search query")
        .setMinLength(1)
        .setMaxLength(6000)
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the current queue.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a queued track by its queue number.")
    .addIntegerOption((option) =>
      option
        .setName("index")
        .setDescription("Queue number from /queue")
        .setMinValue(1)
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("jump")
    .setDescription("Jump to a numbered queue item.")
    .addIntegerOption((option) =>
      option
        .setName("index")
        .setDescription("Queue number from /queue")
        .setMinValue(1)
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current track.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop playback and clear the queue.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("now")
    .setDescription("Show the current track.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Leave the voice channel.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Post the music panel in a text channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Text channel for the music panel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .toJSON()
];

export const voiceChannelTypes: ChannelType[] = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];

export function trimDiscordMessage(content: string): string {
  if (content.length <= 1900) {
    return content;
  }
  return `${content.slice(0, 1897)}...`;
}
