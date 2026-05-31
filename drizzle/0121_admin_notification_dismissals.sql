-- 0121_admin_notification_dismissals.sql
--
-- Tabla para que cada admin pueda silenciar individualmente items del
-- feed de notificaciones (campana arriba a la derecha). Es por-usuario:
-- silenciar un item afecta solo a quien lo silencia, no al resto del equipo.
--
-- kind: tipo de notificación (lead | quote | cancellation | pending_payment
--                             | tpv_alert | upcoming_reservation)
-- entity_id: id de la entidad subyacente (lead.id, quote.id, etc.).
--   Para tpv_alert agregados (no asociados a 1 entidad concreta), se usa
--   el sub-kind como entity_id sintético (ej. stale_batches=-1, etc.).
--
-- Idempotente vía script apply-admin-notification-dismissals.cjs.

CREATE TABLE IF NOT EXISTS `admin_notification_dismissals` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `user_id`        INT NOT NULL,
  `kind`           VARCHAR(40) NOT NULL,
  `entity_id`      INT NOT NULL,
  `dismissed_at`   BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_kind_entity` (`user_id`, `kind`, `entity_id`),
  KEY `idx_user_kind` (`user_id`, `kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
