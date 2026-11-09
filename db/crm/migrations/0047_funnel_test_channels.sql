-- Big Elephant — Embudo de la prueba gratuita: canales técnicos o de prueba (aditiva).
--
-- `funnel_test_channels`: canales de procedencia (utm_source o dominio) de visitas y altas de verificación que no deben
--   contar en el embudo ni en los informes. Se marcan con una acción auditada (POST /cp/v1/trials/funnel/test-channels:
--   quién, cuándo y por qué) y nunca se borra ningún contador. Sin esta tabla no se excluye ningún canal.

CREATE TABLE funnel_test_channels (
  channel VARCHAR(60) NOT NULL,
  reason VARCHAR(200) NOT NULL,
  actor VARCHAR(120) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
