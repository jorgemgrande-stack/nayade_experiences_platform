-- Añadir columna JSON para overrides operativos por actividad interna de una reserva
-- Nullable: no afecta registros existentes ni flujos actuales
-- Estructura: [{ index: 0, monitorId: 5, arrivalTime: "10:30", opNotes: "..." }]
ALTER TABLE `reservation_operational` ADD `activities_op_json` json;
