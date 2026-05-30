import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  type AudioPlayer,
  type VoiceConnection
} from "@discordjs/voice";
import type { BaseGuildVoiceChannel } from "discord.js";
import { formatDuration } from "./format";
import type { Track } from "./types";
import { getPlayableUrl } from "./youtube";

export type RepeatMode = "off" | "one" | "all";

export type QueueSnapshot = {
  current?: Track;
  queue: Track[];
  paused: boolean;
  repeatMode: RepeatMode;
  history: Track[];
  connected: boolean;
};

export type EnqueueResult = {
  started: boolean;
  position: number;
};

export class MusicPlayerManager {
  private readonly players = new Map<string, GuildMusicPlayer>();

  constructor(
    private readonly idleDisconnectMs: number,
    private readonly onPlayerUpdate: (guildId: string) => void = () => undefined
  ) {}

  get(guildId: string): GuildMusicPlayer {
    const existing = this.players.get(guildId);
    if (existing) {
      return existing;
    }

    const player = new GuildMusicPlayer(
      guildId,
      this.idleDisconnectMs,
      () => {
        this.players.delete(guildId);
      },
      this.onPlayerUpdate
    );
    this.players.set(guildId, player);
    return player;
  }
}

export class GuildMusicPlayer {
  private readonly audioPlayer: AudioPlayer;
  private connection?: VoiceConnection;
  private current?: Track;
  private queue: Track[] = [];
  private history: Track[] = [];
  private ffmpeg?: ChildProcessWithoutNullStreams;
  private idleTimer?: NodeJS.Timeout;
  private stopped = false;
  private paused = false;
  private repeatMode: RepeatMode = "off";
  private ignoreNextIdle = false;
  private starting = false;
  private playbackVersion = 0;

  constructor(
    private readonly guildId: string,
    private readonly idleDisconnectMs: number,
    private readonly onDispose: () => void,
    private readonly onStateChange: (guildId: string) => void = () => undefined
  ) {
    this.audioPlayer = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause
      }
    });

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      if (this.ignoreNextIdle) {
        this.ignoreNextIdle = false;
        return;
      }
      if (!this.stopped) {
        void this.finishCurrentAndPlayNext();
      }
    });

    this.audioPlayer.on("error", (error) => {
      console.error(`Playback error ${this.guildId}: ${error.message}`);
      if (!this.stopped) {
        void this.playNext();
      }
    });
  }

  async enqueue(
    track: Track,
    voiceChannel: BaseGuildVoiceChannel
  ): Promise<EnqueueResult> {
    await this.connect(voiceChannel);
    this.clearIdleTimer();
    this.queue.push(track);

    if (!this.current && !this.starting) {
      this.starting = true;
      void this.playNext();
      return { started: true, position: 0 };
    }

    return { started: false, position: this.queue.length };
  }

  snapshot(): QueueSnapshot {
    return {
      current: this.current,
      queue: [...this.queue],
      paused: this.paused,
      repeatMode: this.repeatMode,
      history: [...this.history],
      connected: Boolean(
        this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed
      )
    };
  }

  async jump(index: number): Promise<Track> {
    const result = jumpQueue(this.queue, index);
    this.queue = result.queue;
    this.rememberCurrentForHistory();
    this.ignoreNextIdle = true;
    this.stopCurrentProcess();
    this.audioPlayer.stop(true);
    this.current = undefined;
    this.paused = false;
    this.stopped = false;
    void this.playNext();
    this.notifyStateChange();
    return result.target;
  }

  remove(index: number): Track {
    const result = removeFromQueue(this.queue, index);
    this.queue = result.queue;
    this.notifyStateChange();
    return result.removed;
  }

  async skip(): Promise<Track | undefined> {
    const skipped = this.current;
    if (!skipped && this.queue.length === 0) {
      return undefined;
    }

    this.completeCurrentForTransition();
    this.ignoreNextIdle = true;
    this.stopCurrentProcess();
    this.audioPlayer.stop(true);
    this.current = undefined;
    this.paused = false;
    this.stopped = false;
    void this.playNext();
    this.notifyStateChange();
    return skipped;
  }

  async previous(): Promise<Track | undefined> {
    const transition = previousQueueTransition(this.current, this.queue, this.history);
    if (!transition.target) {
      return undefined;
    }

    this.queue = transition.queue;
    this.history = transition.history;
    this.ignoreNextIdle = true;
    this.stopCurrentProcess();
    this.audioPlayer.stop(true);
    this.current = undefined;
    this.paused = false;
    this.stopped = false;
    void this.playNext();
    this.notifyStateChange();
    return transition.target;
  }

  pause(): boolean {
    if (!this.current || this.paused) {
      return false;
    }

    this.audioPlayer.pause(true);
    this.paused = true;
    this.notifyStateChange();
    return true;
  }

  resume(): boolean {
    if (!this.current || !this.paused) {
      return false;
    }

    this.audioPlayer.unpause();
    this.paused = false;
    this.notifyStateChange();
    return true;
  }

  toggleRepeatOne(): RepeatMode {
    this.repeatMode = this.repeatMode === "one" ? "off" : "one";
    this.notifyStateChange();
    return this.repeatMode;
  }

  toggleRepeatAll(): RepeatMode {
    this.repeatMode = this.repeatMode === "all" ? "off" : "all";
    this.notifyStateChange();
    return this.repeatMode;
  }

  stop(): void {
    this.stopped = true;
    this.playbackVersion += 1;
    this.queue = [];
    this.current = undefined;
    this.history = [];
    this.paused = false;
    this.stopCurrentProcess();
    this.audioPlayer.stop(true);
    this.scheduleDisconnect();
    this.notifyStateChange();
  }

  leave(): void {
    this.stopped = true;
    this.playbackVersion += 1;
    this.queue = [];
    this.current = undefined;
    this.history = [];
    this.paused = false;
    this.stopCurrentProcess();
    this.connection?.destroy();
    this.connection = undefined;
    this.clearIdleTimer();
    this.notifyStateChange();
    this.onDispose();
  }

  formatQueue(): string {
    const lines: string[] = [];
    if (this.current) {
      lines.push(`Now Playing: ${formatTrack(this.current)}`);
    } else {
      lines.push("Now Playing: none");
    }

    if (this.queue.length === 0) {
      lines.push("Queue is empty.");
      return lines.join("\n");
    }

    lines.push("");
    lines.push(
      ...this.queue.map((track, index) => `${index + 1}. ${formatTrack(track)}`)
    );
    return lines.join("\n");
  }

  formatNowPlaying(): string {
    return this.current ? formatTrack(this.current) : "Nothing is playing.";
  }

  private async connect(channel: BaseGuildVoiceChannel): Promise<void> {
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      return;
    }

    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: this.guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });
    this.connection.on("error", (error) => {
      console.error(`Voice connection ${this.guildId} error:`, error);
    });
    this.connection.subscribe(this.audioPlayer);
    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
      this.connection.destroy();
      this.connection = undefined;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not join the voice channel within 20 seconds. Check the bot's Connect/Speak permissions and voice channel region. ${message}`
      );
    }
  }

  private async playNext(): Promise<void> {
    const version = ++this.playbackVersion;
    this.starting = true;
    this.clearIdleTimer();
    this.stopCurrentProcess();

    const next = this.queue.shift();
    if (!next) {
      this.current = undefined;
      this.starting = false;
      this.scheduleDisconnect();
      this.notifyStateChange();
      return;
    }

    this.current = next;
    this.starting = false;
    this.stopped = false;
    this.paused = false;
    this.notifyStateChange();

    try {
      const playableUrl = await getPlayableUrl(next.webpageUrl);
      if (version !== this.playbackVersion || this.stopped) {
        return;
      }
      this.ffmpeg = spawn("ffmpeg", buildFfmpegArgs(playableUrl), {
        windowsHide: true
      });

      this.ffmpeg.once("error", (error) => {
        console.error(`Failed to start ffmpeg ${this.guildId}: ${error.message}`);
        void this.playNext();
      });

      const resource = createAudioResource(this.ffmpeg.stdout, {
        inputType: StreamType.Raw
      });
      this.audioPlayer.play(resource);
    } catch (error) {
      if (version !== this.playbackVersion || this.stopped) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not play ${next.title}: ${message}`);
      this.current = undefined;
      this.paused = false;
      this.notifyStateChange();
      void this.playNext();
    }
  }

  private async finishCurrentAndPlayNext(): Promise<void> {
    this.completeCurrentForTransition();
    this.current = undefined;
    this.paused = false;
    await this.playNext();
  }

  private completeCurrentForTransition(): void {
    if (!this.current) {
      return;
    }

    const transition = applyRepeatModeOnFinish(
      this.current,
      this.queue,
      this.history,
      this.repeatMode
    );
    this.queue = transition.queue;
    this.history = transition.history;
  }

  private rememberCurrentForHistory(): void {
    if (this.current) {
      this.history.push(this.current);
    }
  }

  private stopCurrentProcess(): void {
    if (this.ffmpeg && !this.ffmpeg.killed) {
      this.ffmpeg.kill("SIGKILL");
    }
    this.ffmpeg = undefined;
  }

  private scheduleDisconnect(): void {
    this.clearIdleTimer();
    if (this.idleDisconnectMs === 0) {
      return;
    }

    this.idleTimer = setTimeout(() => {
      this.leave();
    }, this.idleDisconnectMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private notifyStateChange(): void {
    this.onStateChange(this.guildId);
  }
}

export function formatTrack(track: Track): string {
  const channel = track.channel ? ` by ${track.channel}` : "";
  return `${track.title}${channel} (${formatDuration(track.durationSeconds)}) - requested by ${track.requestedBy}`;
}

export function buildFfmpegArgs(playableUrl: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "5",
    "-i",
    playableUrl,
    "-analyzeduration",
    "0",
    "-af",
    "loudnorm=I=-16:TP=-1.5:LRA=11:linear=false",
    "-f",
    "s16le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "pipe:1"
  ];
}

export function jumpQueue(queue: Track[], index: number): { target: Track; queue: Track[] } {
  if (!Number.isInteger(index) || index < 1 || index > queue.length) {
    throw new Error(`Queue index must be between 1 and ${queue.length}.`);
  }

  const targetIndex = index - 1;
  return {
    target: queue[targetIndex],
    queue: queue.slice(targetIndex)
  };
}

export function removeFromQueue(queue: Track[], index: number): { removed: Track; queue: Track[] } {
  if (!Number.isInteger(index) || index < 1 || index > queue.length) {
    throw new Error(`Queue index must be between 1 and ${queue.length}.`);
  }

  const targetIndex = index - 1;
  return {
    removed: queue[targetIndex],
    queue: [...queue.slice(0, targetIndex), ...queue.slice(targetIndex + 1)]
  };
}

export function applyRepeatModeOnFinish(
  current: Track | undefined,
  queue: Track[],
  history: Track[],
  repeatMode: RepeatMode
): { queue: Track[]; history: Track[] } {
  if (!current) {
    return { queue: [...queue], history: [...history] };
  }

  if (repeatMode === "one") {
    return { queue: [current, ...queue], history: [...history] };
  }

  const nextHistory = [...history, current];
  if (repeatMode === "all") {
    return { queue: [...queue, current], history: nextHistory };
  }

  return { queue: [...queue], history: nextHistory };
}

export function previousQueueTransition(
  current: Track | undefined,
  queue: Track[],
  history: Track[]
): { target?: Track; queue: Track[]; history: Track[] } {
  if (history.length === 0) {
    return { queue: [...queue], history: [] };
  }

  const nextHistory = history.slice(0, -1);
  const target = history[history.length - 1];
  return {
    target,
    queue: current ? [target, current, ...queue] : [target, ...queue],
    history: nextHistory
  };
}
