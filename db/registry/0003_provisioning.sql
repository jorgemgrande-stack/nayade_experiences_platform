-- ============================================================================
-- Registro de tenants — esquema v1.3.0: estado del aprovisionamiento
--
-- Sin clave foránea a tenants: el estado se persiste antes de que el tenant exista.
-- Estado operativo del alta (pasos hechos, intentos, último error). No contiene secretos:
-- ni DSN ni invitaciones se persisten aquí.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_provisioning (
  tenant_id  VARCHAR(63)  NOT NULL PRIMARY KEY,
  request    JSON         NOT NULL,
  steps      JSON         NOT NULL,
  status     ENUM('pending','running','failed','completed','aborted') NOT NULL DEFAULT 'pending',
  attempts   INT          NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE registry_meta SET v = '0003' WHERE k = 'schema_version';
