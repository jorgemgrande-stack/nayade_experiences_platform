-- Módulo WhatsApp GHL Inbox — tablas de conversaciones, mensajes y auditoría de webhooks
-- Migración segura e idempotente — no modifica tablas existentes

CREATE TABLE IF NOT EXISTS ghl_conversations (
  id int AUTO_INCREMENT PRIMARY KEY,
  ghlConversationId varchar(64) NOT NULL,
  ghlContactId varchar(64),
  locationId varchar(64),
  channel varchar(32) NOT NULL DEFAULT 'whatsapp',
  customerName varchar(255),
  phone varchar(32),
  email varchar(320),
  lastMessagePreview text,
  lastMessageAt timestamp NULL,
  unreadCount int NOT NULL DEFAULT 0,
  inbox varchar(64),
  starred boolean NOT NULL DEFAULT false,
  status enum('new','open','pending','replied','closed') NOT NULL DEFAULT 'new',
  assignedUserId int NULL,
  linkedQuoteId int NULL,
  linkedReservationId int NULL,
  createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ghl_conv_id (ghlConversationId),
  INDEX idx_ghl_conv_status (status),
  INDEX idx_ghl_conv_lastMsg (lastMessageAt),
  INDEX idx_ghl_conv_contact (ghlContactId)
);

CREATE TABLE IF NOT EXISTS ghl_messages (
  id int AUTO_INCREMENT PRIMARY KEY,
  ghlMessageId varchar(64) NOT NULL,
  ghlConversationId varchar(64) NOT NULL,
  direction enum('inbound','outbound') NOT NULL DEFAULT 'inbound',
  messageType varchar(32) DEFAULT 'text',
  body text,
  attachmentsJson json,
  senderName varchar(255),
  sentAt timestamp NULL,
  deliveryStatus varchar(32),
  rawPayloadJson json,
  createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ghl_msg_id (ghlMessageId),
  INDEX idx_ghl_msg_conv (ghlConversationId),
  INDEX idx_ghl_msg_sentAt (sentAt)
);

CREATE TABLE IF NOT EXISTS ghl_webhook_events (
  id int AUTO_INCREMENT PRIMARY KEY,
  eventId varchar(128) NULL,
  eventType varchar(128) NOT NULL,
  ghlConversationId varchar(64),
  ghlContactId varchar(64),
  locationId varchar(64),
  rawPayloadJson json,
  processedStatus enum('pending','processed','failed','ignored') NOT NULL DEFAULT 'pending',
  errorMessage text,
  receivedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processedAt timestamp NULL,
  UNIQUE KEY uq_ghl_event_id (eventId),
  INDEX idx_ghl_evt_conv (ghlConversationId),
  INDEX idx_ghl_evt_status (processedStatus),
  INDEX idx_ghl_evt_received (receivedAt)
);
