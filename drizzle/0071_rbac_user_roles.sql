-- ─── Table: rbac_user_roles ───────────────────────────────────────────────────
-- Asigna uno o varios roles RBAC a cada usuario.
-- users.role sigue siendo el mecanismo de auth legacy.
-- Esta tabla coexiste con él sin reemplazarlo.
CREATE TABLE IF NOT EXISTS `rbac_user_roles` (
  `user_id`    int       NOT NULL,
  `role_id`    int       NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`user_id`, `role_id`),
  INDEX `idx_rbac_ur_user` (`user_id`),
  INDEX `idx_rbac_ur_role` (`role_id`)
);
--> statement-breakpoint

-- ─── Seed idempotente: mapear users.role → rbac_roles.key ────────────────────
-- Los valores del enum (admin, agente, adminrest, monitor, user) coinciden
-- exactamente con las keys de rbac_roles, no se necesita transformación.
INSERT IGNORE INTO `rbac_user_roles` (`user_id`, `role_id`)
SELECT u.id, r.id
FROM `users` u
JOIN `rbac_roles` r ON r.`key` = u.role
WHERE r.is_active = 1;
