-- Archivado de leads: el lead sale de los listados activos, de los indicadores y de los informes sin perder su
-- historial, y se puede recuperar. Aditiva y compatible: tres columnas NULL en crm_leads (sin valor = lead activo).
ALTER TABLE crm_leads
  ADD COLUMN archived_at     BIGINT       NULL,
  ADD COLUMN archived_by     VARCHAR(100) NULL,
  ADD COLUMN archive_reason  VARCHAR(300) NULL,
  ADD KEY idx_lead_archived (archived_at);
