-- Inscripción ↔ presupuesto y servicios incluidos pendientes de programar. Aditiva, BD de cada empresa.
--
-- edition_enrollments: `quote_id` (presupuesto del sistema comercial de siempre, `quotes`; el estado del pago se lee de
--   ahí y nunca se guarda en la inscripción), y quién cambió el estado por última vez, cuándo y con qué motivo
--   (`status_changed_by`, `status_changed_at`, `status_reason`; el detalle de cada cambio va además a crm_activity_log).
-- variant_included_services: servicios incluidos en una modalidad (`experience_variants`), p. ej. «3 sesiones
--   individuales de 30 minutos». Nombre, cantidad y duración salen solo de aquí (nunca se inventan). Se archivan, no se
--   borran.
-- enrollment_services: lo que se le debe a una inscripción confirmada (una fila por unidad: servicio + número `seq`),
--   con su estado (pending/scheduled/done/cancelled) y su fecha y hora local cuando se programa. La clave única impide
--   generar dos veces la misma unidad.
--
-- Sin claves foráneas (como el resto de este carril). Todas las columnas nuevas son NULL o con valor por defecto: las
-- filas existentes no cambian. Nunca se ejecuta al arrancar; el código funciona igual sin ella.

ALTER TABLE edition_enrollments
  ADD COLUMN quote_id INT NULL,
  ADD COLUMN status_changed_by VARCHAR(160) NULL,
  ADD COLUMN status_changed_at BIGINT NULL,
  ADD COLUMN status_reason VARCHAR(600) NULL,
  ADD KEY idx_edition_enrollments_quote (quote_id);

CREATE TABLE IF NOT EXISTS variant_included_services (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  variant_id       INT           NOT NULL,
  kind             VARCHAR(32)   NOT NULL,
  label            VARCHAR(160)  NOT NULL,
  quantity         SMALLINT      NOT NULL DEFAULT 1,
  duration_minutes SMALLINT      NULL,
  status           VARCHAR(16)   NOT NULL DEFAULT 'active',
  position         INT           NOT NULL DEFAULT 0,
  created_at       BIGINT        NOT NULL,
  updated_at       BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_variant_included_services_variant (variant_id, status),
  CONSTRAINT chk_variant_included_services_status CHECK (status IN ('active','archived')),
  CONSTRAINT chk_variant_included_services_qty CHECK (quantity >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS enrollment_services (
  id                          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  enrollment_id               INT UNSIGNED  NOT NULL,
  variant_included_service_id INT UNSIGNED  NOT NULL,
  seq                         SMALLINT      NOT NULL,
  label                       VARCHAR(160)  NOT NULL,
  duration_minutes            SMALLINT      NULL,
  status                      VARCHAR(16)   NOT NULL DEFAULT 'pending',
  cancelled_by_enrollment     TINYINT(1)    NOT NULL DEFAULT 0,
  scheduled_for               DATETIME      NULL,
  notes                       VARCHAR(600)  NULL,
  created_at                  BIGINT        NOT NULL,
  updated_at                  BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_enrollment_services_unit (enrollment_id, variant_included_service_id, seq),
  KEY idx_enrollment_services_status (status, scheduled_for),
  CONSTRAINT chk_enrollment_services_status CHECK (status IN ('pending','scheduled','done','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
