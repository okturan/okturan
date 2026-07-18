#!/usr/bin/env node
// Lane Defense — a tower-defense battle fought over the contribution graph,
// simulated up front and baked into CSS keyframes so it animates inside a
// README <img>. Writes dist/lane-defense.svg (dark) + dist/lane-defense-light.svg.
//
// A committed SVG can't randomize per page load (GitHub's camo proxy serves
// cached bytes; scripts don't run in <img>), so the daily cron rotates the
// battle instead: level and seed derive from the day number, and the same
// (grid, level, seed) always bakes the identical battle in both themes.
//
// Vendored from github-blocks (blocks/lane-defense.mjs + lib/contrib.mjs);
// that repo is the canonical source — fix bugs there first, then re-vendor.

import { mkdirSync, writeFileSync } from "node:fs";

const profileUser = process.env.PROFILE_USER || "okturan";

// ---------------------------------------------------------------- contrib grid

function parseContributionGrid(html) {
  const weeks = [];
  for (const tag of html.matchAll(/<td\b[^>]*\bdata-date="[^"]*"[^>]*>/g)) {
    const td = tag[0];
    const id = td.match(/id="contribution-day-component-(\d+)-(\d+)"/);
    const level = td.match(/data-level="(\d)"/);
    if (!id || !level) continue;
    const day = +id[1], week = +id[2];
    (weeks[week] ??= Array(7).fill(0))[day] = +level[1];
  }
  if (!weeks.length) throw new Error("no contribution cells found — GitHub markup may have changed");
  return weeks.map((w) => w ?? Array(7).fill(0));
}

async function fetchContributionGrid(user) {
  const res = await fetch(`https://github.com/users/${encodeURIComponent(user)}/contributions`);
  if (!res.ok) throw new Error(`GET contributions for ${user}: HTTP ${res.status}`);
  return parseContributionGrid(await res.text());
}

// ---------------------------------------------------------------- lane defense

const LEVELS = [
  { name: "PATROL", waves: 3, perWave: 5, waveGap: 7, hp: [2, 3, 5], speed: [42, 60], cooldown: 1.55, mix: [0.55, 0.85] },
  { name: "SIEGE", waves: 4, perWave: 6, waveGap: 7.5, hp: [4, 6, 10], speed: [45, 63], cooldown: 1.8, mix: [0.45, 0.75] },
  { name: "OVERRUN", waves: 5, perWave: 7, waveGap: 8, hp: [5, 8, 13], speed: [48, 68], cooldown: 1.9, mix: [0.35, 0.65] },
];

const THEMES = {
  light: {
    bg: "#ffffff", fg: "#24292f", dim: "#8b949e",
    pal: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    turret: "#0a3069", ring: "#ffffff", laser: "#1a7f37", muzzle: "#dafbe1",
    bugs: ["#fa4549", "#e16f24", "#8250df"],
  },
  dark: {
    bg: "#0d1117", fg: "#e6edf3", dim: "#7d8590",
    pal: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    turret: "#f0883e", ring: "#0d1117", laser: "#39d353", muzzle: "#2ea04366",
    bugs: ["#f85149", "#d29922", "#a371f7"],
  },
};

const PITCH = 15, CELL = 12, RX = 2.5, ROWS = 7, RANGE = 50, DT = 0.05;
const f = (n) => +n.toFixed(2);

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function laneDefense(grid, {
  level = 2,
  seed = 1337,
  theme = "dark",
  title = "COMMIT DEFENSE",
  width = 896,
  onStats,
} = {}) {
  if (!Array.isArray(grid) || !grid.length || grid[0].length !== ROWS) {
    throw new Error("grid must be weeks × 7 array of levels 0–4");
  }
  const cfg = LEVELS[Math.min(Math.max(level, 1), LEVELS.length) - 1];
  const th = THEMES[theme] ?? THEMES.dark;
  const rnd = mulberry32(seed);

  const COLS = grid.length;
  const GW = COLS * PITCH - (PITCH - CELL);
  const cx = (c) => c * PITCH + CELL / 2;
  const cy = (r) => r * PITCH + CELL / 2;

  // Towers: level-3+ days; sparse graphs promote level-2 days so every grid
  // gets a garrison, dense ones are thinned so the waves stand a chance.
  const sites = [];
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
    if (grid[c][r] >= 2) sites.push({ c, r, lvl: grid[c][r] });
  }
  let towers = sites.filter((s) => s.lvl >= 3);
  if (towers.length < 8) towers = towers.concat(sites.filter((s) => s.lvl === 2)).slice(0, 8);
  if (towers.length > 30) towers = towers.filter((_, i) => i % Math.ceil(towers.length / 30) === 0);
  towers = towers.map((s) => ({ ...s, x: cx(s.c), y: cy(s.r), cd: 0, fires: [] }));

  // Enemy HP scales with garrison strength so any profile balances.
  const hpScale = Math.min(Math.max(towers.length / 14, 0.75), 2.2);
  const scaledHp = (base) => Math.max(1, Math.round(base * hpScale));

  const enemies = [];
  for (let w = 0; w < cfg.waves; w++) for (let i = 0; i < cfg.perWave; i++) {
    const roll = rnd();
    const tier = roll < cfg.mix[0] ? 0 : roll < cfg.mix[1] ? 1 : 2;
    enemies.push({
      t0: 1 + w * cfg.waveGap + i * 0.55 + rnd() * 0.35,
      row: Math.floor(rnd() * ROWS),
      v: cfg.speed[0] + rnd() * (cfg.speed[1] - cfg.speed[0]),
      hp: scaledHp(cfg.hp[tier]),
      tier, hits: [], death: null, exitT: null, alive: true,
    });
  }
  const lastT0 = Math.max(...enemies.map((e) => e.t0));
  const D = Math.ceil(lastT0 + (GW + 46) / cfg.speed[0] + 1.3);

  let animId = 0;
  const css = [], els = [];
  const pct = (t) => Math.min(99.99, Math.max(0, (t / D) * 100));
  const anim = (frames, base) => {
    const name = "a" + (animId++).toString(36);
    const parts = frames
      .map(([t, p]) => [t === "0" ? 0 : t === "100" ? 100 : pct(t), p])
      .sort((a, b) => a[0] - b[0])
      .map(([p, s]) => `${p.toFixed(3)}%{${s}}`).join("");
    css.push(`@keyframes ${name}{${parts}}`);
    return `animation:${name} ${D}s linear infinite;${base || ""}`;
  };
  const el = (tag, attrs, style) => {
    const a = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ");
    els.push(`<${tag} ${a}${style ? ` style="${style}"` : ""}/>`);
  };

  const beam = (x1, y1, x2, y2, t) => {
    const frames = [["0", "opacity:0"], [t - 0.01, "opacity:0"], [t, "opacity:1"], [t + 0.13, "opacity:0"], ["100", "opacity:0"]];
    el("line", { x1: f(x1), y1: f(y1), x2: f(x2), y2: f(y2), stroke: th.laser, "stroke-width": 5, "stroke-opacity": 0.25, "stroke-linecap": "round" }, anim(frames, "opacity:0"));
    el("line", { x1: f(x1), y1: f(y1), x2: f(x2), y2: f(y2), stroke: th.laser, "stroke-width": 2, "stroke-linecap": "round" }, anim(frames, "opacity:0"));
  };
  const burst = (x, y, t, color) => {
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + rnd() * 0.8;
      const d = 14 * (0.7 + rnd() * 0.6);
      el("circle", { cx: 0, cy: 0, r: f(2 + rnd() * 1.2), fill: color }, anim([
        ["0", "opacity:0"],
        [t - 0.01, `opacity:0;transform:translate(${f(x)}px,${f(y)}px) scale(1)`],
        [t, "opacity:1"],
        [t + 0.45, `opacity:0;transform:translate(${f(x + Math.cos(ang) * d)}px,${f(y + Math.sin(ang) * d)}px) scale(0.3)`],
        ["100", "opacity:0"],
      ], "opacity:0"));
    }
  };

  for (let t = 0; t < D - 1; t += DT) {
    for (const e of enemies) {
      if (!e.alive || t < e.t0) continue;
      e.x = -16 + (t - e.t0) * e.v;
      e.y = cy(e.row);
      if (e.x > GW + 14 && !e.exitT) { e.exitT = t; e.alive = false; }
    }
    for (const tw of towers) {
      tw.cd -= DT;
      if (tw.cd > 0) continue;
      let best = null;
      for (const e of enemies) {
        if (!e.alive || t < e.t0 || e.x === undefined) continue;
        if (Math.hypot(e.x - tw.x, e.y - tw.y) > RANGE) continue;
        if (!best || e.x > best.x) best = e;
      }
      if (best) {
        tw.cd = cfg.cooldown;
        tw.fires.push(t);
        beam(tw.x, tw.y, best.x, best.y, t);
        best.hits.push(t);
        if (--best.hp <= 0) { best.alive = false; best.death = { t, x: best.x, y: best.y }; }
      }
    }
  }
  const kills = enemies.filter((e) => e.death).length;

  // Beams were emitted during the sim; lift them above the grid cells.
  const beamEls = els.splice(0);
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
    el("rect", { x: c * PITCH, y: r * PITCH, width: CELL, height: CELL, rx: RX, fill: th.pal[grid[c][r]] });
  }
  for (const tw of towers) {
    el("circle", { cx: tw.x, cy: tw.y, r: 3.2, fill: "none", stroke: th.ring, "stroke-width": 1.2 });
    el("circle", { cx: tw.x, cy: tw.y, r: 1.5, fill: th.turret });
    if (tw.fires.length) {
      const frames = [["0", "opacity:0"]];
      for (const t of tw.fires) frames.push([t - 0.01, "opacity:0"], [t, "opacity:0.9"], [t + 0.16, "opacity:0"]);
      frames.push(["100", "opacity:0"]);
      el("rect", { x: tw.c * PITCH - 1, y: tw.r * PITCH - 1, width: CELL + 2, height: CELL + 2, rx: RX + 1, fill: th.muzzle }, anim(frames, "opacity:0"));
    }
  }
  els.push(...beamEls);

  for (const e of enemies) {
    const tEnd = e.death ? e.death.t : Math.min(e.exitT ?? (e.t0 + (GW + 30) / e.v), D - 0.3);
    const xEnd = e.death ? e.death.x : -16 + (tEnd - e.t0) * e.v;
    const y = cy(e.row), color = th.bugs[e.tier], r = [4, 4.6, 5.4][e.tier];
    const move = anim([
      ["0", `opacity:0;transform:translate(-16px,${f(y)}px)`],
      [e.t0, `opacity:0;transform:translate(-16px,${f(y)}px)`],
      [e.t0 + 0.05, "opacity:1"],
      [tEnd, `opacity:1;transform:translate(${f(xEnd)}px,${f(y)}px)`],
      [tEnd + 0.01, "opacity:0"],
      ["100", "opacity:0"],
    ], "opacity:0");
    let flash = "";
    if (e.hits.length) {
      const frames = [["0", "opacity:0"]];
      for (const t of e.hits) frames.push([t - 0.01, "opacity:0"], [t, "opacity:0.9"], [t + 0.09, "opacity:0"]);
      frames.push(["100", "opacity:0"]);
      flash = `<circle r="${f(r + 1.5)}" fill="#ffffff" style="${anim(frames, "opacity:0")}"/>`;
    }
    els.push(`<g style="${move}">` +
      `<ellipse rx="${r}" ry="${f(r * 0.78)}" fill="${color}"/>` +
      `<circle cx="${f(r * 0.85)}" cy="0" r="${f(r * 0.55)}" fill="${color}"/>` +
      `<circle cx="${f(r * 0.95)}" cy="-1" r="0.9" fill="#ffffff"/>` + flash + `</g>`);
    if (e.death) burst(e.death.x, e.death.y, e.death.t, color);
  }

  const stats = { towers: towers.length, enemies: enemies.length, kills, leaked: enemies.length - kills, duration: D };
  onStats?.(stats);

  const subtitle = `LVL ${level} ${cfg.name} · ${towers.length} TOWERS · ${kills}/${enemies.length} DOWN`;
  const vbW = GW + 20, vbH = ROWS * PITCH + 48;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round(width * (vbH / vbW))}" viewBox="-10 -36 ${vbW} ${vbH}" role="img" aria-label="${xml(`Tower defense over a GitHub contribution graph: towers on big commit days shoot lasers at ${enemies.length} bug creeps marching along the weekday rows; ${kills} destroyed, ${enemies.length - kills} slip through`)}">
  <style>*{transform-box:fill-box}.td-t{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700}@media (prefers-reduced-motion:reduce){*{animation-play-state:paused!important}}${css.join("")}</style>
  <rect x="-10" y="-36" width="${vbW}" height="${vbH}" rx="6" fill="${th.bg}"/>
  <text class="td-t" x="0" y="-16" font-size="11" fill="${th.fg}" letter-spacing="2">${xml(title)}</text>
  <text class="td-t" x="${GW}" y="-16" font-size="8" fill="${th.dim}" text-anchor="end" letter-spacing="1">${xml(subtitle)}</text>
  ${els.join("\n")}
</svg>
`;
}

// ------------------------------------------------------------------------ main

const grid = await fetchContributionGrid(profileUser);
const day = Math.floor(Date.now() / 86_400_000);
const level = 1 + (day % 3);
const seed = day;

mkdirSync("dist", { recursive: true });
for (const [file, theme] of [["lane-defense.svg", "dark"], ["lane-defense-light.svg", "light"]]) {
  const svg = laneDefense(grid, {
    level, seed, theme,
    onStats: (s) => console.log(`${file}: lvl ${level} ${LEVELS[level - 1].name}, seed ${seed} —`, JSON.stringify(s)),
  });
  writeFileSync(`dist/${file}`, svg);
}
