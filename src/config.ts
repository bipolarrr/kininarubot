import "dotenv/config";

export type BotConfig = {
  token: string;
  clientId: string;
  guildId?: string;
  musicPanelChannelId?: string;
  idleDisconnectMs: number;
};

export function loadConfig(): BotConfig {
  const token = requireEnv("DISCORD_TOKEN");
  const clientId = requireEnv("CLIENT_ID");

  return {
    token,
    clientId,
    guildId: process.env.GUILD_ID,
    musicPanelChannelId: process.env.MUSIC_PANEL_CHANNEL_ID,
    idleDisconnectMs: parseNonNegativeInt(process.env.IDLE_DISCONNECT_MS, 0)
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
