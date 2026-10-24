-- Reversión de 0024_crm_task_assignment: se pierden el responsable y la prioridad de las tareas (no las tareas).
-- Antes, desplegar el código anterior a las tareas con responsable.
ALTER TABLE crm_activities
  DROP KEY idx_activity_assignee,
  DROP COLUMN priority,
  DROP COLUMN assignee;
