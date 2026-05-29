import { describe, expect, it } from "vitest";
import { buildMusicPanel, parsePanelCustomId } from "../src/ui";
import type { QueueSnapshot } from "../src/player";
import type { Track } from "../src/types";

describe("buildMusicPanel", () => {
  it("disables unavailable controls for an idle player", () => {
    const payload = buildMusicPanel("guild-1", snapshot());
    const playbackButtons = (payload.components[0] as any).components;
    const sessionButtons = (payload.components[1] as any).components;

    expect(playbackButtons[0].label).toBe("Previous");
    expect(playbackButtons[0].disabled).toBe(true);
    expect(playbackButtons[1].label).toBe("Pause");
    expect(playbackButtons[1].disabled).toBe(true);
    expect(playbackButtons[2].label).toBe("Next");
    expect(playbackButtons[2].disabled).toBe(true);
    expect(sessionButtons[0].label).toBe("Stop");
    expect(sessionButtons[0].disabled).toBe(true);
    expect(payload.components).toHaveLength(2);
  });

  it("shows resume and active repeat one while paused", () => {
    const payload = buildMusicPanel(
      "guild-1",
      snapshot({
        current: track("1"),
        paused: true,
        repeatMode: "one",
        connected: true
      })
    );
    const playbackButtons = (payload.components[0] as any).components;

    expect(playbackButtons[1].label).toBe("Resume");
    expect(playbackButtons[1].disabled).toBe(false);
    expect(playbackButtons[3].label).toBe("Repeat One");
    expect(playbackButtons[3].style).toBe(1);
  });

  it("adds a queue select menu only when queued tracks exist", () => {
    const payload = buildMusicPanel(
      "guild-1",
      snapshot({
        current: track("1"),
        queue: [track("2"), track("3")]
      })
    );
    const select = (payload.components[2] as any).components[0];

    expect(payload.components).toHaveLength(3);
    expect(select.custom_id).toBe("music:guild-1:jump");
    expect(select.options.map((option: any) => option.value)).toEqual(["1", "2"]);
  });
});

describe("parsePanelCustomId", () => {
  it("parses music panel custom ids", () => {
    expect(parsePanelCustomId("music:guild-1:repeat-one")).toEqual({
      guildId: "guild-1",
      action: "repeat-one"
    });
  });
});

function snapshot(overrides: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    current: undefined,
    queue: [],
    paused: false,
    repeatMode: "off",
    history: [],
    connected: false,
    ...overrides
  };
}

function track(id: string): Track {
  return {
    id,
    title: `Track ${id}`,
    url: `https://youtube.com/watch?v=${id}`,
    webpageUrl: `https://youtube.com/watch?v=${id}`,
    channel: `Channel ${id}`,
    requestedBy: "tester",
    durationSeconds: 180
  };
}
