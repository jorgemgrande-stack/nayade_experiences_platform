-- Reversión de 0052: los leads archivados vuelven a figurar como activos (se pierde la marca de archivado, no los datos).
ALTER TABLE crm_leads
  DROP KEY idx_lead_archived,
  DROP COLUMN archive_reason,
  DROP COLUMN archived_by,
  DROP COLUMN archived_at;
