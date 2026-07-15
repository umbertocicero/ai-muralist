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
  model      TEXT,                                    -- Claude model that painted it ('demo' for procedural)
  prompt     TEXT,                                    -- the exact prompt used, so a viewer can recreate it
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- EXISTING databases (created before model/prompt existed): run these once —
-- CREATE TABLE IF NOT EXISTS above won't add columns to a table that's there.
--   wrangler d1 execute ai-muralist-db --remote --command "ALTER TABLE murals ADD COLUMN model TEXT"
--   wrangler d1 execute ai-muralist-db --remote --command "ALTER TABLE murals ADD COLUMN prompt TEXT"
-- (both are also in migrations/0001_mural_model_prompt.sql)

-- One mural per wall per world: the first painter wins, later saves are ignored
-- (mirrors slot.used in the client). Coordinates are rounded to 3 decimals
-- client-side so equality is stable across sessions.
CREATE UNIQUE INDEX IF NOT EXISTS murals_world_slot ON murals (world, px, py, pz);
CREATE INDEX IF NOT EXISTS murals_world ON murals (world);
