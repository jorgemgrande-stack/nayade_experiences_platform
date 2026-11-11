-- Big Elephant — envío por correo y recuperación del enlace de aceptación de las condiciones comerciales
-- personalizadas (aditiva). Ver server/commercialTerms/acceptanceLinks.ts y docs/elephant-source/CONDICIONES_PERSONALIZADAS.md.
--
-- `commercial_terms_acceptance_links`: el enlace personal de cada solicitud de aceptación (`crm_contract_acceptances`),
--   CIFRADO en reposo (AES-256-GCM con el llavero del registro, REGISTRY_KEYS; el id de la aceptación va como datos
--   autenticados: un valor copiado a otra fila no descifra). La búsqueda del enlace público sigue siendo por la huella
--   (`crm_contract_acceptances.token_sha256`); esta fila solo permite al operador con el permiso de precios
--   personalizados volver a consultarlo y reenviarlo. Consultarlo no lo consume.
-- `commercial_terms_acceptance_sends`: historial de envíos del correo con el enlace (destinatario, fecha, contrato y
--   versión, mensaje de la bandeja de salida y resultado al encolarlo). Nunca guarda el enlace.
-- Sin estas tablas la aceptación funciona como hasta ahora (el enlace se entrega una sola vez). Nunca se ejecuta al arrancar.

CREATE TABLE commercial_terms_acceptance_links (
  acceptance_id BIGINT UNSIGNED NOT NULL,
  terms_id INT NOT NULL,
  contract_id BIGINT UNSIGNED NOT NULL,
  token_cipher VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  key_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (acceptance_id),
  KEY idx_terms_acceptance_links_terms (terms_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE commercial_terms_acceptance_sends (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  terms_id INT NOT NULL,
  acceptance_id BIGINT UNSIGNED NOT NULL,
  contract_id BIGINT UNSIGNED NOT NULL,
  contract_version INT UNSIGNED NOT NULL,
  kind VARCHAR(16) NOT NULL,
  recipient_name VARCHAR(160) NOT NULL,
  recipient_email VARCHAR(254) NOT NULL,
  outbox_id BIGINT UNSIGNED NULL,
  status VARCHAR(24) NOT NULL,
  reason VARCHAR(300) NULL,
  actor VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_terms_acceptance_sends_terms (terms_id, id),
  KEY idx_terms_acceptance_sends_acceptance (acceptance_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
