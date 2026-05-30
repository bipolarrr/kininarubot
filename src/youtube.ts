import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseAnimeThemeRequest } from "./anime-theme-resolver";
import type { Track, TrackCandidate } from "./types";

const execFileAsync = promisify(execFile);
const REQUESTED_VARIANT_MATCH_BONUS = 120;
const ANIME_THEME_DISABLED_MESSAGE =
  "애니 OP/ED 자동 검색은 잠시 꺼져 있습니다. 곡명이나 아티스트를 함께 입력해 주세요.";
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

  const animeThemeRequest = parseAnimeThemeRequest(input);
  if (animeThemeRequest) {
    logInfo({
      event: "track.anime_theme_disabled",
      input,
      animeTitle: animeThemeRequest.animeTitle,
      theme: animeThemeRequest.theme,
      season: animeThemeRequest.season,
      themeNumber: animeThemeRequest.themeNumber
    }, "warn");
    throw new Error(ANIME_THEME_DISABLED_MESSAGE);
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

export function scoreCandidate(candidate: TrackCandidate, query = ""): number {
  const title = normalize(candidate.title);
  const channel = normalize(candidate.channel ?? candidate.uploader);
  const description = normalize(candidate.description);
  const duration = candidate.duration ?? 0;
  const requestedPenaltyGroups = getRequestedPenaltyGroups(query);
  const musicVideoRequested = isMusicVideoRequested(query);
  const officialSignal = hasOfficialSignal(candidate);
  const fmv = isFmvCandidate(candidate);
  const musicVideo = isMusicVideoCandidate(candidate);
  let score = 0;

  if (isKaraokeCandidate(candidate)) {
    return -9999;
  }
  if (!candidate.webpage_url && !candidate.url) {
    score -= 30;
  }
  score += scoreQueryRelevance(candidate, query);
  if (candidate.is_live || candidate.live_status === "is_live") {
    score -= 80;
  }
  if (duration > 0 && duration <= 600) {
    score += 10;
  }
  if (duration > 900 && !officialSignal) {
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
  if (musicVideo && !fmv) {
    score += musicVideoRequested ? 85 : -45;
  }

  const penalties: Array<{ group: PenaltyGroup; keywords: string[]; penalty?: number }> = [
    { group: "cover", keywords: ["cover", "covered", "커버"] },
    { group: "remix", keywords: ["remix", "rmx", "리믹스"] },
    { group: "lyrics", keywords: ["lyrics", "lyric video", "가사"], penalty: 4 },
    { group: "nightcore", keywords: ["nightcore", "나이트코어"] },
    { group: "karaoke", keywords: ["karaoke", "노래방"] },
    { group: "instrumental", keywords: ["instrumental", "inst.", "inst", "mr", "반주"] },
    {
      group: "sped",
      keywords: ["sped up", "speed up", "fast version", "빠른 버전", "빠른버전", "배속"]
    },
    { group: "slowed", keywords: ["slowed", "slow version", "느린 버전", "느린버전", "저속"] },
    { group: "reaction", keywords: ["reaction", "리액션"] },
    { group: "live", keywords: ["live", "라이브"] },
    { group: "fancam", keywords: ["fancam", "fan cam", "직캠"] },
    {
      group: "fmv",
      keywords: ["fmv", "fanmade", "fan-made", "fan made", "팬메이드", "팬무비", "팬영상"],
      penalty: 90
    },
    { group: "shorts", keywords: ["shorts", "쇼츠"] }
  ];

  for (const penalty of penalties) {
    if (penalty.keywords.some((keyword) => title.includes(keyword))) {
      if (requestedPenaltyGroups.has(penalty.group)) {
        score += REQUESTED_VARIANT_MATCH_BONUS;
      } else {
        score -= penalty.penalty ?? 12;
      }
    }
  }

  return score;
}

export function pickBestCandidate(
  candidates: TrackCandidate[],
  query = "",
  options: { minimumScore?: number } = {}
): TrackCandidate | undefined {
  const best = rankCandidates(candidates, query)[0];

  if (!best) {
    return undefined;
  }

  const minimumScore = options.minimumScore;
  if (minimumScore !== undefined && scoreCandidate(best, query) < minimumScore) {
    return undefined;
  }

  return best;
}

export function rankCandidates(candidates: TrackCandidate[], query = ""): TrackCandidate[] {
  return candidates
    .filter((candidate) => candidate.title && (candidate.webpage_url || candidate.url))
    .sort((a, b) => scoreCandidate(b, query) - scoreCandidate(a, query));
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
  options: { minimumScore?: number; notFoundMessage?: string } = {}
): Promise<ResolvedTrack> {
  logInfo({
    event: "youtube.search_start",
    query,
    ytDlpQuery: `ytsearch10:${query}`,
    minimumScore: options.minimumScore
  });

  const metadata = await readJson<YtDlpPlaylist>([
    "--dump-single-json",
    "--skip-download",
    "--flat-playlist",
    "--no-warnings",
    `ytsearch10:${query}`
  ]);

  const entries = metadata.entries ?? [];
  const ranked = rankCandidates(entries, query);
  const best = await pickFirstPlayableCandidate(ranked, query, {
    minimumScore: options.minimumScore
  });
  if (!best) {
    logInfo({
      event: "youtube.search_no_candidate",
      query,
      candidateCount: entries.length,
      minimumScore: options.minimumScore
    }, "warn");
    throw new Error(options.notFoundMessage ?? `No playable YouTube results found for: ${query}`);
  }

  logInfo({
    event: "youtube.search_selected",
    query,
    candidateCount: entries.length,
    selectedTitle: best.title,
    selectedChannel: best.channel ?? best.uploader,
    selectedUrl: best.webpage_url ?? best.url,
    selectedScore: scoreCandidate(best, query)
  });

  return toResolvedTrack(best);
}

async function pickFirstPlayableCandidate(
  candidates: TrackCandidate[],
  query: string,
  options: { minimumScore?: number } = {}
): Promise<TrackCandidate | undefined> {
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, query);
    if (options.minimumScore !== undefined && score < options.minimumScore) {
      return undefined;
    }

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
        candidateScore: score,
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

function scoreQueryRelevance(candidate: TrackCandidate, query: string): number {
  const tokens = tokenizeSearchText(query).filter((token) => !QUERY_TOKEN_STOPWORDS.has(token));
  if (tokens.length === 0) {
    return 0;
  }

  const title = normalize(candidate.title);
  const channel = normalize(candidate.channel ?? candidate.uploader);
  let score = 0;
  let titleMatches = 0;

  for (const token of tokens) {
    if (title.includes(token)) {
      score += 18;
      titleMatches += 1;
    } else if (channel.includes(token)) {
      score += 4;
    }
  }

  if (titleMatches === tokens.length) {
    score += 60;
  } else if (titleMatches === 0) {
    score -= 30;
  }

  return score;
}

function tokenizeSearchText(value: string): string[] {
  return normalize(value)
    .split(/[^\p{L}\p{N}.]+/u)
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter((token) => token.length >= 2);
}

const QUERY_TOKEN_STOPWORDS = new Set([
  "official",
  "audio",
  "video",
  "music",
  "mv",
  "the",
  "and",
  "feat",
  "ft",
  "with"
]);

type PenaltyGroup =
  | "cover"
  | "remix"
  | "lyrics"
  | "nightcore"
  | "karaoke"
  | "instrumental"
  | "sped"
  | "slowed"
  | "reaction"
  | "live"
  | "fancam"
  | "fmv"
  | "shorts";

const QUERY_INTENTS: Array<{ group: PenaltyGroup; patterns: RegExp[] }> = [
  { group: "cover", patterns: [/\bcover(?:ed)?\b/i, /커버/i] },
  { group: "remix", patterns: [/\b(?:remix|rmx)\b/i, /리믹스/i] },
  { group: "lyrics", patterns: [/\blyrics?\b/i, /\blyric\s*video\b/i, /가사/i] },
  { group: "nightcore", patterns: [/\bnightcore\b/i, /나이트\s*코어/i] },
  { group: "karaoke", patterns: [/\bkaraoke\b/i, /노래방/i] },
  { group: "instrumental", patterns: [/\binstrumental\b/i, /\binst\.?\b/i, /\bmr\b/i, /반주/i] },
  {
    group: "sped",
    patterns: [
      /\bsped\s*up\b/i,
      /\bspeed\s*up\b/i,
      /\bfast(?:er)?\s*(?:version|ver)?\b/i,
      /빠른\s*(?:버전|ver)?/i,
      /배속/i,
      /스피드\s*업/i
    ]
  },
  {
    group: "slowed",
    patterns: [
      /\bslowed\b/i,
      /\bslow\s*(?:version|ver)?\b/i,
      /느린\s*(?:버전|ver)?/i,
      /저속/i,
      /슬로우/i
    ]
  },
  { group: "reaction", patterns: [/\breaction\b/i, /리액션/i] },
  { group: "live", patterns: [/\blive\b/i, /라이브/i] },
  { group: "fancam", patterns: [/\bfan\s*cam\b/i, /\bfancam\b/i, /직캠/i] },
  {
    group: "fmv",
    patterns: [/\bfmv\b/i, /\bfan[-\s]?made\b/i, /팬\s*메이드/i, /팬\s*무비/i, /팬\s*영상/i]
  },
  { group: "shorts", patterns: [/\bshorts?\b/i, /쇼츠/i] }
];

function getRequestedPenaltyGroups(query: string): Set<PenaltyGroup> {
  const requested = new Set<PenaltyGroup>();
  for (const intent of QUERY_INTENTS) {
    if (intent.patterns.some((pattern) => pattern.test(query))) {
      requested.add(intent.group);
    }
  }
  return requested;
}

function isMusicVideoRequested(query: string): boolean {
  return MUSIC_VIDEO_REQUEST_PATTERNS.some((pattern) => pattern.test(query));
}

const MUSIC_VIDEO_REQUEST_PATTERNS = [
  /\bofficial\s+(?:music\s+)?video\b/i,
  /\bmusic\s+video\b/i,
  /\bofficial\s+mv\b/i,
  /\bmv\b/i,
  /뮤직\s*비디오/i,
  /뮤비/i,
  /공식\s*영상/i,
  /영상/i
];

function isMusicVideoCandidate(candidate: TrackCandidate): boolean {
  const title = normalize(candidate.title);
  return (
    title.includes("official music video") ||
    title.includes("official mv") ||
    title.includes("official video") ||
    /\bmv\b/.test(title) ||
    /\bm\/v\b/.test(title) ||
    title.includes("music video") ||
    title.includes("뮤직비디오") ||
    title.includes("뮤비")
  );
}

function isFmvCandidate(candidate: TrackCandidate): boolean {
  const title = normalize(candidate.title);
  return (
    /\bfmv\b/.test(title) ||
    /\bfan[-\s]?made\b/.test(title) ||
    title.includes("팬메이드") ||
    title.includes("팬 메이드") ||
    title.includes("팬무비") ||
    title.includes("팬 무비") ||
    title.includes("팬영상") ||
    title.includes("팬 영상")
  );
}

function isKaraokeCandidate(candidate: TrackCandidate): boolean {
  const title = normalize(candidate.title);
  return (
    /\bkaraoke\b/.test(title) ||
    /(?:금영|tj|ky)\s*노래방/i.test(title) ||
    /노래방\s*(?:버전|version|ver\.?|반주|mr)(?:$|[^\p{L}\p{N}])/iu.test(title)
  );
}

function hasOfficialSignal(candidate: TrackCandidate): boolean {
  const title = normalize(candidate.title);
  const channel = normalize(candidate.channel ?? candidate.uploader);
  const description = normalize(candidate.description);

  return (
    candidate.channel_is_verified === true ||
    title.includes("official audio") ||
    title.includes("official music video") ||
    title.includes("official mv") ||
    title.includes("official video") ||
    channel.endsWith(" - topic") ||
    channel.includes("topic") ||
    description.includes("provided to youtube by")
  );
}

function logInfo(record: Record<string, unknown>, level: "info" | "warn" | "error" = "info"): void {
  console[level](JSON.stringify(record));
}
