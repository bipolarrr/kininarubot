import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Track, TrackCandidate } from "./types";

const execFileAsync = promisify(execFile);
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be"
]);

export type ResolvedTrack = Omit<Track, "requestedBy">;

type YtDlpPlaylist = {
  entries?: TrackCandidate[];
};

export function isLikelyUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isYouTubeUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return YOUTUBE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function resolveTrack(input: string): Promise<ResolvedTrack> {
  if (isLikelyUrl(input)) {
    return resolveUrl(input);
  }

  return searchOfficialTrack(input);
}

export async function getPlayableUrl(webpageUrl: string): Promise<string> {
  const { stdout } = await runYtDlp([
    "--no-playlist",
    "--no-warnings",
    "--format",
    "bestaudio[acodec=opus]/bestaudio/best",
    "--get-url",
    webpageUrl
  ]);

  const url = stdout.trim().split(/\r?\n/)[0];
  if (!url) {
    throw new Error("yt-dlp did not return a playable audio URL");
  }
  return url;
}

export function scoreCandidate(candidate: TrackCandidate): number {
  const title = normalize(candidate.title);
  const channel = normalize(candidate.channel ?? candidate.uploader);
  const description = normalize(candidate.description);
  const duration = candidate.duration ?? 0;
  let score = 0;

  if (!candidate.webpage_url && !candidate.url) {
    score -= 30;
  }
  if (candidate.is_live || candidate.live_status === "is_live") {
    score -= 80;
  }
  if (duration > 0 && duration <= 600) {
    score += 10;
  }
  if (duration > 900) {
    score -= 25;
  }
  if (candidate.availability && candidate.availability !== "public") {
    score -= 20;
  }
  if (candidate.channel_is_verified) {
    score += 12;
  }
  if (title.includes("official audio")) {
    score += 45;
  }
  if (title.includes("official music video") || title.includes("official mv")) {
    score += 35;
  }
  if (title.includes("official video")) {
    score += 25;
  }
  if (channel.endsWith(" - topic") || channel.includes("topic")) {
    score += 35;
  }
  if (description.includes("provided to youtube by")) {
    score += 35;
  }
  if (title.includes("audio")) {
    score += 8;
  }

  const penalties = [
    "cover",
    "remix",
    "lyrics",
    "lyric video",
    "nightcore",
    "karaoke",
    "instrumental",
    "sped up",
    "slowed",
    "reaction",
    "live",
    "shorts"
  ];

  for (const keyword of penalties) {
    if (title.includes(keyword)) {
      score -= 12;
    }
  }

  return score;
}

export function pickBestCandidate(candidates: TrackCandidate[]): TrackCandidate | undefined {
  return candidates
    .filter((candidate) => candidate.title && (candidate.webpage_url || candidate.url))
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0];
}

async function resolveUrl(url: string): Promise<ResolvedTrack> {
  const metadata = await readJson<TrackCandidate>([
    "--dump-single-json",
    "--skip-download",
    "--no-playlist",
    "--no-warnings",
    url
  ]);

  return toResolvedTrack(metadata);
}

async function searchOfficialTrack(query: string): Promise<ResolvedTrack> {
  const metadata = await readJson<YtDlpPlaylist>([
    "--dump-single-json",
    "--skip-download",
    "--no-warnings",
    `ytsearch10:${query}`
  ]);

  const best = pickBestCandidate(metadata.entries ?? []);
  if (!best) {
    throw new Error(`No playable YouTube results found for: ${query}`);
  }

  return toResolvedTrack(best);
}

function toResolvedTrack(candidate: TrackCandidate): ResolvedTrack {
  const webpageUrl = candidate.webpage_url ?? candidate.url;
  if (!candidate.title || !webpageUrl) {
    throw new Error("yt-dlp returned incomplete track metadata");
  }

  return {
    id: candidate.id ?? webpageUrl,
    title: candidate.title,
    url: webpageUrl,
    webpageUrl,
    channel: candidate.channel ?? candidate.uploader,
    durationSeconds: candidate.duration
  };
}

async function readJson<T>(args: string[]): Promise<T> {
  const { stdout } = await runYtDlp(args);
  return JSON.parse(stdout) as T;
}

async function runYtDlp(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync("yt-dlp", args, {
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`yt-dlp failed: ${message}`);
  }
}

function normalize(value: string | undefined): string {
  return (value ?? "").toLocaleLowerCase("en-US");
}
