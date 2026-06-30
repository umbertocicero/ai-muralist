import { CONFIG } from './config.js';

export const STATE = {
  WANDERING:      'WANDERING',
  MOVING_TO_WALL: 'MOVING_TO_WALL',
  THINKING:       'THINKING',
  PAINTING:       'PAINTING',
  ADMIRING:       'ADMIRING',
  CONTEMPLATING:  'CONTEMPLATING',
};

const STATUS_TEXT = {
  WANDERING:      'wandering the streets',
  MOVING_TO_WALL: 'approaching a blank wall',
  THINKING:       'imagining a mural',
  PAINTING:       'painting…',
  ADMIRING:       'admiring the finished mural',
  CONTEMPLATING:  'every wall is painted · contemplating',
};

export class Agent {
  // ui: the shared reactive uiState object (Vue reactive proxy)
  constructor(city, character, factory, ui) {
    this.city    = city;
    this.char    = character;
    this.factory = factory;
    this.ui      = ui;

    this.muralCount  = 0;
    this.apiPending  = false;
    this.pendingResult = null;
    this.currentSlot   = null;
    this._finishing    = false;   // guards the async finish from re-entry

    this._setState(STATE.WANDERING);
    this._newWanderTarget();
  }

  // ---- State transitions --------------------------------------------------
  _setState(s) {
    this.state      = s;
    this.ui.status  = STATUS_TEXT[s];
  }

  _newWanderTarget() {
    // a far point ahead of his heading → long straight walks, fewer turns
    this.wanderTarget   = this.city.forwardPoint(this.char.pos.x, this.char.pos.z, this.char.facing);
    this.wanderTimer    = 0;
    this.wanderDeadline = CONFIG.wanderMin + Math.random() * CONFIG.wanderRange;
  }

  _beginThinking() {
    this._setState(STATE.THINKING);
    this.thinkTimer = 0;
    this.char.faceNormalInward(this.currentSlot);
    this.ui.onPaintBegin?.(this.currentSlot);   // camera frames the wall + KAI
    this._startGeneration();
  }

  _startGeneration() {
    if (this.apiPending) return;
    this.apiPending    = true;
    this.pendingResult = null;
    const slot  = this.currentSlot;
    const index = this.muralCount;
    slot.used   = true; // reserve up-front
    this.factory.generate(slot, index)
      .then(result => {
        this.pendingResult      = result;
        this.ui.thought         = result.thought;
        this.ui.thoughtVisible  = true;
      })
      .catch(err => {
        this.pendingResult = null;
        console.warn('[agent] generation failed:', err.message);
      })
      .finally(() => { this.apiPending = false; });
  }

  async _finishPainting() {
    const slot  = this.currentSlot;
    const index = this.muralCount;
    try {
      await this.factory.apply(slot, this.pendingResult);
      slot.used = true;
      this.muralCount++;
      this.ui.muralCount = this.muralCount;
      const entry = {
        id:          index,
        styleName:   CONFIG.styleNames[index % CONFIG.styleNames.length],
        wallW:       slot.wallW,
        wallH:       slot.wallH,
        buildingIdx: slot.buildingIdx,
        // where the mural lives, so the sidebar can fly the camera to it
        target: { px: slot.px, py: slot.py, pz: slot.pz, nx: slot.nx, nz: slot.nz },
      };
      // RECENT MURALS HUD — keep only the latest few.
      this.ui.logEntries.unshift(entry);
      if (this.ui.logEntries.length > CONFIG.maxLogEntries) this.ui.logEntries.pop();
      // Full gallery archive — every mural, with a thumbnail rendered straight
      // from the SVG so the side drawer can show what each piece looks like.
      const svg = this.pendingResult?.svg;
      this.ui.gallery.unshift({
        ...entry,
        thumb: svg ? 'data:image/svg+xml;utf8,' + encodeURIComponent(svg) : null,
      });
      // Step aside + back so KAI isn't standing in front of his own mural while
      // the camera frames it head-on; the side is chosen open (see helper below).
      this.admirePos   = this._admireStandPoint(slot);
      this.admireTimer = 0;
      this.ui.onAdmire?.(slot);
      this._setState(STATE.ADMIRING);
    } catch (e) {
      slot.used = false; // release so it can be retried
      console.warn('[agent] apply failed:', e.message);
      this._returnToWander();
    }
  }

  _releaseSlot() {
    if (this.currentSlot) this.currentSlot.used = false;
    this._returnToWander();
  }

  // Where KAI stands to admire a finished mural: a step BACK from the wall and
  // to one side, so he's clear of the camera's head-on framing. Prefer whichever
  // side of the wall is open; fall back to the plain approach point if both are
  // blocked (a tight alley).
  _admireStandPoint(slot) {
    const ap = this.city.approachPoint(slot);    // 1.5 m out, square in front of the wall
    const tx = -slot.nz, tz = slot.nx;           // unit tangent along the wall
    const back = 0.8, side = 1.9;
    const cand = sgn => ({
      x: ap.x + slot.nx * back + tx * side * sgn,
      z: ap.z + slot.nz * back + tz * side * sgn,
    });
    const a = cand(1);  if (!this.city.isColliding(a.x, a.z)) return a;
    const b = cand(-1); if (!this.city.isColliding(b.x, b.z)) return b;
    return ap;
  }

  _returnToWander() {
    this.ui.flashActive    = false;
    this.ui.thoughtVisible = false;
    this.pendingResult     = null;
    this.currentSlot       = null;
    this._finishing        = false;
    this.ui.onPaintEnd?.();          // camera rises back up + resumes follow
    this._newWanderTarget();
    this._setState(STATE.WANDERING);
  }

  // ---- Main update (called every frame) -----------------------------------
  update(dt, t) {
    const step = CONFIG.moveSpeed * dt;

    switch (this.state) {

      case STATE.WANDERING: {
        this.wanderTimer += dt;
        const moved   = this.city.steer(this.char.pos, this.wanderTarget, step);
        if (moved) this.char.faceDirection(moved);
        const arrived = Math.hypot(this.wanderTarget.x - this.char.pos.x, this.wanderTarget.z - this.char.pos.z) < 0.8;
        // reached the far target → pick the next one ahead; only when truly
        // stuck (dead-end) escape in any direction, so he keeps long straight legs
        if (arrived) this._newWanderTarget();
        else if (!moved) this.wanderTarget = this.city.randomReachablePoint();

        if (this.wanderTimer > this.wanderDeadline) {
          const slot = this.city.pickFreeSlot(this.char.pos);
          if (slot)                       { this.currentSlot = slot; this.moveTimer = 0; this._setState(STATE.MOVING_TO_WALL); }
          else if (this.city.allWallsUsed()) this._setState(STATE.CONTEMPLATING);
          else                              this._newWanderTarget();
        }
        this.char.walk(t);
        break;
      }

      case STATE.MOVING_TO_WALL: {
        this.moveTimer += dt;
        const ap     = this.city.approachPoint(this.currentSlot);
        const moved  = this.city.steer(this.char.pos, ap, step);
        if (moved) this.char.faceDirection(moved);
        const dist   = Math.hypot(ap.x - this.char.pos.x, ap.z - this.char.pos.z);
        if (dist < 0.5) {
          // actually arrived at the wall → paint it
          this._beginThinking();
        } else if (!moved || this.moveTimer > CONFIG.reachTimeout) {
          // can't reach this wall (blocked path / unreachable approach) — never
          // paint a wall KAI didn't get to. Release it and wander on.
          this._releaseSlot();
        }
        this.char.walk(t);
        break;
      }

      case STATE.THINKING: {
        this.thinkTimer += dt;
        this.char.idle(t);
        if (this.thinkTimer > CONFIG.thinkSeconds && !this.apiPending) {
          if (this.pendingResult?.svg) {
            this._setState(STATE.PAINTING);
            this.paintTimer       = 0;
            this.ui.flashActive   = true;
          } else {
            this._releaseSlot();
          }
        }
        break;
      }

      case STATE.PAINTING: {
        this.paintTimer += dt;
        this.char.paint(t);
        // _finishPainting is async (it awaits the SVG image load); guard so the
        // still-PAINTING state can't re-enter it across frames → exactly one
        // mural + one log entry per wall.
        if (this.paintTimer > CONFIG.paintSeconds && !this._finishing) {
          this._finishing = true;
          this._finishPainting();
        }
        break;
      }

      case STATE.ADMIRING: {
        // KAI steps aside to the open side, turns to face the wall, and he + the
        // camera hold on the finished mural for a few seconds.
        this.admireTimer += dt;
        const dist = this.admirePos
          ? Math.hypot(this.admirePos.x - this.char.pos.x, this.admirePos.z - this.char.pos.z) : 0;
        if (dist > 0.25) {
          const moved = this.city.steer(this.char.pos, this.admirePos, step * 0.8);
          if (moved) this.char.faceDirection(moved);
          this.char.walk(t, 0.8);
        } else {
          this.char.faceNormalInward(this.currentSlot);
          this.char.idle(t);
        }
        if (this.admireTimer > CONFIG.admireSeconds) this._returnToWander();
        break;
      }

      case STATE.CONTEMPLATING: {
        const moved   = this.city.steer(this.char.pos, this.wanderTarget, step * 0.6);
        if (moved) this.char.faceDirection(moved);
        const arrived = Math.hypot(this.wanderTarget.x - this.char.pos.x, this.wanderTarget.z - this.char.pos.z) < 0.8;
        if (arrived)      this.wanderTarget = this.city.forwardPoint(this.char.pos.x, this.char.pos.z, this.char.facing);
        else if (!moved)  this.wanderTarget = this.city.randomReachablePoint();
        this.char.walk(t, 0.6);
        break;
      }
    }

    this.char.sync();
  }
}
