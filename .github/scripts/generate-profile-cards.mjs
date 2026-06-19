#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";

const outDir = "dist";
mkdirSync(outDir, { recursive: true });

const favoriteAnime = [
  { id: 13125, label: "Shinsekai yori" },
  { id: 2246, label: "Mononoke" },
  { id: 171018, label: "DAN DA DAN" },
];

const animeFallbacks = new Map([
  [13125, { title: "Shinsekai yori", year: 2012, episodes: 25, score: 84, genres: ["Drama", "Mystery", "Psychological"], siteUrl: "https://anilist.co/anime/13125/Shinsekai-yori/" }],
  [2246, { title: "Mononoke", year: 2007, episodes: 12, score: 82, genres: ["Horror", "Mystery", "Supernatural"], siteUrl: "https://anilist.co/anime/2246/Mononoke/" }],
  [171018, { title: "DAN DA DAN", year: 2024, episodes: 12, score: 84, genres: ["Action", "Comedy", "Supernatural"], siteUrl: "https://anilist.co/anime/171018/DAN-DA-DAN/" }],
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

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function textLines(text, maxLength, maxLines = 2) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
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
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({ query, variables: { ids } }),
  });
  if (!response.ok) throw new Error(`AniList request failed: ${response.status}`);
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join("; "));
  return body.data.Page.media;
}

async function imageDataUri(url) {
  if (!url) return null;
  try {
    const response = await fetch(url);
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
  return Promise.all(favoriteAnime.map(async ({ id, label }) => {
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
      siteUrl: record?.siteUrl || fallback.siteUrl,
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

function animeCard(anime, index) {
  const cardWidth = 258;
  const x = 34 + index * 276;
  const y = 78;
  const coverX = x + 16;
  const coverY = y + 18;
  const coverW = 82;
  const coverH = 116;
  const titleLines = textLines(anime.title, 16, 2);
  const titleSvg = titleLines.map((line, i) =>
    `<tspan x="${x + 112}" dy="${i === 0 ? 0 : 22}">${xml(line)}</tspan>`
  ).join("");
  const meta = `${anime.year} / ${anime.episodes} eps / ${anime.score}%`;
  const genres = anime.genres.join(" / ");
  const cover = anime.cover
    ? `<image href="${anime.cover}" x="${coverX}" y="${coverY}" width="${coverW}" height="${coverH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#cover-${index})"/>`
    : placeholderCover(coverX, coverY, coverW, coverH, anime.color, anime.title);
  return `
    <a href="${xml(anime.siteUrl)}">
      <rect x="${x}" y="${y}" width="${cardWidth}" height="154" rx="14" fill="${palette.panel}" stroke="${palette.line}"/>
      <clipPath id="cover-${index}"><rect x="${coverX}" y="${coverY}" width="${coverW}" height="${coverH}" rx="10"/></clipPath>
      ${cover}
      <text x="${x + 112}" y="${y + 44}" font-size="19" font-weight="700" fill="${palette.text}">${titleSvg}</text>
      <text x="${x + 112}" y="${y + 93}" font-size="12" fill="${palette.muted}">${xml(meta)}</text>
      <text x="${x + 112}" y="${y + 118}" font-size="12" fill="${palette.green}">${xml(genres)}</text>
    </a>
  `;
}

function renderAnimeSvg(anime) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="860" height="270" role="img" aria-label="Favorite anime">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    a { cursor: pointer; }
  </style>
  <rect width="860" height="270" rx="18" fill="${palette.bg}"/>
  <text x="34" y="42" font-size="26" font-weight="800" fill="${palette.text}">Favorite anime</text>
  <text x="34" y="64" font-size="13" fill="${palette.muted}">Manual picks, rendered with AniList metadata</text>
  ${anime.map(animeCard).join("\n")}
</svg>
`;
}

function git(args, fallback = "") {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

function trackedTextFiles() {
  const allowed = new Set([".md", ".yml", ".yaml", ".js", ".mjs", ".json", ".txt", ".css", ".html"]);
  return git(["ls-files"]).split("\n").filter((file) => allowed.has(extname(file)));
}

function analyzeText() {
  let spaces = 0;
  let tabs = 0;
  let chars = 0;
  let lines = 0;
  for (const file of trackedTextFiles()) {
    let content = "";
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      if (line.length) {
        chars += line.length;
        lines++;
      }
      if (/^ +\S/.test(line)) spaces++;
      if (/^\t+\S/.test(line)) tabs++;
    }
  }
  return {
    indentation: spaces >= tabs ? "spaces" : "tabs",
    averageChars: lines ? (chars / lines).toFixed(1) : "0.0",
  };
}

function localDatePart(date, options) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Tirane", ...options }).format(date);
}

function mostCommon(values, fallback) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? fallback;
}

function analyzeCommits() {
  const dates = git(["log", "--max-count=25", "--pretty=format:%aI"])
    .split("\n")
    .filter(Boolean)
    .map((value) => new Date(value));
  const hours = dates.map((date) => localDatePart(date, { hour: "2-digit", hour12: false })).map((hour) => `${hour}:00`);
  const days = dates.map((date) => localDatePart(date, { weekday: "long" }));
  return {
    count: dates.length,
    hour: mostCommon(hours, "00:00"),
    day: mostCommon(days, "Wednesday"),
  };
}

function renderFactsSvg() {
  const text = analyzeText();
  const commits = analyzeCommits();
  const facts = [
    `Uses ${text.indentation} for indentation`,
    `Has approximately ${text.averageChars} characters per line in tracked files`,
    `Mostly pushes code around ${commits.hour}`,
    `Mostly active on ${commits.day}`,
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="860" height="190" role="img" aria-label="Mildly interesting coding facts">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  </style>
  <rect width="860" height="190" rx="18" fill="#ffffff"/>
  <text x="34" y="43" font-size="27" font-weight="800" fill="#24292f">Mildly interesting facts</text>
  <text x="34" y="84" font-size="20" font-weight="700" fill="#0969da">Recent coding habits</text>
  <text x="265" y="84" font-size="14" fill="#0969da">(computed from latest ${commits.count} commits)</text>
  ${facts.map((fact, index) => `<text x="34" y="${112 + index * 22}" font-size="18" fill="#6e7781">${xml(fact)}</text>`).join("\n  ")}
</svg>
`;
}

const anime = await loadAnime();
writeFileSync(`${outDir}/profile-anime.svg`, renderAnimeSvg(anime));
writeFileSync(`${outDir}/profile-facts.svg`, renderFactsSvg());
console.log("Generated profile-anime.svg and profile-facts.svg");
