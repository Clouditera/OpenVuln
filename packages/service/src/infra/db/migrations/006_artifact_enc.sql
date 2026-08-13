-- Artifacts text is OVENC1 (same envelope as findings). Wipe any pre-encrypt plaintext.
-- content column holds ciphertext only (or NULL for binary / empty).

UPDATE finding_artifacts
SET content = NULL
WHERE content IS NOT NULL
  AND content NOT LIKE 'OVENC1.%';

COMMENT ON COLUMN finding_artifacts.content IS
  'OVENC1 ciphertext of text artifact body; NULL for binary or empty. Never plaintext.';
