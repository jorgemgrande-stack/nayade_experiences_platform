-- Gestoría e Impuestos — Fase 0: cimientos de datos del IVA soportado.
--
-- Amplía la tabla `expenses` con el desglose fiscal necesario para poder
-- liquidar el Modelo 303 (IVA soportado deducible) y el Modelo 111
-- (retenciones a profesionales/arrendadores).
--
--   taxBase / taxRate / taxAmount  → desglose de la base imponible y la cuota.
--                                    El `amount` del gasto es el TOTAL con IVA;
--                                    base = amount / (1 + taxRate/100).
--   deductiblePercent              → % de IVA deducible (vehículos, atenciones…).
--   supplierNif / supplierName     → identificación fiscal del proveedor (snapshot).
--   retentionPercent / retentionAmount → retención de IRPF practicada.
--   invoiceType                    → naturaleza de la factura recibida.
--   accrualDate                    → fecha de devengo (independiente de la de pago).
--   fiscalReviewStatus             → 'pendiente' hasta que el desglose se verifica.
--
-- Migración idempotente: ver scripts/apply-tax-fase0.cjs (añade solo lo que falta).

ALTER TABLE `expenses`
  ADD COLUMN `taxBase`            DECIMAL(12,2) NULL,
  ADD COLUMN `taxRate`            DECIMAL(5,2)  NOT NULL DEFAULT 21.00,
  ADD COLUMN `taxAmount`          DECIMAL(12,2) NULL,
  ADD COLUMN `deductiblePercent`  DECIMAL(5,2)  NOT NULL DEFAULT 100.00,
  ADD COLUMN `supplierNif`        VARCHAR(32)   NULL,
  ADD COLUMN `supplierName`       VARCHAR(256)  NULL,
  ADD COLUMN `retentionPercent`   DECIMAL(5,2)  NULL,
  ADD COLUMN `retentionAmount`    DECIMAL(12,2) NULL,
  ADD COLUMN `invoiceType`        ENUM('ordinaria','simplificada','intracomunitaria','importacion','exenta','sin_factura') NOT NULL DEFAULT 'ordinaria',
  ADD COLUMN `accrualDate`        VARCHAR(10)   NULL,
  ADD COLUMN `fiscalReviewStatus` ENUM('pendiente','revisado') NOT NULL DEFAULT 'pendiente';
