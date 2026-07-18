#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "../..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const generator = readFileSync(join(scriptDirectory, "generate-profile-cards.mjs"), "utf8");
const workflowDirectory = join(root, ".github/workflows");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function section(name, nextName) {
  const start = readme.indexOf(`## ${name}`);
  const end = readme.indexOf(`## ${nextName}`, start + 1);
  assert(start >= 0, `Missing ${name} section`);
  assert(end > start, `${name} must appear before ${nextName}`);
  return readme.slice(start, end);
}

const featured = section("Featured Work", "More projects I like");
const featuredProjects = [...featured.matchAll(/^### \[([^\]]+)\]\(https:\/\/github\.com\/okturan\/([^)]+)\)$/gm)];
assert(featuredProjects.length === 6, `Expected 6 featured projects, found ${featuredProjects.length}`);
assert(new Set(featuredProjects.map((match) => match[2].toLowerCase())).size === 6, "Featured projects must be unique");
const expectedFeatured = ["claude-statusblocks", "dirwiz", "gcp-audit-dashboard", "tinyvoice", "foljapp", "darkex-404-lab"];
assert(JSON.stringify(featuredProjects.map((match) => match[2].toLowerCase())) === JSON.stringify(expectedFeatured), "Featured Work must match the approved six-project order");

for (let index = 0; index < featuredProjects.length; index += 1) {
  const start = featuredProjects[index].index;
  const end = featuredProjects[index + 1]?.index ?? featured.length;
  const entry = featured.slice(start, end);
  const links = [...entry.matchAll(/\[[^\]]+\]\(https:\/\/[^)]+\)/g)];
  assert(links.length >= 3, `${featuredProjects[index][1]} needs its repository link and at least two direct proof links`);
}

const more = section("More projects I like", "Focus");
const moreProjects = [...more.matchAll(/^- \*\*\[([^\]]+)\]\(https:\/\/github\.com\/okturan\/([^)]+)\)\*\*[^\n]*$/gm)];
const expectedMore = ["github-blocks", "epoch-td", "quarterlink", "reactive-particle-demo"];
assert(JSON.stringify(moreProjects.map((match) => match[2].toLowerCase())) === JSON.stringify(expectedMore), "More-projects section must retain the curated discovery order");
const allProjectSlugs = [...featuredProjects, ...moreProjects].map((match) => match[2].toLowerCase());
assert(new Set(allProjectSlugs).size === allProjectSlugs.length, "Featured and discovery projects must be unique");
for (const project of moreProjects) {
  const links = [...project[0].matchAll(/\[[^\]]+\]\(https:\/\/[^)]+\)/g)];
  assert(links.length >= 3, `${project[1]} needs its repository link and at least two direct proof links`);
}

const anime = section("Favorite Anime", "GitHub Snapshot");
const animeLinks = [...anime.matchAll(/<a href="(https:\/\/myanimelist\.net\/anime\/[^\"]+)">/g)];
const animeImages = [...anime.matchAll(/<img\b[^>]*alt="[^"]+"[^>]*src="https:\/\/raw\.githubusercontent\.com\/okturan\/okturan\/output\/profile-anime-[^"]+\.svg"[^>]*>/g)];
assert(animeLinks.length === 3, `Expected 3 MyAnimeList destinations, found ${animeLinks.length}`);
assert(animeImages.length === 3, `Expected 3 accessible generated anime cards, found ${animeImages.length}`);

const images = [...readme.matchAll(/<img\b([^>]*)>/g)];
assert(images.length > 0, "Profile README must contain evidence images");
for (const image of images) {
  assert(/\balt="[^"]+"/.test(image[1]), `Image is missing useful alt text: <img${image[1]}>`);
}

assert(!/\b\d[\d,]*\s+(?:unit\s+)?tests?\b/i.test(readme), "Profile copy must describe verification quality instead of advertising a raw test count");

const generatedCards = new Set(
  [...readme.matchAll(/raw\.githubusercontent\.com\/okturan\/okturan\/output\/(profile-[^"')]+\.svg)/g)]
    .map((match) => match[1]),
);
for (const card of generatedCards) {
  const animeId = card.match(/^profile-anime-(\d+)\.svg$/)?.[1];
  const generated = animeId
    ? generator.includes(`{ id: ${animeId},`) && generator.includes("profile-anime-${favorite.id}.svg")
    : generator.includes(card);
  assert(generated, `README references ${card}, but the generator does not write it`);
}

for (const filename of readdirSync(workflowDirectory).filter((name) => /\.ya?ml$/.test(name))) {
  const workflow = readFileSync(join(workflowDirectory, filename), "utf8");
  for (const match of workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)) {
    const reference = match[1];
    assert(/@[a-f0-9]{40}$/i.test(reference), `${filename} action is not pinned to a full commit SHA: ${reference}`);
  }
}

console.log(`Profile validation passed: ${featuredProjects.length} featured projects, ${moreProjects.length} discovery projects, ${animeLinks.length} anime links, ${images.length} accessible images, ${generatedCards.size} generated card references`);
