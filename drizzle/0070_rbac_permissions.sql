-- ─── Table: rbac_permissions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `rbac_permissions` (
  `id`          int           NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `key`         varchar(128)  NOT NULL UNIQUE,
  `module`      varchar(64)   NOT NULL,
  `action`      varchar(128)  NOT NULL,
  `description` text,
  `created_at`  timestamp     NOT NULL DEFAULT (now())
);
--> statement-breakpoint

-- ─── Table: rbac_role_permissions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `rbac_role_permissions` (
  `role_id`       int       NOT NULL,
  `permission_id` int       NOT NULL,
  `created_at`    timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`role_id`, `permission_id`)
);
--> statement-breakpoint

-- ─── Seed: permissions ───────────────────────────────────────────────────────
INSERT IGNORE INTO `rbac_permissions` (`key`, `module`, `action`, `description`) VALUES
  -- CRM
  ('crm.view',                      'crm',          'view',                   'Ver módulo CRM'),
  ('crm.leads.manage',              'crm',          'leads.manage',           'Gestionar leads'),
  ('crm.quotes.manage',             'crm',          'quotes.manage',          'Gestionar presupuestos'),
  ('crm.reservations.manage',       'crm',          'reservations.manage',    'Gestionar reservas'),
  ('crm.payments.confirm',          'crm',          'payments.confirm',       'Confirmar pagos de reserva'),
  ('crm.invoices.view',             'crm',          'invoices.view',          'Ver facturas'),
  -- TPV
  ('tpv.access',                    'tpv',          'access',                 'Acceder al TPV'),
  ('tpv.sell',                      'tpv',          'sell',                   'Realizar ventas en TPV'),
  ('tpv.open_close',                'tpv',          'open_close',             'Abrir y cerrar caja'),
  ('tpv.backoffice',                'tpv',          'backoffice',             'Backoffice TPV: liquidaciones y ajustes'),
  ('tpv.refund',                    'tpv',          'refund',                 'Realizar devoluciones en TPV'),
  -- Contabilidad
  ('accounting.view',               'accounting',   'view',                   'Ver módulo de contabilidad'),
  ('accounting.expenses.view',      'accounting',   'expenses.view',          'Ver gastos'),
  ('accounting.expenses.manage',    'accounting',   'expenses.manage',        'Gestionar gastos'),
  ('accounting.bank.view',          'accounting',   'bank.view',              'Ver movimientos bancarios'),
  ('accounting.bank.manage',        'accounting',   'bank.manage',            'Gestionar conciliación bancaria'),
  ('accounting.cash.view',          'accounting',   'cash.view',              'Ver caja y cierres'),
  ('accounting.cash.manage',        'accounting',   'cash.manage',            'Gestionar caja y cierres'),
  ('accounting.reports.view',       'accounting',   'reports.view',           'Ver informes contables'),
  -- Configuración
  ('settings.view',                 'settings',     'view',                   'Ver configuración del sistema'),
  ('settings.manage',               'settings',     'manage',                 'Modificar configuración'),
  ('settings.advanced',             'settings',     'advanced',               'Configuración avanzada y feature flags'),
  -- Usuarios
  ('users.view',                    'users',        'view',                   'Ver lista de usuarios'),
  ('users.manage',                  'users',        'manage',                 'Crear, editar y desactivar usuarios'),
  ('roles.view',                    'roles',        'view',                   'Ver roles y permisos'),
  ('roles.manage',                  'roles',        'manage',                 'Asignar y modificar roles'),
  -- Operaciones
  ('operations.view',               'operations',   'view',                   'Ver calendario de operaciones'),
  ('operations.calendar.manage',    'operations',   'calendar.manage',        'Gestionar eventos del calendario'),
  ('operations.activities.manage',  'operations',   'activities.manage',      'Gestionar actividades y servicios'),
  -- Restaurantes
  ('restaurants.view',              'restaurants',  'view',                   'Ver restaurantes'),
  ('restaurants.reservations.manage','restaurants', 'reservations.manage',    'Gestionar reservas de restaurante'),
  ('restaurants.manage',            'restaurants',  'manage',                 'Administrar restaurantes y turnos'),
  -- Marketing
  ('ticketing.view',                'marketing',    'ticketing.view',         'Ver cupones y tickets'),
  ('ticketing.manage',              'marketing',    'ticketing.manage',       'Gestionar cupones y tickets'),
  ('discounts.view',                'marketing',    'discounts.view',         'Ver códigos de descuento'),
  ('discounts.manage',              'marketing',    'discounts.manage',       'Gestionar códigos de descuento');
--> statement-breakpoint

-- ─── Seed: admin → todos los permisos ────────────────────────────────────────
INSERT IGNORE INTO `rbac_role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id FROM `rbac_roles` r CROSS JOIN `rbac_permissions` p
WHERE r.`key` = 'admin';
--> statement-breakpoint

-- ─── Seed: agente → CRM + TPV operativo + marketing + operaciones ─────────────
INSERT IGNORE INTO `rbac_role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id FROM `rbac_roles` r
  JOIN `rbac_permissions` p ON p.`key` IN (
    'crm.view', 'crm.leads.manage', 'crm.quotes.manage',
    'crm.reservations.manage', 'crm.payments.confirm', 'crm.invoices.view',
    'tpv.access', 'tpv.sell', 'tpv.open_close',
    'ticketing.view', 'ticketing.manage',
    'discounts.view',
    'operations.view'
  )
WHERE r.`key` = 'agente';
--> statement-breakpoint

-- ─── Seed: commercial_agent → CRM + marketing vista + operaciones (sin TPV) ──
INSERT IGNORE INTO `rbac_role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id FROM `rbac_roles` r
  JOIN `rbac_permissions` p ON p.`key` IN (
    'crm.view', 'crm.leads.manage', 'crm.quotes.manage',
    'crm.reservations.manage', 'crm.payments.confirm', 'crm.invoices.view',
    'ticketing.view',
    'discounts.view',
    'operations.view'
  )
WHERE r.`key` = 'commercial_agent';
--> statement-breakpoint

-- ─── Seed: sales_cashier → commercial_agent + TPV operativo ──────────────────
INSERT IGNORE INTO `rbac_role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id FROM `rbac_roles` r
  JOIN `rbac_permissions` p ON p.`key` IN (
    'crm.view', 'crm.leads.manage', 'crm.quotes.manage',
    'crm.reservations.manage', 'crm.payments.confirm', 'crm.invoices.view',
    'ticketing.view',
    'discounts.view',
    'operations.view',
    'tpv.access', 'tpv.sell', 'tpv.open_close'
  )
WHERE r.`key` = 'sales_cashier';
--> statement-breakpoint

-- ─── Seed: adminrest → restaurantes ──────────────────────────────────────────
INSERT IGNORE INTO `rbac_role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id FROM `rbac_roles` r
  JOIN `rbac_permissions` p ON p.`key` IN (
    'restaurants.view', 'restaurants.reservations.manage'
  )
WHERE r.`key` = 'adminrest';
--> statement-breakpoint

-- ─── Seed: monitor → operaciones lectura ──────────────────────────────────────
INSERT IGNORE INTO `rbac_role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id FROM `rbac_roles` r
  JOIN `rbac_permissions` p ON p.`key` IN (
    'operations.view', 'operations.activities.manage'
  )
WHERE r.`key` = 'monitor';

-- user: sin permisos (no INSERT)
