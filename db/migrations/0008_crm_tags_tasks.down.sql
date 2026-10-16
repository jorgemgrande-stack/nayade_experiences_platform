-- Reversión de 0008_crm_tags_tasks: se pierden las etiquetas, sus asignaciones y las tareas internas
-- del CRM. Retirar antes el código que las usa (routers crmTags y crmTasks).
DROP TABLE IF EXISTS crm_tasks;
DROP TABLE IF EXISTS crm_tag_links;
DROP TABLE IF EXISTS crm_tags;
