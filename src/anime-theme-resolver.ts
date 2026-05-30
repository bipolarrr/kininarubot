export type AnimeThemeKind = "OP" | "ED";

export type AnimeThemeRequest = {
  originalQuery: string;
  animeTitle: string;
  season?: number;
  theme: AnimeThemeKind;
  themeNumber?: number;
};

export function parseAnimeThemeRequest(query: string): AnimeThemeRequest | undefined {
  const trimmed = query.trim();
  if (!trimmed) {
    return undefined;
  }

  const themeMatch = findTheme(trimmed);
  if (!themeMatch) {
    return undefined;
  }

  const season = findSeason(trimmed);
  const themeNumber = findThemeNumber(trimmed, themeMatch.theme);
  const animeTitle = trimmed
    .replace(getThemeNumberCleanupPattern(themeMatch.theme), " ")
    .replace(KOREAN_ORDINAL_THEME_PATTERN, " ")
    .replace(themeMatch.pattern, " ")
    .replace(/\bseason\s*\d+\b/gi, " ")
    .replace(/\bs\s*\d+\b/gi, " ")
    .replace(/\d+\s*기/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!animeTitle) {
    return undefined;
  }

  return {
    originalQuery: trimmed,
    animeTitle,
    season,
    theme: themeMatch.theme,
    themeNumber
  };
}

function findTheme(query: string): { theme: AnimeThemeKind; pattern: RegExp } | undefined {
  const opPattern = /(?:오프닝|여는\s*곡|\bop\s*\d*\b|\bopening\b)/i;
  const edPattern = /(?:엔딩|닫는\s*곡|\bed\s*\d*\b|\bending\b)/i;
  if (opPattern.test(query)) {
    return { theme: "OP", pattern: opPattern };
  }
  if (edPattern.test(query)) {
    return { theme: "ED", pattern: edPattern };
  }
  return undefined;
}

function findSeason(query: string): number | undefined {
  const match =
    query.match(/(\d+)\s*기/) ?? query.match(/\bseason\s*(\d+)\b/i) ?? query.match(/\bs\s*(\d+)\b/i);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const KOREAN_ORDINAL_THEME_PATTERN =
  /(?:첫\s*번째|두\s*번째|세\s*번째|네\s*번째|다섯\s*번째|여섯\s*번째|일곱\s*번째|여덟\s*번째|아홉\s*번째|열\s*번째|\d+\s*번째)\s*(?:오프닝|엔딩|여는\s*곡|닫는\s*곡)/gi;

function findThemeNumber(query: string, theme: AnimeThemeKind): number | undefined {
  const compactTheme = theme.toLocaleLowerCase("en-US");
  const explicitMatch = query.match(new RegExp(`\\b${compactTheme}\\s*(\\d+)\\b`, "i"));
  if (explicitMatch) {
    return parsePositiveInt(explicitMatch[1]);
  }

  const themeWords = theme === "OP" ? /오프닝|여는\s*곡/i : /엔딩|닫는\s*곡/i;
  const koreanMatch = query.match(KOREAN_ORDINAL_THEME_PATTERN)?.find((value) => themeWords.test(value));
  if (!koreanMatch) {
    return undefined;
  }

  const digitMatch = koreanMatch.match(/(\d+)\s*번째/);
  if (digitMatch) {
    return parsePositiveInt(digitMatch[1]);
  }

  return KOREAN_ORDINALS.find((entry) => entry.pattern.test(koreanMatch))?.value;
}

function getThemeNumberCleanupPattern(theme: AnimeThemeKind): RegExp {
  return new RegExp(`\\b${theme.toLocaleLowerCase("en-US")}\\s*\\d+\\b`, "gi");
}

function parsePositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

const KOREAN_ORDINALS: Array<{ pattern: RegExp; value: number }> = [
  { pattern: /첫\s*번째/, value: 1 },
  { pattern: /두\s*번째/, value: 2 },
  { pattern: /세\s*번째/, value: 3 },
  { pattern: /네\s*번째/, value: 4 },
  { pattern: /다섯\s*번째/, value: 5 },
  { pattern: /여섯\s*번째/, value: 6 },
  { pattern: /일곱\s*번째/, value: 7 },
  { pattern: /여덟\s*번째/, value: 8 },
  { pattern: /아홉\s*번째/, value: 9 },
  { pattern: /열\s*번째/, value: 10 }
];
