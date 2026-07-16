// Regression proof of the build-6 heartbeat fixes (worker.js KayDO) — the
// "Kay frozen until redeploy" bug. No miniflare, no network: KayDO runs against
// a fake DO state/storage.
//
//   A.  alarm() whose tick THROWS must swallow the error and reschedule itself
//       (the runtime's own retry leaves getAlarm() non-null, which _ensureAlarm
//       can never fix — so a single bad tick used to kill the heartbeat forever).
//   A2. a crash with zero sockets must NOT re-arm (frozen world stays free).
//   B.  fetch() (a browser connecting) must FORCE-set the alarm even when one is
//       already pending, replacing a wedged alarm with a near-term tick.
//   B2. (regression) the old connect path (_ensureAlarm) provably could not.
//
// Run:  node tests/kaydo-alarm.test.mjs

import assert from 'node:assert';

// Workers globals the connect path touches, absent in Node:
class FakeWS { sent = []; send(s) { this.sent.push(s); } }
globalThis.WebSocketPair = class { constructor() { this[0] = new FakeWS(); this[1] = new FakeWS(); } };
// Node's undici Response rejects status 101 — stub the tiny surface KayDO uses.
globalThis.Response = class { constructor(body, init = {}) { this.body = body; this.status = init.status; this.webSocket = init.webSocket; } };

const { KayDO } = await import('../worker.js');

function makeState({ pendingAlarm = null, sockets = [new FakeWS()] } = {}) {
  const store = new Map();
  let alarm = pendingAlarm;
  const calls = { setAlarm: [] };
  return {
    calls,
    getWebSockets: () => sockets,
    acceptWebSocket: () => {},
    waitUntil: () => {},
    storage: {
      get: async (k) => store.get(k),
      put: async (k, v) => store.set(k, v),
      delete: async (k) => store.delete(k),
      getAlarm: async () => alarm,
      setAlarm: async (t) => { alarm = t; calls.setAlarm.push(t); },
    },
  };
}

// ── A) throwing tick: heartbeat survives ────────────────────────────────────
{
  const state = makeState();
  const dob = new KayDO(state, {});
  dob._loaded = true;                       // skip storage hydration
  dob.sim = { advance() { throw new Error('boom — simulated tick crash'); },
              state: 'SEEKING', snapshot: () => ({}), serialize: () => ({}) };
  await dob.alarm();                        // must NOT throw
  assert.equal(state.calls.setAlarm.length, 1, 'crashed tick must reschedule the alarm');
  assert.ok(state.calls.setAlarm[0] > Date.now(), 'rescheduled in the future');
  console.log('  ok  A. a throwing tick is swallowed and the heartbeat reschedules itself');
}

// ── A2) throwing tick with 0 sockets: no pointless re-arm ───────────────────
{
  const state = makeState({ sockets: [] });
  const dob = new KayDO(state, {});
  dob._loaded = true;
  // The 0-socket path only serializes the sim — crash there.
  dob.sim = { serialize() { throw new Error('boom'); } };
  await dob.alarm();
  assert.equal(state.calls.setAlarm.length, 0, 'no viewers → stay frozen even after a crash');
  console.log('  ok  A2. crash with nobody watching does not re-arm (billing stays zero)');
}

// ── C) zombie sockets: open but silent → the world freezes ──────────────────
// iOS kills connections WITHOUT a close frame; the socket list stays non-empty
// while nobody is really there. With no client message for > STALE_VIEWER_MS
// the tick must freeze exactly like the 0-socket case (no reschedule).
{
  const state = makeState();                 // one (zombie) socket
  const dob = new KayDO(state, {});
  dob._loaded = true;
  dob._lastHeard = Date.now() - 120_000;     // silent for 2 minutes
  let advanced = 0;
  dob.sim = { advance() { advanced++; return null; }, state: 'SEEKING',
              snapshot: () => ({}), serialize: () => ({}), currentRoute: () => null };
  await dob.alarm();
  assert.equal(state.calls.setAlarm.length, 0, 'stale viewers must not keep the heartbeat alive');
  assert.equal(advanced, 0, 'the sim must not advance for zombie sockets');
  console.log('  ok  C. silent zombie sockets freeze the world (no phantom walking)');
}

// ── C2) a ping revives a stale-frozen world ─────────────────────────────────
{
  const state = makeState();                 // frozen: no alarm pending
  const dob = new KayDO(state, {});
  dob._loaded = true;
  dob._lastHeard = Date.now() - 120_000;
  await dob.webSocketMessage(state.getWebSockets()[0], '{"type":"ping"}');
  assert.ok(Date.now() - dob._lastHeard < 1000, 'ping must freshen the liveness clock');
  assert.equal(state.calls.setAlarm.length, 1, 'ping must re-arm the frozen heartbeat');
  console.log('  ok  C2. a client ping freshens liveness and re-arms the heartbeat');
}

// ── B) connect force-replaces a wedged/pending alarm ────────────────────────
{
  const wedged = Date.now() + 999_999;      // stuck far out / in runtime retry
  const state = makeState({ pendingAlarm: wedged });
  const dob = new KayDO(state, {});
  dob._loaded = true;
  const req = { headers: { get: (h) => (h === 'Upgrade' ? 'websocket' : null) },
                url: 'http://x/live?world=123' };
  const res = await dob.fetch(req);
  assert.equal(res.status, 101);
  assert.equal(state.calls.setAlarm.length, 1, 'connect must call setAlarm unconditionally');
  assert.ok(state.calls.setAlarm[0] < wedged, 'new alarm replaces the wedged one');
  assert.ok(state.calls.setAlarm[0] <= Date.now() + 1000, 'fires within ~FIRST_TICK_MS');
  console.log('  ok  B. a browser connecting force-replaces a wedged alarm (Kay revives)');
}

// ── B2) regression: the old connect path could NOT revive a wedged DO ───────
{
  const wedged = Date.now() + 999_999;
  const state = makeState({ pendingAlarm: wedged });
  const dob = new KayDO(state, {});
  dob._loaded = true;
  await dob._ensureAlarm(300);              // pre-build-6 connect behaviour
  assert.equal(state.calls.setAlarm.length, 0, '_ensureAlarm is a no-op when an alarm is pending');
  console.log('  ok  B2. (regression) old _ensureAlarm path provably could not revive a wedged DO');
}

console.log('\nAll KayDO alarm checks passed');
