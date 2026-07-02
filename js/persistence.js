import { CONFIG } from './config.js';

// ===========================================================================
//  Mural persistence — the world survives a refresh.
//
//  The town is generated from a fixed seed (CONFIG.worldSeed), so every wall
//  slot sits at the same flat-world coordinates in every session. Each painted
//  mural is POSTed to the Worker (D1 behind <workerUrl>/murals) keyed by those
//  coordinates; on boot we fetch them back and re-apply each one to the slot
//  found at its anchor. KAI then keeps painting the REMAINING walls — the same
//  world, continued, by whoever visits it.
//
//  Only active when CONFIG.workerUrl is set (like generation itself); in the
//  offline demo, or if the Worker has no D1 binding, everything degrades to
//  the old non-persistent behaviour with a single console note.
// ===========================================================================

// Anonymous painter id, one per browser, kept in localStorage.
export function getUserId() {
  try {
    let id = localStorage.getItem('muralist_uid');
    if (!id) {
      id = crypto.randomUUID?.() ?? `u-${Date.now()}-${(Math.random() * 1e9 | 0)}`;
      localStorage.setItem('muralist_uid', id);
    }
    return id;
  } catch {
    return 'anonymous';   // storage blocked (private mode) → still paints, unattributed
  }
}

// Coordinates are rounded to 3 decimals before sending so the server's unique
// (world, px, py, pz) index sees identical values across sessions.
const r3 = v => Math.round(v * 1000) / 1000;

export class Persistence {
  constructor(workerUrl, world) {
    this.url   = workerUrl.replace(/\/$/, '') + '/murals';
    this.world = world;
    this.uid   = getUserId();
  }

  // Fire-and-forget save of a freshly painted mural. A failure never disturbs
  // the game — the piece simply won't survive the next refresh.
  save(slot, result, styleName) {
    fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        world: this.world,
        px: r3(slot.px), py: r3(slot.py), pz: r3(slot.pz),
        nx: r3(slot.nx), nz: r3(slot.nz),
        wallW: r3(slot.wallW), wallH: r3(slot.wallH),
        style: styleName,
        thought: result.thought ?? null,
        svg: result.svg,
        userId: this.uid,
      }),
    }).catch(e => console.warn('[persist] save failed:', e.message));
  }

  // Fetch every mural of this world and re-attach each to the wall slot at its
  // anchor. Restored walls are marked used, so KAI moves on to blank ones; the
  // agent's mural count advances too, keeping the 8-style rotation going.
  async restore(city, factory, agent, ui) {
    let rows;
    try {
      const res = await fetch(`${this.url}?world=${this.world}`);
      if (!res.ok) {
        if (res.status === 501) { console.info('[persist] worker has no D1 binding — running non-persistent'); return 0; }
        throw new Error(`HTTP ${res.status}`);
      }
      rows = (await res.json()).murals ?? [];
    } catch (e) {
      console.warn('[persist] restore failed:', e.message);
      return 0;
    }

    let restored = 0;
    for (const m of rows) {
      // the slot at this anchor (10 cm tolerance absorbs the 3-decimal rounding)
      const slot = city.wallSlots.find(s =>
        !s.used &&
        (s.px - m.px) ** 2 + (s.py - m.py) ** 2 + (s.pz - m.pz) ** 2 < 0.01);
      if (!slot) continue;               // world changed, or painted live this session
      slot.used = true;                  // reserve before the async apply
      const PW = 512, PH = Math.round(512 * (slot.wallH / slot.wallW));
      try {
        await factory.apply(slot, { svg: m.svg, PW, PH });
      } catch (e) {
        slot.used = false;
        console.warn('[persist] re-apply failed:', e.message);
        continue;
      }
      restored++;
      agent.muralCount++;
      ui.muralCount = agent.muralCount;
      ui.gallery.unshift({
        id: m.id, styleName: m.style, wallW: slot.wallW, wallH: slot.wallH,
        buildingIdx: slot.buildingIdx, by: m.user_id,
        target: { px: slot.px, py: slot.py, pz: slot.pz, nx: slot.nx, nz: slot.nz },
        thumb: 'data:image/svg+xml;utf8,' + encodeURIComponent(m.svg),
      });
    }
    if (restored) console.info(`[persist] restored ${restored} mural(s)`);
    return restored;
  }
}
