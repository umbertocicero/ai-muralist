-- Add per-mural provenance so the detail view can show what created each piece.
-- Nullable, so existing rows stay valid and the unique (world,px,py,pz) index is
-- untouched. Apply once to an existing database:
--   wrangler d1 execute ai-muralist-db --remote --file=migrations/0001_mural_model_prompt.sql
ALTER TABLE murals ADD COLUMN model  TEXT;
ALTER TABLE murals ADD COLUMN prompt TEXT;
