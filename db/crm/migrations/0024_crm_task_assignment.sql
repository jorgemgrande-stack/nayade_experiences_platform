-- Big Elephant — Tareas comerciales con responsable y prioridad (aditiva, base del CRM).
--
-- `assignee`: responsable de la tarea (nombre del operador, como `owner` en el resto del CRM); NULL = sin asignar.
-- `priority`: baja, normal (por defecto) o alta. Solo tiene sentido en las actividades de tipo tarea.
-- El código anterior no escribe estas columnas: las filas que cree siguen siendo «sin asignar» y «normal».

ALTER TABLE crm_activities
  ADD COLUMN assignee VARCHAR(100) NULL,
  ADD COLUMN priority ENUM('low','normal','high') NOT NULL DEFAULT 'normal',
  ADD KEY idx_activity_assignee (kind, assignee, done_at);
