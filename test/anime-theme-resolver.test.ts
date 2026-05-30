import { describe, expect, it } from "vitest";
import { parseAnimeThemeRequest } from "../src/anime-theme-resolver";

describe("anime theme resolver", () => {
  it.each(["실지주 1기 op", "실지주 1기 OP", "실지주 1기 오프닝", "실지주 1기 여는 곡"])(
    "parses OP request: %s",
    (query) => {
      expect(parseAnimeThemeRequest(query)).toEqual({
        originalQuery: query,
        animeTitle: "실지주",
        season: 1,
        theme: "OP"
      });
    }
  );

  it.each(["실지주 2기 ed", "실지주 2기 ED", "실지주 2기 엔딩", "실지주 2기 닫는 곡"])(
    "parses ED request: %s",
    (query) => {
      expect(parseAnimeThemeRequest(query)).toEqual({
        originalQuery: query,
        animeTitle: "실지주",
        season: 2,
        theme: "ED"
      });
    }
  );

  it("parses Hyouka OP requests", () => {
    expect(parseAnimeThemeRequest("빙과 op")).toEqual({
      originalQuery: "빙과 op",
      animeTitle: "빙과",
      theme: "OP"
    });
  });

  it.each([
    ["바케모노가타리 op1", 1],
    ["바케모노가타리 op 1", 1],
    ["바케모노가타리 1번째 오프닝", 1],
    ["바케모노가타리 첫번째 오프닝", 1],
    ["바케모노가타리 두 번째 오프닝", 2]
  ])("parses numbered OP requests: %s", (query, themeNumber) => {
    expect(parseAnimeThemeRequest(query)).toEqual({
      originalQuery: query,
      animeTitle: "바케모노가타리",
      theme: "OP",
      themeNumber
    });
  });

  it.each([
    ["실지주 ed1", 1],
    ["실지주 ed 2", 2],
    ["실지주 2번째 엔딩", 2],
    ["실지주 두 번째 닫는 곡", 2]
  ])("parses numbered ED requests: %s", (query, themeNumber) => {
    expect(parseAnimeThemeRequest(query)).toEqual({
      originalQuery: query,
      animeTitle: "실지주",
      theme: "ED",
      themeNumber
    });
  });
});
