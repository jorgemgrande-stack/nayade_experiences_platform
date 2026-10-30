-- Big Elephant — Dispositivos con los que cada usuario ha iniciado sesión (aditiva, BD de cada empresa).
--
-- `user_devices`: una fila por usuario y huella de dispositivo. La huella es un hash (SHA-256) de la cookie de
-- dispositivo persistente y aleatoria más el navegador y el sistema normalizados (sin versiones). No se guarda la IP
-- ni el user-agent completo: solo una etiqueta aproximada («Chrome en Windows»). La clave única (usuario, huella) hace
-- idempotente el registro: el aviso de «nuevo inicio de sesión» sale una sola vez por dispositivo.
--
-- Solo crea una tabla nueva. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS user_devices (
  id             BIGINT       NOT NULL AUTO_INCREMENT,
  user_id        INT          NOT NULL,
  fingerprint    CHAR(64)     NOT NULL,
  label          VARCHAR(120) NOT NULL,
  first_seen_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  notified_at    TIMESTAMP(3) NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_devices_user_fp (user_id, fingerprint),
  KEY idx_user_devices_user (user_id, last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
