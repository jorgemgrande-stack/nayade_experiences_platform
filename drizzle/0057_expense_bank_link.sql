-- Extend expenses.status enum to add 'conciliado' (linked to bank movement)
ALTER TABLE `expenses` MODIFY COLUMN `status` enum('pending','justified','accounted','conciliado') NOT NULL DEFAULT 'pending';
