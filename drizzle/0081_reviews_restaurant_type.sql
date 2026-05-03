-- Ampliar el enum entityType de reviews para incluir restaurantes
ALTER TABLE `reviews`
  MODIFY COLUMN `entityType`
    enum('hotel','spa','experience','pack','restaurant') NOT NULL;
