-- Reversión de 0005_readonly_role: los usuarios de solo lectura pasan a `user` (sin permisos de
-- equipo) antes de retirar el valor del ENUM. Retirar antes el código que asigna `readonly`.
UPDATE users SET `role` = 'user' WHERE `role` = 'readonly';
ALTER TABLE users
  MODIFY COLUMN `role` enum('user','admin','monitor','agente','adminrest','controler','partner_admin','partner_user','supplier','employee','gestoria') NOT NULL DEFAULT 'user';
