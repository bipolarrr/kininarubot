import { describe, expect, it } from "vitest";
import {
  GuildMusicPlayer,
  applyRepeatModeOnFinish,
  jumpQueue,
  previousQueueTransition
} from "../src/player";
import type { Track } from "../src/types";

describe("jumpQueue", () => {
  it("moves to the selected queue index and drops earlier queued tracks", () => {
    const queue = [track("1"), track("2"), track("3"), track("4")];

    const result = jumpQueue(queue, 3);

    expect(result.target.title).toBe("Track 3");
    expect(result.queue.map((item) => item.title)).toEqual(["Track 3", "Track 4"]);
  });

  it("rejects indexes outside the visible queue range", () => {
    expect(() => jumpQueue([track("1")], 0)).toThrow("between 1 and 1");
    expect(() => jumpQueue([track("1")], 2)).toThrow("between 1 and 1");
  });
});

describe("applyRepeatModeOnFinish", () => {
  it("queues the current track again for repeat one", () => {
    const current = track("1");
    const result = applyRepeatModeOnFinish(current, [track("2")], [], "one");

    expect(result.queue.map((item) => item.title)).toEqual(["Track 1", "Track 2"]);
    expect(result.history).toEqual([]);
  });

  it("moves the finished track to the back for repeat all", () => {
    const current = track("1");
    const result = applyRepeatModeOnFinish(current, [track("2")], [], "all");

    expect(result.queue.map((item) => item.title)).toEqual(["Track 2", "Track 1"]);
    expect(result.history.map((item) => item.title)).toEqual(["Track 1"]);
  });

  it("stores the finished track in history when repeat is off", () => {
    const current = track("1");
    const result = applyRepeatModeOnFinish(current, [track("2")], [], "off");

    expect(result.queue.map((item) => item.title)).toEqual(["Track 2"]);
    expect(result.history.map((item) => item.title)).toEqual(["Track 1"]);
  });
});

describe("previousQueueTransition", () => {
  it("moves the previous track ahead of the current track", () => {
    const result = previousQueueTransition(track("2"), [track("3")], [track("1")]);

    expect(result.target?.title).toBe("Track 1");
    expect(result.queue.map((item) => item.title)).toEqual(["Track 1", "Track 2", "Track 3"]);
    expect(result.history).toEqual([]);
  });

  it("does nothing when there is no history", () => {
    const result = previousQueueTransition(track("2"), [track("3")], []);

    expect(result.target).toBeUndefined();
    expect(result.queue.map((item) => item.title)).toEqual(["Track 3"]);
    expect(result.history).toEqual([]);
  });
});

describe("GuildMusicPlayer controls", () => {
  it("toggles paused state only when there is a current track", () => {
    const player = new GuildMusicPlayer("guild-1", 0, () => undefined);

    expect(player.pause()).toBe(false);

    (player as any).current = track("1");

    expect(player.pause()).toBe(true);
    expect(player.snapshot().paused).toBe(true);
    expect(player.resume()).toBe(true);
    expect(player.snapshot().paused).toBe(false);
  });
});

function track(id: string): Track {
  return {
    id,
    title: `Track ${id}`,
    url: `https://youtube.com/watch?v=${id}`,
    webpageUrl: `https://youtube.com/watch?v=${id}`,
    requestedBy: "tester",
    durationSeconds: 180
  };
}
