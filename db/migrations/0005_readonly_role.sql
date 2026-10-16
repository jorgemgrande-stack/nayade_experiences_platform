-- Rol «solo lectura» (`readonly`): consulta lo mismo que el equipo y no puede modificar nada (las
-- mutaciones se rechazan en el servidor). Aditiva: solo amplía el ENUM de `users.role` al final; los
-- valores existentes no cambian y MySQL 8 lo aplica sin copiar la tabla.
ALTER TABLE users
  MODIFY COLUMN `role` enum('user','admin','monitor','agente','adminrest','controler','partner_admin','partner_user','supplier','employee','gestoria','readonly') NOT NULL DEFAULT 'user';
