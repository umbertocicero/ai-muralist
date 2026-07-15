// Proof of the conditioned-prompt chain (js/mural-prompt.js) — no network.
//   · First mural → generic open prompt: no preset style list, KAI invents.
//   · Later murals → conditioned by the PREVIOUS piece: its style, thought and
//     SVG source are embedded, and the response format asks for a self-named
//     STYLE line. The prompt stays under the 12 KB the murals table stores.
// Run:  node tests/prompt.test.mjs

import assert from 'node:assert';
import { buildMuralPrompt, parseStyle } from '../js/mural-prompt.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`FAIL  ${name}\n      ${e.message}`); }
};

const wall = { wallW: 4.2, wallH: 2.7 };

// ── 1: first mural — generic, no presets ────────────────────────────────────
{
  const { PW, PH, text } = buildMuralPrompt(wall, 0, null);
  check('1. first prompt is generic (no fixed style list)', () => {
    assert(!/STYLE \d - /.test(text), 'still contains the old "STYLE n -" preset blocks');
    assert(!/UKIYO-E|SUMI-E|WOODBLOCK|KIRIE|WABI-SABI/i.test(text), 'still names the old preset styles');
    assert(/INVENT/i.test(text), 'does not ask KAI to invent his own language');
    assert(text.includes('STYLE: <'), 'response format missing the self-named STYLE line');
    assert(text.includes(`viewBox="0 0 ${PW} ${PH}"`), 'viewBox not derived from the wall');
  });
}

// ── 2: later murals — conditioned by the previous piece ─────────────────────
{
  const prev = { style: 'Ember Drift', thought: 'sparks learn the shape of wind', svg: '<svg xmlns="x"><path d="M0 0C1 1 2 2 3 3"/></svg>' };
  const { text } = buildMuralPrompt(wall, 7, prev);
  check('2. conditioned prompt embeds the previous mural', () => {
    assert(text.includes('CONDITIONED'), 'does not state the conditioning');
    assert(text.includes(prev.svg), 'previous SVG source not embedded');
    assert(text.includes(prev.thought), 'previous thought not embedded');
    assert(text.includes('Ember Drift'), 'previous style name not embedded');
    assert(!/STYLE \d - /.test(text), 'preset blocks leaked into the conditioned prompt');
  });
}

// ── 3: a huge previous SVG is truncated; the prompt stays storable ──────────
{
  const prev = { style: 'X', thought: 't', svg: '<svg' + 'a'.repeat(59_000) + '</svg>' };
  const { text } = buildMuralPrompt(wall, 3, prev);
  check('3. oversized previous SVG truncated, prompt under the 12 KB store cap', () => {
    assert(text.includes('(truncated)'), 'no truncation marker');
    assert(text.length < 12_000, `prompt is ${text.length} chars — would fail the POST /murals validation`);
  });
}

// ── 4: parseStyle — self-named style extraction ──────────────────────────────
{
  check('4. parseStyle extracts, bounds and falls back', () => {
    assert.equal(parseStyle('STYLE: Neon Kintsugi\nTHOUGHT: x\n<svg/>'), 'Neon Kintsugi');
    assert.equal(parseStyle('style:  "Rust Bloom" \nrest'), 'Rust Bloom');
    assert.equal(parseStyle('THOUGHT: no style line\n<svg/>'), 'Freestyle');
    assert.equal(parseStyle(null), 'Freestyle');
    assert(parseStyle('STYLE: ' + 'x'.repeat(120)).length <= 40, 'style not clamped to the 40-char column');
  });
}

// ── 5: prev without svg (or empty) behaves like a first mural ────────────────
{
  const { text } = buildMuralPrompt(wall, 2, { style: 'X', thought: 't', svg: '' });
  check('5. prev without usable SVG falls back to the generic prompt', () => {
    assert(/INVENT/i.test(text));
    assert(!text.includes('CONDITIONED'));
  });
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll prompt checks passed');
process.exit(failures ? 1 : 0);
