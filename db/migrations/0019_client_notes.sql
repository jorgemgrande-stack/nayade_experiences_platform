-- Big Elephant — Notas de la ficha de cliente del CRM (aditiva, BD de cada empresa).
--
-- `client_notes`: notas internas del equipo sobre un cliente, con autor y fecha (la ficha las muestra en su
-- historial). `author_name` conserva el nombre aunque el usuario se dé de baja. Solo la ve el equipo de la empresa.
--
-- Solo crea una tabla nueva. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS client_notes (
  id           INT          NOT NULL AUTO_INCREMENT,
  client_id    INT          NOT NULL,
  body         TEXT         NOT NULL,
  author_id    INT          NULL DEFAULT NULL,
  author_name  VARCHAR(256) NULL DEFAULT NULL,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_client_notes_client (client_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
