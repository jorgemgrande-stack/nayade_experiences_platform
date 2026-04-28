-- Administrador principal: Jorge Grande <reservas@nayadeexperiences.es>
-- Contraseña temporal: Nayade2026!  (cambiar tras primer login)

-- 1a. Si el usuario YA existe → corregir nombre, activar cuenta y fijar contraseña temporal
UPDATE `users` SET
  `name`              = 'Jorge Grande',
  `passwordHash`      = '$2b$12$0H7mYbnfPI..jB1OnjVU.et6OmS.PDCajdlmkQzKmQwoCfXKP68L6',
  `role`              = 'admin',
  `isActive`          = 1,
  `inviteAccepted`    = 1,
  `loginMethod`       = 'local',
  `inviteToken`       = NULL,
  `inviteTokenExpiry` = NULL,
  `updatedAt`         = NOW()
WHERE `email` = 'reservas@nayadeexperiences.es';
--> statement-breakpoint

-- 1b. Si NO existe → crearlo
INSERT INTO `users`
  (`openId`, `name`, `email`, `passwordHash`, `role`, `isActive`,
   `inviteAccepted`, `loginMethod`, `createdAt`, `updatedAt`, `lastSignedIn`)
SELECT
  'local_admin_nayade',
  'Jorge Grande',
  'reservas@nayadeexperiences.es',
  '$2b$12$0H7mYbnfPI..jB1OnjVU.et6OmS.PDCajdlmkQzKmQwoCfXKP68L6',
  'admin', 1, 1, 'local', NOW(), NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `users` WHERE `email` = 'reservas@nayadeexperiences.es'
);
--> statement-breakpoint

-- 2. Asignar rol RBAC admin
INSERT IGNORE INTO `rbac_user_roles` (`user_id`, `role_id`)
SELECT u.id, r.id
FROM `users` u
JOIN `rbac_roles` r ON r.`key` = 'admin' AND r.is_active = 1
WHERE u.`email` = 'reservas@nayadeexperiences.es';
--> statement-breakpoint

-- 3. Garantizar que el rol admin tiene TODOS los permisos (CROSS JOIN idempotente)
INSERT IGNORE INTO `rbac_role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `rbac_roles` r
CROSS JOIN `rbac_permissions` p
WHERE r.`key` = 'admin';
