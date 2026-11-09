-- Big Elephant — Embudo de la prueba gratuita: contador ANÓNIMO de la página (aditiva).
--
-- `funnel_landing_counts`: visitas e inicios del formulario de www.bigelephant.es/prueba-gratuita por día, paso y canal
--   de procedencia (utm_source o dominio de referencia), medio y campaña. Sin datos personales: ni usuario, ni IP, ni
--   navegador, ni correo. Las etapas siguientes (envío, verificación, plataforma, primer acceso, primera acción,
--   contratación) salen de `trial_requests` y `trial_events`.
-- Sin esta tabla la ruta pública responde 202 y descarta (server/trials/funnel.ts).

CREATE TABLE funnel_landing_counts (
  day DATE NOT NULL,
  step VARCHAR(16) NOT NULL,
  channel VARCHAR(60) NOT NULL DEFAULT '',
  medium VARCHAR(60) NOT NULL DEFAULT '',
  campaign VARCHAR(80) NOT NULL DEFAULT '',
  count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (day, step, channel, medium, campaign)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
