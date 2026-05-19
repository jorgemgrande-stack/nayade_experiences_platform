-- Fix duplicados en card_terminal_operations causados por el cambio de fórmula
-- de duplicate_key en emailTpvIngestionService.ts.
--
-- Causa del problema:
--   La fórmula anterior incluía commerce_code + terminal_code + operation_number
--   + amount + datetime_HH:MM. Cuando una misma operación llegaba por dos emails
--   (ticket individual con hora precisa + resumen diario sin hora exacta), las
--   dos versiones generaban duplicate_key distintos y la UNIQUE no las bloqueaba.
--
-- Fórmula nueva (en código): terminal_code + operation_number — son los únicos
-- campos estables entre las dos fuentes.
--
-- Esta migración:
--   1. Reasigna las referencias en card_terminal_batch_operations al ganador
--      de cada grupo de duplicados (el que tiene fecha+hora precisa, no 00:00).
--   2. Borra las filas perdedoras de card_terminal_operations.
--   3. Recalcula todos los duplicate_key existentes con la nueva fórmula.

-- ── 1. Reasignar referencias en card_terminal_batch_operations ──────────────
UPDATE card_terminal_batch_operations bo
JOIN card_terminal_operations o ON o.id = bo.card_terminal_operation_id
JOIN (
  SELECT
    operation_number,
    SUBSTRING_INDEX(
      GROUP_CONCAT(
        id ORDER BY
          CASE WHEN TIME(operation_datetime) = '00:00:00' THEN 1 ELSE 0 END ASC,
          id ASC
      ),
      ',', 1
    ) AS winner_id
  FROM card_terminal_operations
  GROUP BY operation_number
  HAVING COUNT(*) > 1
) w ON w.operation_number = o.operation_number
SET bo.card_terminal_operation_id = w.winner_id
WHERE bo.card_terminal_operation_id <> w.winner_id;
--> statement-breakpoint

-- ── 2. Borrar filas perdedoras de card_terminal_operations ──────────────────
DELETE o FROM card_terminal_operations o
JOIN (
  SELECT
    operation_number,
    SUBSTRING_INDEX(
      GROUP_CONCAT(
        id ORDER BY
          CASE WHEN TIME(operation_datetime) = '00:00:00' THEN 1 ELSE 0 END ASC,
          id ASC
      ),
      ',', 1
    ) AS winner_id
  FROM card_terminal_operations
  GROUP BY operation_number
  HAVING COUNT(*) > 1
) w ON w.operation_number = o.operation_number
WHERE o.id <> w.winner_id;
--> statement-breakpoint

-- ── 3. Recalcular duplicate_key con la nueva fórmula ────────────────────────
-- Después de pasos 1+2 ya no hay duplicados, así que el UNIQUE no se rompe.
UPDATE card_terminal_operations
SET duplicate_key = CONCAT(
  UPPER(COALESCE(terminal_code, '')),
  '|',
  UPPER(operation_number)
);
