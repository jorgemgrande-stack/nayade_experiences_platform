INSERT IGNORE INTO `feature_flags` (`key`, `name`, `description`, `module`, `enabled`, `default_enabled`, `risk_level`) VALUES
  ('abandoned_checkout_cleanup_enabled', 'Limpieza checkouts abandonados',
   'Ejecuta el job que cancela reservas con pago pendiente sin completar y genera leads de Venta Perdida',
   'general', true, true, 'medium'),
  ('installment_overdue_job_enabled', 'Job cuotas de pago fraccionado',
   'Marca cuotas vencidas y envía recordatorios automáticos por email a clientes con cuotas próximas a vencer',
   'general', true, true, 'low');
