-- Fase 1 del módulo Personal / RRHH.
--
-- Amplía el enum `type` de monitor_documents con valores nuevos (prl,
-- formacion, nomina_pdf, baja_medica, finiquito) y añade columnas
-- `expires_at` (vencimiento de documento) y `signed_by_employee_at`
-- (preparado para firma digital futura).
--
-- MODIFY COLUMN sobre enum solo AÑADE valores nuevos — los valores antiguos
-- y datos existentes ('dni','contrato','certificado','otro') no se ven
-- afectados. Cero riesgo de pérdida de datos.

ALTER TABLE `monitor_documents`
  MODIFY COLUMN `type` enum(
    'dni',
    'contrato',
    'certificado',
    'prl',
    'formacion',
    'nomina_pdf',
    'baja_medica',
    'finiquito',
    'otro'
  ) NOT NULL;
--> statement-breakpoint

ALTER TABLE `monitor_documents`
  ADD COLUMN IF NOT EXISTS `expires_at`            date       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `signed_by_employee_at` timestamp  NULL DEFAULT NULL;
--> statement-breakpoint

-- Índice para localizar documentos próximos a vencer (dashboard RRHH futuro).
CREATE INDEX IF NOT EXISTS `idx_monitor_documents_expires_at` ON `monitor_documents` (`expires_at`);
