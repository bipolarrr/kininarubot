import { describe, expect, it } from "vitest";
import {
  isLikelyUrl,
  isYouTubeUrl,
  pickBestCandidate,
  resolveTrack,
  scoreCandidate
} from "../src/youtube";

describe("youtube helpers", () => {
  const requestedVariantMatchDelta = 132;

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

  it("prefers audio releases over official music videos for normal song searches", () => {
    const officialAudio = {
      title: "Artist - Song (Official Audio)",
      channel: "Artist - Topic",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=official-audio",
      description: "Provided to YouTube by Example Label"
    };
    const officialMusicVideo = {
      title: "Artist - Song [Official Music Video]",
      channel: "Artist Official",
      channel_is_verified: true,
      duration: 240,
      webpage_url: "https://youtube.com/watch?v=official-mv"
    };

    expect(scoreCandidate(officialAudio, "artist song")).toBeGreaterThan(
      scoreCandidate(officialMusicVideo, "artist song")
    );
    expect(pickBestCandidate([officialMusicVideo, officialAudio], "artist song")).toBe(
      officialAudio
    );
  });

  it("keeps official music videos competitive when the query asks for an MV", () => {
    const officialAudio = {
      title: "Artist - Song (Official Audio)",
      channel: "Artist - Topic",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=official-audio",
      description: "Provided to YouTube by Example Label"
    };
    const officialMusicVideo = {
      title: "Artist - Song [Official Music Video]",
      channel: "Artist Official",
      channel_is_verified: true,
      duration: 240,
      webpage_url: "https://youtube.com/watch?v=official-mv"
    };

    expect(scoreCandidate(officialMusicVideo, "artist song mv")).toBeGreaterThan(
      scoreCandidate(officialMusicVideo, "artist song")
    );
    expect(pickBestCandidate([officialAudio, officialMusicVideo], "artist song mv")).toBe(
      officialMusicVideo
    );
  });

  it("penalizes FMV results more than official music videos", () => {
    const officialMusicVideo = {
      title: "Artist - Song [Official Music Video]",
      channel: "Artist Official",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=official-mv"
    };
    const fmv = {
      title: "[FMV] Artist - Song",
      channel: "Fan Channel",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=fmv"
    };

    expect(scoreCandidate(fmv, "artist song")).toBeLessThan(
      scoreCandidate(officialMusicVideo, "artist song")
    );
  });

  it("keeps Korean title-matching FMVs below official Topic audio with translated titles", () => {
    const officialTopic = {
      title: "FIX THAT OPTIMISM",
      channel: "Alfredo - Topic",
      duration: 116,
      webpage_url: "https://youtube.com/watch?v=official-topic",
      description: "Provided to YouTube by FLUXUS"
    };
    const fmv = {
      title: "[FMV] Alfredo - 긍정적 성격을 고쳐라",
      channel: "Fan Channel",
      duration: 66,
      webpage_url: "https://youtube.com/watch?v=fmv"
    };

    expect(pickBestCandidate([fmv, officialTopic], "긍정적 성격을 고쳐라")).toBe(
      officialTopic
    );
  });

  it("allows FMV results when the query asks for an FMV", () => {
    const officialTopic = {
      title: "Artist - Song",
      channel: "Artist - Topic",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=official-topic",
      description: "Provided to YouTube by Example Label"
    };
    const fmv = {
      title: "[FMV] Artist - Song",
      channel: "Fan Channel",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=fmv"
    };

    expect(scoreCandidate(fmv, "artist song fmv")).toBeGreaterThan(
      scoreCandidate(fmv, "artist song")
    );
    expect(pickBestCandidate([officialTopic, fmv], "artist song fmv")).toBe(fmv);
  });

  it("relaxes variant penalties when the query asks for them", () => {
    const remix = {
      title: "Artist - Song rmx",
      channel: "Fan Channel",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=rmx"
    };
    const spedUp = {
      title: "Artist - Song sped up",
      channel: "Fan Channel",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=sped"
    };

    expect(scoreCandidate(remix, "artist song rmx")).toBeGreaterThanOrEqual(
      scoreCandidate(remix, "artist song") + requestedVariantMatchDelta
    );
    expect(scoreCandidate(spedUp, "artist song 빠른 버전")).toBeGreaterThan(
      scoreCandidate(spedUp, "artist song")
    );
  });

  it("only lightly penalizes lyrics results for normal song searches", () => {
    const plainUpload = {
      title: "Artist - Song",
      channel: "Fan Channel",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=plain"
    };
    const lyricsUpload = {
      title: "Artist - Song lyrics",
      channel: "Fan Channel",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=lyrics"
    };

    expect(scoreCandidate(lyricsUpload, "artist song")).toBe(
      scoreCandidate(plainUpload, "artist song") - 4
    );
    expect(scoreCandidate(lyricsUpload, "artist song lyrics")).toBeGreaterThan(
      scoreCandidate(lyricsUpload, "artist song")
    );
  });

  it("hard-penalizes karaoke results", () => {
    const karaokeTitles = [
      "Artist - Song karaoke",
      "Artist - Song 금영노래방",
      "Artist - Song 금영 노래방",
      "Artist - Song TJ노래방",
      "Artist - Song KY노래방",
      "Artist - Song KY 노래방",
      "Artist - Song 노래방 버전",
      "Artist - Song 노래방 version",
      "Artist - Song 노래방 반주",
      "Artist - Song 노래방 MR"
    ];

    for (const title of karaokeTitles) {
      expect(
        scoreCandidate(
          {
            title,
            channel: "Karaoke Channel",
            duration: 210,
            webpage_url: `https://youtube.com/watch?v=${encodeURIComponent(title)}`
          },
          "artist song karaoke"
        )
      ).toBe(-9999);
    }
  });

  it("does not hard-penalize normal titles containing 노래방", () => {
    const normalTitles = [
      "장범준 - 노래방에서",
      "Artist - 노래방을",
      "Artist - 노래방에",
      "Artist - 노래방이"
    ];

    for (const title of normalTitles) {
      expect(
        scoreCandidate({
          title,
          channel: "Music Channel",
          duration: 210,
          webpage_url: `https://youtube.com/watch?v=${encodeURIComponent(title)}`
        })
      ).not.toBe(-9999);
    }
  });

  it("prefers a normal 노래방 title over a karaoke-company candidate", () => {
    const normalSong = {
      title: "장범준 - 노래방에서",
      channel: "Music Channel",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=normal-noraebang"
    };
    const karaokeCompany = {
      title: "장범준 - 노래방에서 금영노래방",
      channel: "Karaoke Channel",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=kumyoung-noraebang"
    };

    expect(scoreCandidate(karaokeCompany, "장범준 노래방에서")).toBe(-9999);
    expect(pickBestCandidate([karaokeCompany, normalSong], "장범준 노래방에서")).toBe(
      normalSong
    );
  });

  it("prefers the requested remix variant over the official original", () => {
    const officialOriginal = {
      title: "Artist - Song (Official Audio)",
      channel: "Artist - Topic",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=official-original"
    };
    const animeRemix = {
      title: "Artist - Song Anime Remix",
      channel: "Remix Artist",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=anime-remix"
    };

    expect(scoreCandidate(animeRemix, "artist song anime remix")).toBeGreaterThan(
      scoreCandidate(officialOriginal, "artist song anime remix")
    );
    expect(pickBestCandidate([officialOriginal, animeRemix], "artist song anime remix")).toBe(
      animeRemix
    );
  });

  it("prefers a title-matching unofficial track over a different official song by the same artist", () => {
    const officialPopularSong = {
      title: "Artist - Popular Song (Official Audio)",
      channel: "Artist - Topic",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=popular"
    };
    const matchingUnofficialSong = {
      title: "Artist - Unreleased Track",
      channel: "Fan Channel",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=unreleased"
    };

    expect(scoreCandidate(matchingUnofficialSong, "artist unreleased track")).toBeGreaterThan(
      scoreCandidate(officialPopularSong, "artist unreleased track")
    );
    expect(
      pickBestCandidate(
        [officialPopularSong, matchingUnofficialSong],
        "artist unreleased track"
      )
    ).toBe(matchingUnofficialSong);
  });

  it("does not apply the title live penalty when the query asks for live", () => {
    const livePerformance = {
      title: "Artist - Song live",
      channel: "Fan Channel",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=live-performance"
    };

    expect(scoreCandidate(livePerformance, "artist song live")).toBeGreaterThanOrEqual(
      scoreCandidate(livePerformance, "artist song") + requestedVariantMatchDelta
    );
  });

  it("penalizes fancam results unless the query asks for a fancam", () => {
    const fancam = {
      title: "Artist - Song 직캠",
      channel: "Fan Channel",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=fancam"
    };

    expect(scoreCandidate(fancam, "artist song 직캠")).toBeGreaterThanOrEqual(
      scoreCandidate(fancam, "artist song") + requestedVariantMatchDelta
    );
  });

  it("keeps penalizing active livestreams even when the query asks for live", () => {
    const livePerformance = {
      title: "Artist - Song live",
      channel: "Fan Channel",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=live-performance"
    };
    const activeLivestream = {
      ...livePerformance,
      webpage_url: "https://youtube.com/watch?v=active-livestream",
      is_live: true
    };

    expect(scoreCandidate(activeLivestream, "artist song live")).toBe(
      scoreCandidate(livePerformance, "artist song live") - 80
    );
  });

  it("only penalizes long videos when they lack official signals", () => {
    const officialLong = {
      title: "Artist - Long Song (Official Audio)",
      channel: "Artist - Topic",
      duration: 1200,
      webpage_url: "https://youtube.com/watch?v=official-long"
    };
    const unofficialLong = {
      title: "Artist - Long Song",
      channel: "Fan Channel",
      duration: 1200,
      webpage_url: "https://youtube.com/watch?v=unofficial-long"
    };

    expect(scoreCandidate(officialLong)).toBeGreaterThan(scoreCandidate(unofficialLong));
  });

  it("rejects low-scoring candidates when a minimum score is required", () => {
    const unrelated = {
      title: "Completely Different Clip",
      channel: "Fan Channel",
      duration: 210,
      webpage_url: "https://youtube.com/watch?v=unrelated"
    };

    expect(pickBestCandidate([unrelated], "실지주 1기 op")).toBe(unrelated);
    expect(pickBestCandidate([unrelated], "실지주 1기 op", { minimumScore: 45 })).toBeUndefined();
  });

  it("rejects anime theme requests while automatic theme search is disabled", async () => {
    await expect(resolveTrack("빙과 op")).rejects.toThrow(
      "애니 OP/ED 자동 검색은 잠시 꺼져 있습니다. 곡명이나 아티스트를 함께 입력해 주세요."
    );
  });

  it("prefers a resolved official anime theme query over fan variants", () => {
    const fanLyrics = {
      title: "Classroom of the Elite OP Caste Room lyrics",
      channel: "Fan Channel",
      duration: 90,
      webpage_url: "https://youtube.com/watch?v=lyrics"
    };
    const officialTopic = {
      title: "ZAQ - Caste Room",
      channel: "ZAQ - Topic",
      duration: 270,
      webpage_url: "https://youtube.com/watch?v=official",
      description: "Provided to YouTube by Lantis"
    };

    expect(
      pickBestCandidate([fanLyrics, officialTopic], '"Caste Room" "ZAQ" 실지주 OP official')
    ).toBe(officialTopic);
  });
});
