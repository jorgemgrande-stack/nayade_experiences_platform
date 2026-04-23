-- Columns refund_executed_at and refund_proof_url are managed by ensureRefundColumns()
-- at server startup (INFORMATION_SCHEMA check + ALTER TABLE). MySQL 8 does not support
-- ADD COLUMN IF NOT EXISTS, so this migration is intentionally a no-op.
SELECT 1;
