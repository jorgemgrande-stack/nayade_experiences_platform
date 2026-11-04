-- Big Elephant — Social Token Net · Comunidades (aditiva, BD de cada empresa; capacidad social-token-net).
--
-- `communities`: comunidades de la empresa con su identidad visual (portada, logotipo y color), descripción,
-- visibilidad ('open' cualquiera con cuenta puede unirse, 'request' con solicitud aprobada, 'private' solo por alta o
-- invitación), si los miembros publican y si sus publicaciones se revisan antes ('none' o 'pre'). Nunca se borran: se
-- archivan.
-- `community_members`: personas de la comunidad. Siempre son usuarios del Core (users.id; las cuentas de cliente usan
-- el rol 'user'), con su cliente del CRM si lo hay (clients.id). Rol dentro de la comunidad ('admin', 'moderator',
-- 'member') y estado ('active', 'pending', 'blocked', 'left'). Una fila por persona y comunidad.
-- `community_posts`, `community_comments`: publicaciones y comentarios (un nivel de respuesta). Moderación sin borrado:
-- 'pending' (revisión previa), 'published' o 'hidden', con quién, cuándo y por qué.
-- `community_reactions`: «me gusta» de publicaciones y comentarios (uno por persona). `community_saves`: guardados.
-- Quitar un «me gusta» o un guardado no borra la fila: la marca inactiva (active = 0).
-- `community_activity`: actividad y eventos de dominio (miembro publica, comenta, reacciona, se une…). event_key
-- única: un mismo hecho se registra una sola vez; es el punto de lectura de las recompensas de participación.
--
-- Solo crea tablas nuevas. Sin la capacidad nada se usa. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS communities (
  id                  INT           NOT NULL AUTO_INCREMENT,
  slug                VARCHAR(80)   NOT NULL,
  name                VARCHAR(120)  NOT NULL,
  description         TEXT          NULL,
  cover_image_url     VARCHAR(512)  NULL DEFAULT NULL,
  logo_url            VARCHAR(512)  NULL DEFAULT NULL,
  accent_color        VARCHAR(7)    NULL DEFAULT NULL,
  visibility          VARCHAR(16)   NOT NULL DEFAULT 'private',
  allow_member_posts  TINYINT(1)    NOT NULL DEFAULT 1,
  post_moderation     VARCHAR(8)    NOT NULL DEFAULT 'none',
  status              VARCHAR(16)   NOT NULL DEFAULT 'active',
  created_by          INT           NULL DEFAULT NULL,
  created_at          BIGINT        NOT NULL,
  updated_at          BIGINT        NOT NULL,
  archived_at         BIGINT        NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_communities_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS community_members (
  id              INT           NOT NULL AUTO_INCREMENT,
  community_id    INT           NOT NULL,
  user_id         INT           NOT NULL,
  client_id       INT           NULL DEFAULT NULL,
  role            VARCHAR(16)   NOT NULL DEFAULT 'member',
  status          VARCHAR(16)   NOT NULL DEFAULT 'active',
  source          VARCHAR(16)   NOT NULL DEFAULT 'admin',
  status_reason   VARCHAR(300)  NULL DEFAULT NULL,
  added_by        INT           NULL DEFAULT NULL,
  joined_at       BIGINT        NULL DEFAULT NULL,
  last_seen_at    BIGINT        NULL DEFAULT NULL,
  created_at      BIGINT        NOT NULL,
  updated_at      BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_community_members_user (community_id, user_id),
  KEY idx_community_members_user (user_id),
  KEY idx_community_members_status (community_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS community_posts (
  id              INT           NOT NULL AUTO_INCREMENT,
  community_id    INT           NOT NULL,
  author_user_id  INT           NOT NULL,
  kind            VARCHAR(16)   NOT NULL DEFAULT 'post',
  title           VARCHAR(200)  NULL DEFAULT NULL,
  body            TEXT          NOT NULL,
  image_url       VARCHAR(512)  NULL DEFAULT NULL,
  pinned          TINYINT(1)    NOT NULL DEFAULT 0,
  status          VARCHAR(16)   NOT NULL DEFAULT 'published',
  moderated_by    INT           NULL DEFAULT NULL,
  moderated_at    BIGINT        NULL DEFAULT NULL,
  moderation_note VARCHAR(300)  NULL DEFAULT NULL,
  created_at      BIGINT        NOT NULL,
  updated_at      BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_community_posts_feed (community_id, status, pinned, created_at),
  KEY idx_community_posts_author (author_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS community_comments (
  id                 INT            NOT NULL AUTO_INCREMENT,
  community_id       INT            NOT NULL,
  post_id            INT            NOT NULL,
  author_user_id     INT            NOT NULL,
  parent_comment_id  INT            NULL DEFAULT NULL,
  body               VARCHAR(1000)  NOT NULL,
  hidden             TINYINT(1)     NOT NULL DEFAULT 0,
  hidden_by          INT            NULL DEFAULT NULL,
  hidden_at          BIGINT         NULL DEFAULT NULL,
  created_at         BIGINT         NOT NULL,
  PRIMARY KEY (id),
  KEY idx_community_comments_post (post_id, created_at),
  KEY idx_community_comments_parent (parent_comment_id),
  KEY idx_community_comments_author (author_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS community_reactions (
  id            INT          NOT NULL AUTO_INCREMENT,
  community_id  INT          NOT NULL,
  target_type   VARCHAR(16)  NOT NULL,
  target_id     INT          NOT NULL,
  user_id       INT          NOT NULL,
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    BIGINT       NOT NULL,
  updated_at    BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_community_reactions (target_type, target_id, user_id),
  KEY idx_community_reactions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS community_saves (
  id            INT     NOT NULL AUTO_INCREMENT,
  community_id  INT     NOT NULL,
  post_id       INT     NOT NULL,
  user_id       INT     NOT NULL,
  active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    BIGINT  NOT NULL,
  updated_at    BIGINT  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_community_saves (post_id, user_id),
  KEY idx_community_saves_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS community_activity (
  id             BIGINT        NOT NULL AUTO_INCREMENT,
  community_id   INT           NOT NULL,
  actor_user_id  INT           NULL DEFAULT NULL,
  type           VARCHAR(40)   NOT NULL,
  target_type    VARCHAR(16)   NULL DEFAULT NULL,
  target_id      INT           NULL DEFAULT NULL,
  event_key      VARCHAR(160)  NOT NULL,
  data           JSON          NULL,
  created_at     BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_community_activity_key (event_key),
  KEY idx_community_activity_feed (community_id, created_at),
  KEY idx_community_activity_actor (actor_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
