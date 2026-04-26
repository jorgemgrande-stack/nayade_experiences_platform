CREATE TABLE IF NOT EXISTS `rbac_roles` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `key` varchar(64) NOT NULL UNIQUE,
  `name` varchar(128) NOT NULL,
  `description` text,
  `is_legacy` boolean NOT NULL DEFAULT false,
  `is_active` boolean NOT NULL DEFAULT true,
  `sort_order` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT (now())
);
--> statement-breakpoint
INSERT IGNORE INTO `rbac_roles` (`key`, `name`, `description`, `is_legacy`, `sort_order`) VALUES
  ('admin',            'Administrador',            'Acceso total al sistema',                                                                              true,  1),
  ('agente',           'Agente Comercial (legacy)', 'Rol legacy: CRM, reservas y TPV operativo',                                                          true,  2),
  ('adminrest',        'Gestor Restaurantes',       'Rol legacy: gestión de reservas de restaurante (solo los asignados)',                                  true,  3),
  ('monitor',          'Monitor',                   'Rol legacy: calendario y actividades en modo lectura',                                                 true,  4),
  ('user',             'Usuario',                   'Sin acceso al panel de administración',                                                                true,  5),
  ('commercial_agent', 'Agente Comercial',          'Gestiona leads, presupuestos, reservas y actividad comercial. Sin acceso a TPV ni caja.',              false, 6),
  ('sales_cashier',    'Agente + Caja',             'Gestiona actividad comercial y además puede operar el TPV, abrir caja, vender y cerrar caja.',         false, 7);
