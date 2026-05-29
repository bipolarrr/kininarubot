import { describe, expect, it } from "vitest";
import { isLikelyUrl, isYouTubeUrl, pickBestCandidate, scoreCandidate } from "../src/youtube";

describe("youtube helpers", () => {
  it("detects YouTube URLs separately from search queries", () => {
    expect(isLikelyUrl("https://youtu.be/abc")).toBe(true);
    expect(isYouTubeUrl("https://music.youtube.com/watch?v=abc")).toBe(true);
    expect(isLikelyUrl("artist song name")).toBe(false);
    expect(isYouTubeUrl("https://example.com/watch?v=abc")).toBe(false);
  });

  it("prefers official audio style candidates over covers", () => {
    const official = {
      title: "Artist - Song (Official Audio)",
      channel: "Artist - Topic",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=official",
      description: "Provided to YouTube by Example Label"
    };
    const cover = {
      title: "Artist - Song cover lyrics",
      channel: "Fan Channel",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=cover"
    };

    expect(scoreCandidate(official)).toBeGreaterThan(scoreCandidate(cover));
    expect(pickBestCandidate([cover, official])).toBe(official);
  });
});
