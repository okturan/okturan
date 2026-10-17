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

// Products: a table of four shipped products, each with a live site link.
const products = section("Products", "More work");
const productRows = [...products.matchAll(/^\| \*\*\[([^\]]+)\]\((https:\/\/[^)]+)\)\*\* \|/gm)];
assert(productRows.length === 4, `Expected 4 product rows, found ${productRows.length}`);
assert(JSON.stringify(productRows.map((row) => row[1])) === JSON.stringify(["DirWiz", "Krahaso", "FightBench", "CropSize"]), "Products must keep the approved order");

// More work: one grouped line per kind, every link a repository of this account, no repository twice.
const more = section("More work", "Activity");
const groupLines = [...more.matchAll(/^\* \S+ ([a-z ]+): (.+)$/gm)];
assert(groupLines.length === 7, `Expected 7 grouped lines, found ${groupLines.length}`);
const moreSlugs = [...more.matchAll(/\]\(https:\/\/github\.com\/okanerturan\/([^)\s]+)\)/g)].map((match) => match[1].toLowerCase());
assert(moreSlugs.length >= 20, `Expected at least 20 grouped repositories, found ${moreSlugs.length}`);
assert(new Set(moreSlugs).size === moreSlugs.length, "A repository appears in two groups");
assert(!/okturan/i.test(readme), "README still links the old okturan username");

const anime = section("Favorite Anime", "GitHub Snapshot");
const animeLinks = [...anime.matchAll(/<a href="(https:\/\/myanimelist\.net\/anime\/[^\"]+)">/g)];
const animeImages = [...anime.matchAll(/<img\b[^>]*alt="[^"]+"[^>]*src="https:\/\/raw\.githubusercontent\.com\/okanerturan\/okanerturan\/output\/profile-anime-[^"]+\.svg"[^>]*>/g)];
assert(animeLinks.length === 3, `Expected 3 MyAnimeList destinations, found ${animeLinks.length}`);
assert(animeImages.length === 3, `Expected 3 accessible generated anime cards, found ${animeImages.length}`);

const laneDefenseLink = "https://okanerturan.github.io/github-blocks/";
assert(readme.includes(`<a href="${laneDefenseLink}">`), "Lane Defense visual must link to the GitHub Blocks configurator");
assert(readme.includes("https://raw.githubusercontent.com/okanerturan/okanerturan/output/lane-defense.svg"), "Missing dark Lane Defense output");
assert(readme.includes("https://raw.githubusercontent.com/okanerturan/okanerturan/output/lane-defense-light.svg"), "Missing light Lane Defense output");
assert(!readme.includes("github-contribution-grid-snake"), "Profile README should not reference the retired contribution snake");
assert(!readme.includes("streak-stats.demolab.com"), "Profile README should not depend on the failure-prone external streak card");
assert(readme.includes("https://raw.githubusercontent.com/okanerturan/okanerturan/output/profile-facts.svg"), "Missing dark coding-habits output");
assert(readme.includes("https://raw.githubusercontent.com/okanerturan/okanerturan/output/profile-facts-light.svg"), "Missing light coding-habits output");
assert(generator.includes("process.env.HABITS_LIMIT"), "Coding-habits sample size must be configurable");
assert(generator.includes("process.env.HABITS_TIMEZONE"), "Coding-habits time zone must be configurable");
assert(generator.includes("process.env.HABITS_WINDOW"), "Coding-habits time window must be configurable");

const images = [...readme.matchAll(/<img\b([^>]*)>/g)];
assert(images.length > 0, "Profile README must contain evidence images");
for (const image of images) {
  assert(/\balt="[^"]+"/.test(image[1]), `Image is missing useful alt text: <img${image[1]}>`);
}

assert(!/\b\d[\d,]*\s+(?:unit\s+)?tests?\b/i.test(readme), "Profile copy must describe verification quality instead of advertising a raw test count");

assert(readme.includes("desk: Claude Code"), "README must keep the desk line");
assert(!readme.includes("OpenHands"), "README must not mention OpenHands");

const generatedCards = new Set(
  [...readme.matchAll(/raw\.githubusercontent\.com\/okanerturan\/okanerturan\/output\/(profile-[^"')]+\.svg)/g)]
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

console.log(`Profile validation passed: ${productRows.length} products, ${moreSlugs.length} grouped repositories, ${animeLinks.length} anime links, ${images.length} accessible images, ${generatedCards.size} generated card references`);
