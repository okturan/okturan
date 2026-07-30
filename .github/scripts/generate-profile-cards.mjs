#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";

const outDir = "dist";
mkdirSync(outDir, { recursive: true });

const profileUser = process.env.PROFILE_USER || "okturan";
const commitSampleSize = Math.min(1_000, Math.max(1, Math.trunc(Number(process.env.HABITS_LIMIT) || 500)));
const habitsTimeZone = process.env.HABITS_TIMEZONE || "Europe/Tirane";
const habitsWindowHours = Math.min(12, Math.max(1, Math.trunc(Number(process.env.HABITS_WINDOW) || 3)));
const githubApiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
const githubToken = process.env.GITHUB_TOKEN || "";
const requestTimeoutMs = 15_000;

const favoriteAnime = [
  { id: 13125, label: "Shinsekai yori", malUrl: "https://myanimelist.net/anime/13125/Shinsekai_yori" },
  { id: 2246, label: "Mononoke", malUrl: "https://myanimelist.net/anime/2246/Mononoke" },
  { id: 171018, label: "DAN DA DAN", malUrl: "https://myanimelist.net/anime/57334/Dandadan" },
];

const animeFallbacks = new Map([
  [13125, { title: "Shinsekai yori", year: 2012, episodes: 25, score: 84, genres: ["Drama", "Mystery", "Psychological"] }],
  [2246, { title: "Mononoke", year: 2007, episodes: 12, score: 82, genres: ["Horror", "Mystery", "Supernatural"] }],
  [171018, { title: "DAN DA DAN", year: 2024, episodes: 12, score: 84, genres: ["Action", "Comedy", "Supernatural"] }],
]);

const palette = {
  bg: "#0d1117",
  panel: "#161b22",
  panel2: "#111827",
  line: "#30363d",
  text: "#e6edf3",
  muted: "#8b949e",
  blue: "#58a6ff",
  green: "#3fb950",
  orange: "#f78166",
};

const languageColors = new Map([
  ["C", "#555555"],
  ["C#", "#178600"],
  ["C++", "#f34b7d"],
  ["CSS", "#563d7c"],
  ["Go", "#00add8"],
  ["HTML", "#e34c26"],
  ["Java", "#b07219"],
  ["JavaScript", "#f1e05a"],
  ["Kotlin", "#a97bff"],
  ["PHP", "#4f5d95"],
  ["Python", "#3572a5"],
  ["Ruby", "#701516"],
  ["Rust", "#dea584"],
  ["Shell", "#89e051"],
  ["Swift", "#f05138"],
  ["TypeScript", "#3178c6"],
  ["Vue", "#41b883"],
]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, options = {}, label = "request") {
  let lastError;
  let retryDelayMs = 750;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          accept: "application/json",
          "user-agent": `${profileUser}-profile-generator`,
          ...options.headers,
        },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (response.ok) return response.json();

      const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 240);
      const retryable = response.status === 429
        || response.status >= 500
        || (response.status === 403 && /secondary rate limit|temporarily unavailable/i.test(detail));
      lastError = new Error(`${label} failed: ${response.status}${detail ? ` (${detail})` : ""}`);
      lastError.status = response.status;
      lastError.retryable = retryable;
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        retryDelayMs = Math.min(retryAfterSeconds * 1_000, 60_000);
      }
      if (!retryable || attempt === 3) throw lastError;
    } catch (error) {
      lastError = error;
      if (error.retryable === false || attempt === 3) throw error;
    }
    await wait(retryDelayMs);
    retryDelayMs *= 2;
  }
  throw lastError;
}

async function requestGitHub(path, label) {
  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  if (githubToken) headers.authorization = `Bearer ${githubToken}`;
  return requestJson(new URL(path, githubApiUrl), { headers }, label);
}

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function requestAniList(ids) {
  const query = `
    query ($ids: [Int]) {
      Page(perPage: 10) {
        media(id_in: $ids, type: ANIME) {
          id
          title { romaji english }
          coverImage { large extraLarge color }
          averageScore
          episodes
          seasonYear
          genres
          siteUrl
        }
      }
    }
  `;
  const body = await requestJson("https://graphql.anilist.co", {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({ query, variables: { ids } }),
  }, "AniList request");
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join("; "));
  return body.data.Page.media;
}

async function imageDataUri(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
    if (!response.ok) return null;
    const type = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${type};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

async function loadAnime() {
  const ids = favoriteAnime.map((anime) => anime.id);
  let records = [];
  try {
    records = await requestAniList(ids);
  } catch (error) {
    console.warn(`AniList unavailable, using fallback metadata: ${error.message}`);
  }
  const byId = new Map(records.map((anime) => [anime.id, anime]));
  return Promise.all(favoriteAnime.map(async ({ id, label, malUrl }) => {
    const fallback = animeFallbacks.get(id);
    const record = byId.get(id);
    const title = label || record?.title?.english || record?.title?.romaji || fallback.title;
    return {
      id,
      title,
      year: record?.seasonYear || fallback.year,
      episodes: record?.episodes || fallback.episodes,
      score: record?.averageScore || fallback.score,
      genres: (record?.genres?.length ? record.genres : fallback.genres).slice(0, 3),
      siteUrl: malUrl,
      color: record?.coverImage?.color || palette.blue,
      cover: await imageDataUri(record?.coverImage?.extraLarge || record?.coverImage?.large),
    };
  }));
}

function placeholderCover(x, y, w, h, color, title) {
  const initials = title.split(/\s+/).slice(0, 3).map((part) => part[0]).join("").toUpperCase();
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${xml(color || palette.panel2)}"/>
    <text x="${x + w / 2}" y="${y + h / 2 + 8}" text-anchor="middle" font-size="24" font-weight="700" fill="${palette.text}">${xml(initials)}</text>
  `;
}

// Cinematic strip block from github-blocks: cover art as card backdrop under a
// bottom gradient, title + year overlaid. 896 wide = GitHub's README column.
function animeCard(anime, index) {
  const cardWidth = 286;
  const cardHeight = 190;
  const x = index * 305;
  const cover = anime.cover
    ? `<image href="${anime.cover}" x="${x}" y="0" width="${cardWidth}" height="${cardHeight}" preserveAspectRatio="xMidYMid slice" clip-path="url(#cover-${index})"/>`
    : placeholderCover(x, 0, cardWidth, cardHeight, anime.color, anime.title);
  return `
    <a href="${xml(anime.siteUrl)}">
      <clipPath id="cover-${index}"><rect x="${x}" y="0" width="${cardWidth}" height="${cardHeight}" rx="14"/></clipPath>
      ${cover}
      <rect x="${x}" y="0" width="${cardWidth}" height="${cardHeight}" rx="14" fill="url(#strip-fade)" clip-path="url(#cover-${index})"/>
      <text x="${x + 18}" y="${cardHeight - 24}" font-size="18" font-weight="800" fill="#ffffff">${xml(anime.title)}<tspan dx="9" font-size="12.5" font-weight="500" fill="${palette.text}" opacity="0.75">${anime.year}</tspan></text>
      <rect x="${x + 0.5}" y="0.5" width="${cardWidth - 1}" height="${cardHeight - 1}" rx="13.5" fill="none" stroke="#f0f6fc" stroke-opacity="0.14"/>
    </a>
  `;
}

function renderAnimeSvg(anime) {
  const labels = anime.map(({ title }) => title).join(", ");
  const width = 305 * anime.length - 19;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="190" role="img" aria-label="Favorite anime: ${xml(labels)}">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    a { cursor: pointer; }
  </style>
  <defs>
    <linearGradient id="strip-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${palette.bg}" stop-opacity="0.06"/>
      <stop offset="0.5" stop-color="${palette.bg}" stop-opacity="0.24"/>
      <stop offset="1" stop-color="${palette.bg}" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  ${anime.map(animeCard).join("\n")}
</svg>
`;
}

async function loadGitHubProfile() {
  return requestGitHub(`/users/${encodeURIComponent(profileUser)}`, "GitHub profile request");
}

async function loadPublicRepositories() {
  const repositories = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await requestGitHub(
      `/users/${encodeURIComponent(profileUser)}/repos?type=owner&sort=updated&direction=desc&per_page=100&page=${page}`,
      `GitHub repositories page ${page}`,
    );
    repositories.push(...batch);
    if (batch.length < 100) break;
  }
  return repositories;
}

async function loadRecentCommits() {
  const commits = [];
  const seen = new Set();
  const pages = 10;
  const query = encodeURIComponent(`author:${profileUser} merge:false is:public`);

  for (let page = 1; page <= pages; page++) {
    const result = await requestGitHub(
      `/search/commits?q=${query}&sort=author-date&order=desc&per_page=100&page=${page}`,
      `GitHub commit search page ${page}`,
    );
    if (result.incomplete_results) throw new Error("GitHub commit search returned incomplete results");
    for (const item of result.items ?? []) {
      if (!item.commit?.author?.date || seen.has(item.sha)) continue;
      seen.add(item.sha);
      commits.push(item);
      if (commits.length === commitSampleSize) break;
    }
    if ((result.items?.length ?? 0) < 100 || commits.length === commitSampleSize) break;
  }

  if (!commits.length) throw new Error(`GitHub commit search returned no public commits for ${profileUser}`);
  return { commits };
}

async function loadLanguageTotals(repositories) {
  const totals = new Map();
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < repositories.length) {
      const repository = repositories[nextIndex++];
      try {
        const languages = await requestGitHub(
          `/repos/${encodeURIComponent(repository.owner.login)}/${encodeURIComponent(repository.name)}/languages`,
          `GitHub languages for ${repository.full_name}`,
        );
        for (const [language, bytes] of Object.entries(languages)) {
          totals.set(language, (totals.get(language) || 0) + bytes);
        }
      } catch (error) {
        if (error.status !== 404) throw error;
        console.warn(`Skipping deleted repository ${repository.full_name}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(6, repositories.length) }, () => worker());
  await Promise.all(workers);
  const languages = [...totals.entries()]
    .map(([name, bytes]) => ({ name, bytes, color: languageColors.get(name) || palette.muted }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  if (!languages.length) throw new Error("GitHub language requests returned no data");
  return languages;
}

function localDatePart(date, options) {
  return new Intl.DateTimeFormat("en-US", { timeZone: habitsTimeZone, ...options }).format(date);
}

function analyzeCommits(commits) {
  const dates = commits.map((item) => new Date(item.commit.author.date));
  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const weekdayCounts = Object.fromEntries(weekdayNames.map((day) => [day, 0]));
  const activeDateCounts = new Map();
  const windowCounts = new Map();
  for (const date of dates) {
    const hour = Number(localDatePart(date, { hour: "2-digit", hourCycle: "h23" }));
    const start = Math.floor(hour / habitsWindowHours) * habitsWindowHours;
    const day = localDatePart(date, { weekday: "long" });
    const activeDate = localDatePart(date, { year: "numeric", month: "2-digit", day: "2-digit" });
    weekdayCounts[day] += 1;
    windowCounts.set(start, (windowCounts.get(start) || 0) + 1);
    activeDateCounts.set(activeDate, (activeDateCounts.get(activeDate) || 0) + 1);
  }
  const busiestDay = weekdayNames.reduce((best, day) =>
    weekdayCounts[day] > weekdayCounts[best] ? day : best, weekdayNames[0]);
  const busiestWindowStart = [...windowCounts.entries()]
    .sort(([aHour, aCount], [bHour, bCount]) => bCount - aCount || aHour - bHour)[0]?.[0] ?? 0;
  const commitsPerActiveDate = [...activeDateCounts.values()].sort((a, b) => a - b);
  const midpoint = Math.floor(commitsPerActiveDate.length / 2);
  const medianPerActiveDate = commitsPerActiveDate.length % 2
    ? commitsPerActiveDate[midpoint]
    : (commitsPerActiveDate[midpoint - 1] + commitsPerActiveDate[midpoint]) / 2;
  const oldest = new Date(Math.min(...dates));
  const newest = new Date(Math.max(...dates));
  const oldestYear = localDatePart(oldest, { year: "numeric" });
  const newestYear = localDatePart(newest, { year: "numeric" });
  const oldestLabel = localDatePart(oldest, {
    month: "short",
    day: "numeric",
    ...(oldestYear === newestYear ? {} : { year: "numeric" }),
  });
  const newestLabel = localDatePart(newest, { month: "short", day: "numeric", year: "numeric" });
  return {
    count: commits.length,
    window: `${String(busiestWindowStart).padStart(2, "0")}:00–${String((busiestWindowStart + habitsWindowHours - 1) % 24).padStart(2, "0")}:59`,
    windowCount: windowCounts.get(busiestWindowStart) || 0,
    day: busiestDay,
    dayCount: weekdayCounts[busiestDay],
    weekdayCounts,
    activeDateCount: activeDateCounts.size,
    medianPerActiveDate,
    range: `${oldestLabel} – ${newestLabel}`,
  };
}

function renderFactsSvg(commitItems, theme = "dark") {
  const commits = analyzeCommits(commitItems);
  const dark = theme !== "light";
  const colors = dark
    ? { bg: palette.bg, line: palette.line, text: palette.text, muted: palette.muted, accent: palette.blue, bar: palette.green }
    : { bg: "#ffffff", line: "#d0d7de", text: "#1f2328", muted: "#656d76", accent: "#0969da", bar: "#1a7f37" };
  const shortDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const fullDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const dayCounts = fullDays.map((day) => commits.weekdayCounts[day]);
  const maxDayCount = Math.max(1, ...dayCounts);
  const bars = dayCounts.map((count, index) => {
    const x = 552 + index * 43;
    const height = Math.max(3, Math.round((count / maxDayCount) * 78));
    return `<rect x="${x}" y="${236 - height}" width="24" height="${height}" rx="4" fill="${colors.bar}" opacity="${count === maxDayCount ? 1 : 0.48}"/>
    <text x="${x + 12}" y="258" text-anchor="middle" font-size="10.5" fill="${colors.muted}">${shortDays[index]}</text>`;
  }).join("\n  ");
  const median = Number.isInteger(commits.medianPerActiveDate)
    ? commits.medianPerActiveDate
    : commits.medianPerActiveDate.toFixed(1);
  const subtitle = `${commits.count} recent indexed public default-branch non-merge commits · ${commits.range} · ${habitsTimeZone}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="896" height="300" role="img" aria-label="${xml(subtitle)}">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  </style>
  <rect x="0.5" y="0.5" width="895" height="299" rx="16" fill="${colors.bg}" stroke="${colors.line}"/>
  <text x="28" y="48" font-size="27" font-weight="800" fill="${colors.text}" letter-spacing="-0.4">RECENT PUBLIC CODING HABITS</text>
  <text x="28" y="78" font-size="13.5" fill="${colors.accent}">${xml(subtitle)}</text>
  <path d="M28 98H868" stroke="${colors.line}"/>
  <text x="28" y="132" font-size="15.5" fill="${colors.muted}">Most commits land on <tspan fill="${colors.text}" font-weight="700">${xml(commits.day)}</tspan> (${commits.dayCount} of ${commits.count})</text>
  <text x="28" y="166" font-size="15.5" fill="${colors.muted}">Most common commit window: <tspan fill="${colors.text}" font-weight="700">${xml(commits.window)}</tspan> (${commits.windowCount} of ${commits.count})</text>
  <text x="28" y="200" font-size="15.5" fill="${colors.muted}"><tspan fill="${colors.text}" font-weight="700">${commits.activeDateCount}</tspan> active dates represented in this sample</text>
  <text x="28" y="234" font-size="15.5" fill="${colors.muted}">Median activity: <tspan fill="${colors.text}" font-weight="700">${median} commits</tspan> per active date</text>
  <text x="552" y="126" font-size="10.5" font-weight="700" letter-spacing="1.2" fill="${colors.muted}">COMMITS BY WEEKDAY</text>
  ${bars}
</svg>
`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function renderStatsSvg(profile, repositories) {
  const originalRepositories = repositories.filter((repository) => !repository.fork);
  const stats = [
    { label: "Public repos", value: profile.public_repos },
    { label: "Original repos", value: originalRepositories.length },
    { label: "Stars earned", value: originalRepositories.reduce((sum, repository) => sum + repository.stargazers_count, 0) },
    { label: "Followers", value: profile.followers },
  ];
  const positions = [
    { x: 34, y: 84 },
    { x: 225, y: 84 },
    { x: 34, y: 151 },
    { x: 225, y: 151 },
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="190" role="img" aria-label="GitHub at a glance for ${xml(profileUser)}">
  <style>text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }</style>
  <rect width="420" height="190" rx="18" fill="${palette.bg}"/>
  <text x="34" y="39" font-size="23" font-weight="800" fill="${palette.text}">GitHub at a glance</text>
  <path d="M210 58V170" stroke="${palette.line}"/>
  <path d="M24 113H396" stroke="${palette.line}"/>
  ${stats.map((stat, index) => `
  <text x="${positions[index].x}" y="${positions[index].y}" font-size="25" font-weight="800" fill="${index === 0 ? palette.blue : palette.text}">${formatNumber(stat.value)}</text>
  <text x="${positions[index].x}" y="${positions[index].y + 22}" font-size="13" fill="${palette.muted}">${xml(stat.label)}</text>`).join("")}
</svg>
`;
}

function renderLanguagesSvg(languages, repositoryCount) {
  const totalBytes = languages.reduce((sum, language) => sum + language.bytes, 0);
  const topLanguages = languages.slice(0, 6).map((language) => ({
    ...language,
    percentage: (language.bytes / totalBytes) * 100,
  }));
  let barX = 28;
  const barSegments = languages.slice(0, 10).map((language) => {
    const width = (language.bytes / totalBytes) * 364;
    const segment = `<rect x="${barX.toFixed(2)}" y="70" width="${Math.max(width, 0.5).toFixed(2)}" height="10" fill="${language.color}"/>`;
    barX += width;
    return segment;
  }).join("\n    ");
  const rows = topLanguages.map((language, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 32 + column * 194;
    const y = 108 + row * 27;
    const percentage = language.percentage >= 10 ? language.percentage.toFixed(0) : language.percentage.toFixed(1);
    return `
  <circle cx="${x}" cy="${y - 5}" r="5" fill="${language.color}"/>
  <text x="${x + 12}" y="${y}" font-size="13" font-weight="600" fill="${palette.text}">${xml(language.name)}</text>
  <text x="${x + 159}" y="${y}" text-anchor="end" font-size="12" fill="${palette.muted}">${percentage}%</text>`;
  }).join("");
  const aria = topLanguages.map((language) => `${language.name} ${language.percentage.toFixed(1)}%`).join(", ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="190" role="img" aria-label="Top languages: ${xml(aria)}">
  <style>text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }</style>
  <rect width="420" height="190" rx="18" fill="${palette.bg}"/>
  <text x="28" y="35" font-size="23" font-weight="800" fill="${palette.text}">Top languages</text>
  <text x="28" y="56" font-size="12" fill="${palette.muted}">${repositoryCount} owned public repos • excluding forks and archives</text>
  <clipPath id="language-bar"><rect x="28" y="70" width="364" height="10" rx="5"/></clipPath>
  <g clip-path="url(#language-bar)">
    <rect x="28" y="70" width="364" height="10" fill="${palette.line}"/>
    ${barSegments}
  </g>${rows}
</svg>
`;
}

const [anime, profile, repositories, commitData] = await Promise.all([
  loadAnime(),
  loadGitHubProfile(),
  loadPublicRepositories(),
  loadRecentCommits(),
]);
const languageRepositories = repositories.filter((repository) => !repository.fork && !repository.archived && !repository.disabled);
const languages = await loadLanguageTotals(languageRepositories);

writeFileSync(`${outDir}/profile-anime.svg`, renderAnimeSvg(anime));
for (const favorite of anime) {
  writeFileSync(`${outDir}/profile-anime-${favorite.id}.svg`, renderAnimeSvg([favorite]));
}
writeFileSync(`${outDir}/profile-facts.svg`, renderFactsSvg(commitData.commits));
writeFileSync(`${outDir}/profile-facts-light.svg`, renderFactsSvg(commitData.commits, "light"));
writeFileSync(`${outDir}/profile-stats.svg`, renderStatsSvg(profile, repositories));
writeFileSync(`${outDir}/profile-languages.svg`, renderLanguagesSvg(languages, languageRepositories.length));
console.log(`Generated profile cards from ${commitData.commits.length} public commits and ${languageRepositories.length} repositories`);
