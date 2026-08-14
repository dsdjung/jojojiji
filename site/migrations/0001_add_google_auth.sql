-- Adds identity-provider columns so comments can be attributed to a verified
-- Google account instead of a self-declared name.
--
-- Apply:
--   npx wrangler d1 execute jojojiji-comments --local  --file=./migrations/0001_add_google_auth.sql
--   npx wrangler d1 execute jojojiji-comments --remote --file=./migrations/0001_add_google_auth.sql
--
-- Existing rows become 'anonymous', which is what they were.
--
-- Note: SQLite cannot add a CHECK constraint to an existing table without
-- rebuilding it. The constraint is present in schema.sql for fresh databases;
-- here the application layer is what restricts the value.

ALTER TABLE comments ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'anonymous';
ALTER TABLE comments ADD COLUMN provider_sub  TEXT;
ALTER TABLE comments ADD COLUMN avatar_url    TEXT;

CREATE INDEX IF NOT EXISTS idx_comments_provider_sub
  ON comments (provider_sub);
