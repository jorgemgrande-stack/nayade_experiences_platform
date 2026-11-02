-- Reversión de 0022_custom_roles: se pierden los roles propios y sus asignaciones; cada usuario vuelve a tener solo los
-- permisos de su rol de siempre (users.role), que nunca se modificó. Antes, desplegar el código anterior a los roles propios.
DROP TABLE IF EXISTS custom_role_users;
DROP TABLE IF EXISTS custom_role_permissions;
DROP TABLE IF EXISTS custom_roles;
