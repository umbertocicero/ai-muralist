-- AI Muralist — D1 schema (persistent murals)
-- Apply with:
--   wrangler d1 execute ai-muralist-db --remote --file=schema.sql
--
-- One row per painted wall. The town is generated from a fixed seed
-- (CONFIG.worldSeed), so a wall slot is identified by its flat-world anchor
-- (px, py, pz): on boot the client re-attaches each saved mural to the slot
-- at those coordinates. `world` keys the rows to the generator seed, so a
-- future town layout change doesn't glue old murals onto mismatched walls.

CREATE TABLE IF NOT EXISTS murals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  world      INTEGER NOT NULL,                        -- city generator seed
  px         REAL    NOT NULL,                        -- wall anchor (flat coords)
  py         REAL    NOT NULL,
  pz         REAL    NOT NULL,
  nx         REAL    NOT NULL,                        -- outward wall normal
  nz         REAL    NOT NULL,
  wall_w     REAL    NOT NULL,
  wall_h     REAL    NOT NULL,
  style      TEXT    NOT NULL,                        -- Ukiyo-e · Sumi-e · …
  thought    TEXT,                                    -- KAI's one-line monologue
  svg        TEXT    NOT NULL,                        -- the artwork itself
  user_id    TEXT    NOT NULL,                        -- anonymous painter id (per browser)
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One mural per wall per world: the first painter wins, later saves are ignored
-- (mirrors slot.used in the client). Coordinates are rounded to 3 decimals
-- client-side so equality is stable across sessions.
CREATE UNIQUE INDEX IF NOT EXISTS murals_world_slot ON murals (world, px, py, pz);
CREATE INDEX IF NOT EXISTS murals_world ON murals (world);
