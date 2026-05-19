-- Fase 3 del módulo Personal / RRHH.
--
-- Añade el rol 'employee' al enum users.role para que los empleados puedan
-- iniciar sesión en su propio Portal del Empleado.
--
-- MODIFY COLUMN sobre enum solo AÑADE valores nuevos — los valores antiguos
-- ('user','admin','monitor','agente','adminrest','controler','partner_admin',
-- 'partner_user') y los datos existentes no se ven afectados.

ALTER TABLE `users`
  MODIFY COLUMN `role` enum(
    'user',
    'admin',
    'monitor',
    'agente',
    'adminrest',
    'controler',
    'partner_admin',
    'partner_user',
    'employee'
  ) NOT NULL DEFAULT 'user';
