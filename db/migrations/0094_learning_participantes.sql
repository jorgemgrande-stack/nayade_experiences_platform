-- Participantes de una reserva de retiro (varias plazas en un mismo presupuesto pagado). Aditiva.
--
-- quote_participants: cada persona identificada de una reserva (además de quien la hizo). Cada una recibe su PROPIO derecho de
--   acceso (una matrícula por persona, con su activación voluntaria). Las plazas las limita la reserva (leads.numberOfPersons).
--   Una persona retirada queda registrada (status removed), no se borra.
-- No se rellena ningún dato. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS quote_participants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  quote_id INT NOT NULL,
  name VARCHAR(190) NOT NULL,
  email VARCHAR(190) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'active',
  created_by INT NULL,
  created_at BIGINT NOT NULL,
  removed_at BIGINT NULL,
  removed_reason VARCHAR(255) NULL,
  UNIQUE KEY uq_quote_participant (quote_id, email)
);
