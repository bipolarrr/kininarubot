import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Track, TrackCandidate } from "./types";

const execFileAsync = promisify(execFile);
const SEARCH_RESULT_LIMIT = 20;
const MAX_TRACK_DURATION_SECONDS = 10 * 60;
const TITLE_BLACKLIST_PHRASES = ["TJ노래방", "KY 금영노래방", "KY KARAOKE"];
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
    logInfo({
      event: "track.resolve_start",
      input,
      mode: isYouTubeUrl(input) ? "youtube_url" : "url"
    });
    return resolveUrl(input);
  }

  logInfo({
    event: "track.resolve_start",
    input,
    mode: "youtube_search"
  });
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

export function appendLyricsToSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (hasLyricsKeyword(trimmed)) {
    return trimmed;
  }
  return `${trimmed} lyrics`;
}

export function pickBestCandidate(candidates: TrackCandidate[], query = ""): TrackCandidate | undefined {
  return rankCandidates(candidates, query)[0];
}

export function rankCandidates(candidates: TrackCandidate[], query = ""): TrackCandidate[] {
  void query;
  return candidates.filter(
    (candidate) =>
      candidate.title &&
      (candidate.webpage_url || candidate.url) &&
      !isBlacklistedTitle(candidate.title) &&
      !isOverDurationLimit(candidate)
  );
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

async function searchOfficialTrack(
  query: string,
  options: { notFoundMessage?: string } = {}
): Promise<ResolvedTrack> {
  const searchQuery = appendLyricsToSearchQuery(query);
  logInfo({
    event: "youtube.search_start",
    query,
    searchQuery,
    ytDlpQuery: `ytsearch${SEARCH_RESULT_LIMIT}:${searchQuery}`
  });

  const metadata = await readJson<YtDlpPlaylist>([
    "--dump-single-json",
    "--skip-download",
    "--flat-playlist",
    "--no-warnings",
    `ytsearch${SEARCH_RESULT_LIMIT}:${searchQuery}`
  ]);

  const entries = metadata.entries ?? [];
  const ranked = rankCandidates(entries, searchQuery);
  const best = await pickFirstPlayableCandidate(ranked, searchQuery);
  if (!best) {
    logInfo({
      event: "youtube.search_no_candidate",
      query,
      searchQuery,
      candidateCount: entries.length
    }, "warn");
    throw new Error(options.notFoundMessage ?? `No playable YouTube results found for: ${query}`);
  }

  logInfo({
    event: "youtube.search_selected",
    query,
    searchQuery,
    candidateCount: entries.length,
    selectedTitle: best.title,
    selectedChannel: best.channel ?? best.uploader,
    selectedUrl: best.webpage_url ?? best.url
  });

  return toResolvedTrack(best);
}

async function pickFirstPlayableCandidate(candidates: TrackCandidate[], query: string): Promise<TrackCandidate | undefined> {
  for (const candidate of candidates) {
    const webpageUrl = candidate.webpage_url ?? candidate.url;
    if (!webpageUrl) {
      continue;
    }

    try {
      await getPlayableUrl(webpageUrl);
      return candidate;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logInfo({
        event: "youtube.search_candidate_unplayable",
        query,
        candidateTitle: candidate.title,
        candidateChannel: candidate.channel ?? candidate.uploader,
        candidateUrl: webpageUrl,
        error: message
      }, "warn");
    }
  }

  return undefined;
}

function toResolvedTrack(candidate: TrackCandidate): ResolvedTrack {
  const webpageUrl = candidate.webpage_url ?? candidate.url;
  if (!candidate.title || !webpageUrl) {
    throw new Error("yt-dlp returned incomplete track metadata");
  }
  if (isOverDurationLimit(candidate)) {
    throw new Error("Tracks longer than 10 minutes are not supported.");
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
    const result = await execFileAsync("yt-dlp", args, {
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    });
    if (typeof result === "string") {
      return { stdout: result, stderr: "" };
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`yt-dlp failed: ${message}`);
  }
}

function normalize(value: string | undefined): string {
  return (value ?? "").toLocaleLowerCase("en-US");
}

function hasLyricsKeyword(query: string): boolean {
  const normalized = normalize(query);
  return /\blyrics?\b/.test(normalized) || /\blyric\s*video\b/.test(normalized) || normalized.includes("가사");
}

function isBlacklistedTitle(title: string): boolean {
  return TITLE_BLACKLIST_PHRASES.some((phrase) => title.includes(phrase));
}

function isOverDurationLimit(candidate: TrackCandidate): boolean {
  return candidate.duration !== undefined && candidate.duration > MAX_TRACK_DURATION_SECONDS;
}

function logInfo(record: Record<string, unknown>, level: "info" | "warn" | "error" = "info"): void {
  console[level](JSON.stringify(record));
}
