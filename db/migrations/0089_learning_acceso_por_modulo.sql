-- Elephant LMS: acceso con ventana propia por módulo, desbloqueo progresivo y ampliación individual. Aditiva, BD de cada empresa.
--
-- learning_enrollment_modules.starts_at / ends_at   ventana propia del módulo en la matrícula (ms epoch). NULL = hereda la de la matrícula.
-- learning_access_rule_modules.unlock_offset_days   días desde la concesión en que se desbloquea el módulo. NULL = desde el primer día.
-- learning_access_rule_modules.duration_days        duración de acceso del módulo desde su desbloqueo. NULL = hereda learning_access_rules.duration_days.
-- learning_access_rules.permanent                   1 = la regla declara de forma expresa acceso sin caducidad (0 por defecto).
-- learning_module_extensions                        ampliaciones individuales por módulo; la clave única garantiza que un pedido
--                                                   (pedido + módulo + días) no se aplica dos veces.
--
-- No se rellena ningún dato: las matrículas y reglas existentes se comportan exactamente igual (todo NULL = hereda). Nunca se ejecuta al arrancar.
ALTER TABLE learning_enrollment_modules ADD COLUMN starts_at BIGINT NULL;
ALTER TABLE learning_enrollment_modules ADD COLUMN ends_at BIGINT NULL;
ALTER TABLE learning_access_rule_modules ADD COLUMN unlock_offset_days INT NULL;
ALTER TABLE learning_access_rule_modules ADD COLUMN duration_days INT NULL;
ALTER TABLE learning_access_rules ADD COLUMN permanent TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS learning_module_extensions (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  idempotency_key VARCHAR(190) NOT NULL,
  enrollment_id   INT UNSIGNED NOT NULL,
  module_id       INT UNSIGNED NOT NULL,
  days            INT NOT NULL,
  previous_ends_at BIGINT NULL,
  new_ends_at     BIGINT NOT NULL,
  payment_ref     VARCHAR(190) NULL,
  order_ref       VARCHAR(190) NULL,
  actor_user_id   INT NULL,
  created_at      BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_learning_module_extensions_key (idempotency_key),
  KEY idx_learning_module_extensions_enrollment (enrollment_id, module_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
