-- Activación voluntaria del acceso (p. ej. Módulo 1 incluido en los retiros: el alumno decide cuándo empiezan sus 30 días). Aditiva.
--
-- learning_access_rules.activation_required: la regla concede un derecho PENDIENTE DE ACTIVAR (sin ventana de fechas) y su
--   duración (duration_days) se cuenta desde que el alumno lo activa. 0 = como hasta ahora.
-- learning_enrollments.pending_activation_days: días de acceso que arrancarán al activar; NULL = matrícula normal o ya activada.
-- learning_enrollments.activated_at: cuándo activó el alumno (el inicio exacto de su ventana).
-- No se rellena ningún dato. Nunca se ejecuta al arrancar.

ALTER TABLE learning_access_rules ADD COLUMN activation_required TINYINT NOT NULL DEFAULT 0;
ALTER TABLE learning_enrollments ADD COLUMN pending_activation_days INT NULL;
ALTER TABLE learning_enrollments ADD COLUMN activated_at BIGINT NULL;
