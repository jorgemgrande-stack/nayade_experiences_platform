-- Phase 4: Re-seed rbac_user_roles para todos los usuarios activos.
-- Idempotente (INSERT IGNORE). Cubre usuarios creados después de la migración 0071
-- y garantiza que reservas@nayadeexperiences.es tiene el rol admin con plenos permisos.
INSERT IGNORE INTO `rbac_user_roles` (`user_id`, `role_id`)
SELECT u.id, r.id
FROM `users` u
JOIN `rbac_roles` r ON r.`key` = u.role
WHERE r.is_active = 1;
