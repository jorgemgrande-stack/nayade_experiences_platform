-- Big Elephant — Social Token Net · Comunidades: encuestas, propuestas de miembros y reportes (aditiva, BD de cada
-- empresa; capacidad social-token-net). Sigue a 0027_communities.
--
-- `community_polls`: encuestas y preguntas de una comunidad (9 tipos de pregunta), con ventana de respuesta
-- (starts_at/ends_at: el estado efectivo se calcula al leer, sin planificador), visibilidad de resultados, si se
-- puede cambiar la respuesta y, para eventos, el producto del catálogo que se reserva (experience_id) y su fecha.
-- `community_poll_options`: opciones de los tipos que las tienen (elección única o múltiple, orden, valoración).
-- `community_poll_responses` + `community_poll_values`: una respuesta por persona y encuesta (clave única) y sus
-- valores (una fila por opción marcada, ordenada o puntuada), con ocultación de las respuestas libres.
-- `community_proposals`: propuestas de los miembros (moderación, rechazo con motivo y conversión en encuesta).
-- `community_proposal_supports`: apoyos (uno por persona; retirarlo lo desactiva, active = 0).
-- `community_reports`: reportes de contenido de los miembros (uno por persona y elemento) y su resolución.
--
-- Solo crea tablas nuevas. Sin la capacidad nada se usa. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS community_polls (
  id                     INT           NOT NULL AUTO_INCREMENT,
  community_id           INT           NOT NULL,
  title                  VARCHAR(200)  NOT NULL,
  description            TEXT          NULL,
  question_type          VARCHAR(24)   NOT NULL,
  status                 VARCHAR(16)   NOT NULL DEFAULT 'draft',
  starts_at              BIGINT        NULL DEFAULT NULL,
  ends_at                BIGINT        NULL DEFAULT NULL,
  results_visibility     VARCHAR(16)   NOT NULL DEFAULT 'after_vote',
  allow_change_response  TINYINT(1)    NOT NULL DEFAULT 1,
  experience_id          INT           NULL DEFAULT NULL,
  event_at               BIGINT        NULL DEFAULT NULL,
  source_proposal_id     INT           NULL DEFAULT NULL,
  created_by             INT           NULL DEFAULT NULL,
  published_at           BIGINT        NULL DEFAULT NULL,
  closed_at              BIGINT        NULL DEFAULT NULL,
  created_at             BIGINT        NOT NULL,
  updated_at             BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_community_polls_community (community_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS community_poll_options (
  id                  INT           NOT NULL AUTO_INCREMENT,
  poll_id             INT           NOT NULL,
  label               VARCHAR(200)  NOT NULL,
  sort_order          INT           NOT NULL DEFAULT 0,
  is_positive_intent  TINYINT(1)    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_community_poll_options_poll (poll_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS community_poll_responses (
  id            INT     NOT NULL AUTO_INCREMENT,
  poll_id       INT     NOT NULL,
  user_id       INT     NOT NULL,
  responded_at  BIGINT  NOT NULL,
  updated_at    BIGINT  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_community_poll_responses (poll_id, user_id),
  KEY idx_community_poll_responses_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS community_poll_values (
  id            INT          NOT NULL AUTO_INCREMENT,
  response_id   INT          NOT NULL,
  poll_id       INT          NOT NULL,
  revision      INT          NOT NULL DEFAULT 1,
  current       TINYINT(1)   NOT NULL DEFAULT 1,
  option_id     INT          NULL DEFAULT NULL,
  value_text    TEXT         NULL,
  value_number  INT          NULL DEFAULT NULL,
  hidden        TINYINT(1)   NOT NULL DEFAULT 0,
  featured      TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    BIGINT       NOT NULL,
  PRIMARY KEY (id),
  KEY idx_community_poll_values_response (response_id, current),
  KEY idx_community_poll_values_poll (poll_id, current, option_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS community_proposals (
  id                      INT            NOT NULL AUTO_INCREMENT,
  community_id            INT            NOT NULL,
  author_user_id          INT            NOT NULL,
  title                   VARCHAR(200)   NOT NULL,
  description             TEXT           NULL,
  proposed_question_type  VARCHAR(24)    NULL DEFAULT NULL,
  proposed_options        JSON           NULL,
  status                  VARCHAR(16)    NOT NULL DEFAULT 'pending',
  reason_for_member       VARCHAR(300)   NULL DEFAULT NULL,
  internal_note           VARCHAR(300)   NULL DEFAULT NULL,
  moderated_by            INT            NULL DEFAULT NULL,
  moderated_at            BIGINT         NULL DEFAULT NULL,
  converted_poll_id       INT            NULL DEFAULT NULL,
  created_at              BIGINT         NOT NULL,
  updated_at              BIGINT         NOT NULL,
  PRIMARY KEY (id),
  KEY idx_community_proposals_community (community_id, status, created_at),
  KEY idx_community_proposals_author (author_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS community_proposal_supports (
  id           INT         NOT NULL AUTO_INCREMENT,
  proposal_id  INT         NOT NULL,
  user_id      INT         NOT NULL,
  active       TINYINT(1)  NOT NULL DEFAULT 1,
  created_at   BIGINT      NOT NULL,
  updated_at   BIGINT      NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_community_proposal_supports (proposal_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS community_reports (
  id                INT           NOT NULL AUTO_INCREMENT,
  community_id      INT           NOT NULL,
  target_type       VARCHAR(16)   NOT NULL,
  target_id         INT           NOT NULL,
  reporter_user_id  INT           NOT NULL,
  reason            VARCHAR(24)   NOT NULL,
  details           VARCHAR(500)  NULL DEFAULT NULL,
  status            VARCHAR(16)   NOT NULL DEFAULT 'open',
  resolved_by       INT           NULL DEFAULT NULL,
  resolved_at       BIGINT        NULL DEFAULT NULL,
  created_at        BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_community_reports (target_type, target_id, reporter_user_id),
  KEY idx_community_reports_status (community_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
