-- Big Elephant — Cambio del correo de acceso con verificación (aditiva, BD de cada empresa).
--
-- `email_change_tokens`: solicitudes de cambio del correo de un usuario. El enlace se envía al correo NUEVO y solo se
-- guarda el hash (SHA-256) del token: un solo uso (`used_at`) y caducidad de 60 minutos (`expires_at`).
-- `requested_by`: quién lo pidió (el propio usuario o un administrador de la empresa).
--
-- Solo crea una tabla nueva. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS email_change_tokens (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  user_id       INT          NOT NULL,
  new_email     VARCHAR(320) NOT NULL,
  token_hash    CHAR(64)     NOT NULL,
  requested_by  INT          NULL DEFAULT NULL,
  expires_at    TIMESTAMP(3) NOT NULL,
  used_at       TIMESTAMP(3) NULL DEFAULT NULL,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_email_change_tokens_hash (token_hash),
  KEY idx_email_change_tokens_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
