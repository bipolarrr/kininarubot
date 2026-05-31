import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackCandidate } from "../src/types";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock
}));

import {
  appendLyricsToSearchQuery,
  isLikelyUrl,
  isYouTubeUrl,
  pickBestCandidate,
  rankCandidates,
  resolveTrack
} from "../src/youtube";

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

describe("youtube helpers", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("detects YouTube URLs separately from search queries", () => {
    expect(isLikelyUrl("https://youtu.be/abc")).toBe(true);
    expect(isYouTubeUrl("https://music.youtube.com/watch?v=abc")).toBe(true);
    expect(isLikelyUrl("artist song name")).toBe(false);
    expect(isYouTubeUrl("https://example.com/watch?v=abc")).toBe(false);
  });

  it("adds lyrics to non-URL search queries unless lyrics are already requested", () => {
    expect(appendLyricsToSearchQuery("artist song")).toBe("artist song lyrics");
    expect(appendLyricsToSearchQuery(" artist song ")).toBe("artist song lyrics");
    expect(appendLyricsToSearchQuery("artist song lyrics")).toBe("artist song lyrics");
    expect(appendLyricsToSearchQuery("artist song lyric video")).toBe("artist song lyric video");
    expect(appendLyricsToSearchQuery("artist song 가사")).toBe("artist song 가사");
  });

  it("keeps candidates in yt-dlp order without score sorting", () => {
    const first = candidate("Fan cover lyrics", "first");
    const second = candidate("Official Audio", "second");
    const third = candidate("Broadcast clip", "third");

    expect(rankCandidates([first, second, third], "artist song")).toEqual([
      first,
      second,
      third
    ]);
    expect(pickBestCandidate([first, second, third], "artist song")).toBe(first);
  });

  it("filters candidates without a title or URL while preserving the remaining order", () => {
    const first = candidate("First playable", "first");
    const missingTitle = { webpage_url: "https://youtube.com/watch?v=missing-title" };
    const missingUrl = { title: "Missing URL" };
    const second = candidate("Second playable", "second");

    expect(rankCandidates([first, missingTitle, missingUrl, second])).toEqual([first, second]);
  });

  it("filters exact karaoke title blacklist phrases", () => {
    const normal = candidate("Artist - Song 노래방에서", "normal");
    const tj = candidate("Artist - Song TJ노래방", "tj");
    const ky = candidate("Artist - Song KY 금영노래방", "ky");
    const kyKaraoke = candidate("Artist - Song KY KARAOKE", "ky-karaoke");
    const spacedTj = candidate("Artist - Song TJ 노래방", "spaced-tj");
    const unspacedKy = candidate("Artist - Song KY금영노래방", "unspaced-ky");
    const spacedKyKaraoke = candidate("Artist - Song KY  KARAOKE", "spaced-ky-karaoke");

    expect(rankCandidates([tj, normal, ky, kyKaraoke, spacedTj, unspacedKy, spacedKyKaraoke])).toEqual([
      normal,
      spacedTj,
      unspacedKy,
      spacedKyKaraoke
    ]);
  });

  it("filters search candidates longer than 10 minutes", () => {
    const long = { ...candidate("Long mix", "long"), duration: 601 };
    const exactlyTenMinutes = { ...candidate("Ten minute track", "ten-minutes"), duration: 600 };
    const unknownDuration = { ...candidate("Unknown duration", "unknown"), duration: undefined };

    expect(rankCandidates([long, exactlyTenMinutes, unknownDuration])).toEqual([
      exactlyTenMinutes,
      unknownDuration
    ]);
  });

  it("resolves URL input directly without adding lyrics or using ytsearch", async () => {
    execFileMock.mockImplementationOnce((_file, args: string[], ...rest: unknown[]) => {
      const callback = getExecFileCallback(rest);
      expect(args).toContain("https://youtu.be/direct");
      callback(
        null,
        JSON.stringify({
          id: "direct",
          title: "Direct URL Track",
          webpage_url: "https://youtu.be/direct"
        }),
        ""
      );
    });

    const track = await resolveTrack("https://youtu.be/direct");

    expect(track.title).toBe("Direct URL Track");
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const args = execFileMock.mock.calls[0][1] as string[];
    expect(args.some((arg) => arg.startsWith("ytsearch"))).toBe(false);
    expect(args.join(" ")).not.toContain("lyrics");
  });

  it("rejects direct URL input longer than 10 minutes", async () => {
    execFileMock.mockImplementationOnce((_file, _args: string[], ...rest: unknown[]) => {
      const callback = getExecFileCallback(rest);
      callback(
        null,
        JSON.stringify({
          id: "long-url",
          title: "Long URL Track",
          duration: 601,
          webpage_url: "https://youtu.be/long-url"
        }),
        ""
      );
    });

    await expect(resolveTrack("https://youtu.be/long-url")).rejects.toThrow(
      "Tracks longer than 10 minutes are not supported."
    );
  });

  it("searches non-URL input with ytsearch20 and automatic lyrics", async () => {
    mockSearchResults([candidate("Artist - Song lyrics", "lyrics")]);
    mockPlayableUrl();

    const track = await resolveTrack("artist song");

    expect(track.title).toBe("Artist - Song lyrics");
    expect(searchArgument()).toBe("ytsearch20:artist song lyrics");
  });

  it("does not duplicate lyrics for English or Korean lyrics queries", async () => {
    mockSearchResults([candidate("Artist - Song lyrics", "lyrics")]);
    mockPlayableUrl();
    await resolveTrack("artist song lyrics");
    expect(searchArgument()).toBe("ytsearch20:artist song lyrics");

    execFileMock.mockReset();
    mockSearchResults([candidate("Artist - Song 가사", "korean-lyrics")]);
    mockPlayableUrl();
    await resolveTrack("artist song 가사");
    expect(searchArgument()).toBe("ytsearch20:artist song 가사");
  });

  it("skips an unplayable first search result and returns the next playable candidate", async () => {
    const unplayable = candidate("First result", "unplayable");
    const playable = candidate("Second result", "playable");
    mockSearchResults([unplayable, playable]);
    mockPlayableUrlFailure();
    mockPlayableUrl("https://audio.example/playable.opus");

    const track = await resolveTrack("artist song");

    expect(track.title).toBe("Second result");
    expect(execFileMock).toHaveBeenCalledTimes(3);
    expect((execFileMock.mock.calls[1][1] as string[]).at(-1)).toBe(unplayable.webpage_url);
    expect((execFileMock.mock.calls[2][1] as string[]).at(-1)).toBe(playable.webpage_url);
  });

  it("handles anime theme-like input through normal search", async () => {
    mockSearchResults([candidate("Hyouka OP lyrics", "hyouka-op")]);
    mockPlayableUrl();

    const track = await resolveTrack("빙과 op");

    expect(track.title).toBe("Hyouka OP lyrics");
    expect(searchArgument()).toBe("ytsearch20:빙과 op lyrics");
  });
});

function candidate(title: string, id: string): TrackCandidate {
  return {
    id,
    title,
    channel: "Example Channel",
    duration: 210,
    webpage_url: `https://youtube.com/watch?v=${id}`
  };
}

function mockSearchResults(entries: TrackCandidate[]): void {
  execFileMock.mockImplementationOnce((_file, _args: string[], ...rest: unknown[]) => {
    const callback = getExecFileCallback(rest);
    callback(null, JSON.stringify({ entries }), "");
  });
}

function mockPlayableUrl(url = "https://audio.example/track.opus"): void {
  execFileMock.mockImplementationOnce((_file, _args: string[], ...rest: unknown[]) => {
    const callback = getExecFileCallback(rest);
    callback(null, `${url}\n`, "");
  });
}

function mockPlayableUrlFailure(): void {
  execFileMock.mockImplementationOnce((_file, _args: string[], ...rest: unknown[]) => {
    const callback = getExecFileCallback(rest);
    callback(new Error("not playable"), "", "");
  });
}

function getExecFileCallback(args: unknown[]): ExecFileCallback {
  const callback = args.at(-1);
  if (typeof callback !== "function") {
    throw new Error("execFile callback was not provided");
  }
  return callback as ExecFileCallback;
}

function searchArgument(): string | undefined {
  const call = execFileMock.mock.calls.find(([, args]) =>
    (args as string[]).some((arg) => arg.startsWith("ytsearch"))
  );
  return (call?.[1] as string[] | undefined)?.find((arg) => arg.startsWith("ytsearch"));
}
