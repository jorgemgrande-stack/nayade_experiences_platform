-- Big Elephant — Elephant Connect · Campaigns: campañas de correo enviadas con la cuenta de Brevo PROPIA de la empresa
-- (clave de la bóveda `brevo_marketing`, la misma de la sincronización de 0042). Aditiva, BD de cada empresa; capacidad
-- email-campaigns. Solo crea tablas nuevas (prefijo campaign_); no modifica ninguna existente. Nunca se ejecuta al arrancar.
--
-- `campaign_settings`: una fila (id = 1) con la carpeta de Brevo donde se crean las listas de cada campaña y si ya
--   existe en la cuenta el atributo de contacto con el enlace de baja propio.
-- `campaign_campaigns`: la campaña (asunto, remitente verificado en Brevo, bloques de contenido, segmento por etiquetas
--   del CRM) y su ciclo draft → preparing → scheduled → sent, o failed. `send_claimed_at` se reserva con una
--   actualización condicionada ANTES de pedir a Brevo el envío o la programación: dos peticiones a la vez nunca envían
--   dos veces. La campaña de pruebas de Brevo (sin lista) es otra distinta de la del envío. Estadísticas leídas de
--   Brevo (envíos, aperturas, clics, bajas…).
-- `campaign_recipients`: destinatarios de cada campaña en el momento del envío (cliente del CRM y correo normalizado),
--   para auditar y atribuir las bajas de la lista de la campaña. `removed_at`: sacado de la lista de Brevo antes del
--   envío porque retiró el consentimiento (una baja nunca recibe una campaña ya preparada o programada).
-- `campaign_events`: historial de cada campaña (creación, prueba, envío, programación, fallo, estadísticas).
-- Fechas de programación y envío en milisegundos (sin desfases de zona horaria entre Node y MySQL).

CREATE TABLE IF NOT EXISTS campaign_settings (
  id              TINYINT UNSIGNED NOT NULL,
  folder_id       BIGINT           NULL DEFAULT NULL,
  attribute_ready TINYINT(1)       NOT NULL DEFAULT 0,
  updated_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS campaign_campaigns (
  id                 INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  name               VARCHAR(120)  NOT NULL,
  subject            VARCHAR(200)  NOT NULL DEFAULT '',
  preview_text       VARCHAR(200)  NULL DEFAULT NULL,
  sender_id          BIGINT        NULL DEFAULT NULL,
  sender_name        VARCHAR(120)  NULL DEFAULT NULL,
  sender_email       VARCHAR(190)  NULL DEFAULT NULL,
  reply_to           VARCHAR(190)  NULL DEFAULT NULL,
  blocks             MEDIUMTEXT    NULL,
  tag_ids            VARCHAR(500)  NULL DEFAULT NULL,
  tag_mode           VARCHAR(8)    NOT NULL DEFAULT 'any',
  status             VARCHAR(12)   NOT NULL DEFAULT 'draft',
  scheduled_at       BIGINT        NULL DEFAULT NULL,
  brevo_list_id      BIGINT        NULL DEFAULT NULL,
  brevo_campaign_id  BIGINT        NULL DEFAULT NULL,
  brevo_test_campaign_id BIGINT    NULL DEFAULT NULL,
  brevo_status       VARCHAR(20)   NULL DEFAULT NULL,
  import_process_ids VARCHAR(500)  NULL DEFAULT NULL,
  recipients         INT UNSIGNED  NOT NULL DEFAULT 0,
  launched_at        BIGINT        NULL DEFAULT NULL,
  send_claimed_at    DATETIME(3)   NULL DEFAULT NULL,
  sent_at            BIGINT        NULL DEFAULT NULL,
  error_message      VARCHAR(500)  NULL DEFAULT NULL,
  stat_sent          INT UNSIGNED  NULL DEFAULT NULL,
  stat_delivered     INT UNSIGNED  NULL DEFAULT NULL,
  stat_opens         INT UNSIGNED  NULL DEFAULT NULL,
  stat_clicks        INT UNSIGNED  NULL DEFAULT NULL,
  stat_unsubscribed  INT UNSIGNED  NULL DEFAULT NULL,
  stat_bounces       INT UNSIGNED  NULL DEFAULT NULL,
  stat_complaints    INT UNSIGNED  NULL DEFAULT NULL,
  stats_at           DATETIME(3)   NULL DEFAULT NULL,
  created_by         VARCHAR(100)  NOT NULL,
  updated_by         VARCHAR(100)  NOT NULL,
  created_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_campaign_campaigns_status (status, scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS campaign_recipients (
  campaign_id      INT UNSIGNED NOT NULL,
  client_id        INT          NOT NULL,
  email_normalized VARCHAR(255) NOT NULL,
  brevo_list_id    BIGINT       NOT NULL,
  removed_at       BIGINT       NULL DEFAULT NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (campaign_id, client_id),
  KEY idx_campaign_recipients_email (campaign_id, brevo_list_id, email_normalized)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS campaign_events (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id INT UNSIGNED NOT NULL,
  kind        VARCHAR(20)  NOT NULL,
  detail      VARCHAR(500) NULL DEFAULT NULL,
  actor       VARCHAR(100) NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_campaign_events_campaign (campaign_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
