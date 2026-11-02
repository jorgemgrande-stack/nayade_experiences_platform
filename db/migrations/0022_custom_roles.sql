-- Big Elephant — Roles personalizados (aditiva, BD de cada empresa; capacidad Business roles-custom).
--
-- Capa ADICIONAL y opcional sobre el rol de siempre de cada usuario (users.role): no sustituye ni activa las tablas
-- rbac_* (siguen ausentes a propósito). Un rol propio parte de un rol base y solo guarda sus diferencias con él.
-- `custom_roles`: roles propios de la empresa (nombre y rol base).
-- `custom_role_permissions`: permisos que el rol propio añade (grant) o quita (revoke) respecto a su rol base.
-- `custom_role_users`: rol propio asignado a cada usuario (como mucho uno). Sin fila, el usuario sigue exactamente igual.
--
-- Solo crea tablas nuevas y vacías: no cambia usuarios ni permisos de nadie. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS custom_roles (
  id          INT          NOT NULL AUTO_INCREMENT,
  name        VARCHAR(60)  NOT NULL,
  base_role   VARCHAR(32)  NOT NULL,
  created_by  INT          NULL DEFAULT NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_custom_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS custom_role_permissions (
  role_id         INT          NOT NULL,
  permission_key  VARCHAR(128) NOT NULL,
  effect          VARCHAR(8)   NOT NULL DEFAULT 'grant',
  PRIMARY KEY (role_id, permission_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS custom_role_users (
  user_id      INT          NOT NULL,
  role_id      INT          NOT NULL,
  assigned_by  INT          NULL DEFAULT NULL,
  assigned_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  KEY idx_custom_role_users_role (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
