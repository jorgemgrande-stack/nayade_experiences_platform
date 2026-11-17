-- Cambios de idioma principal de la web de cada empresa: copia previa (para la vuelta atrás) y registro. Aditiva, BD de cada empresa.
--
-- `i18n_default_changes`: una fila por cambio aplicado, con quién y cuándo, el idioma anterior y el nuevo, el resumen y la copia
-- previa (JSON) de las filas que el intercambio modifica. Solo crea la tabla; las empresas que no cambian de idioma no la usan.
-- Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS i18n_default_changes (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  from_locale    VARCHAR(35)   NOT NULL,
  to_locale      VARCHAR(35)   NOT NULL,
  status         VARCHAR(16)   NOT NULL DEFAULT 'applied',
  actor_id       INT           NULL,
  actor_name     VARCHAR(128)  NULL,
  summary        JSON          NULL,
  snapshot       LONGTEXT      NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rolled_back_at DATETIME      NULL,
  rolled_back_by VARCHAR(128)  NULL,
  PRIMARY KEY (id),
  KEY idx_i18n_default_changes_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
