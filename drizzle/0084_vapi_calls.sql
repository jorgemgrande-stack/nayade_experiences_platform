-- Módulo Agente IA Vapi — llamadas del asistente de voz
-- Migración segura e idempotente

CREATE TABLE IF NOT EXISTS vapi_calls (
  id int AUTO_INCREMENT PRIMARY KEY,
  vapiCallId varchar(128) NOT NULL,
  assistantId varchar(128) NULL,
  phoneNumber varchar(32) NULL,
  customerName varchar(255) NULL,
  customerEmail varchar(320) NULL,
  startedAt timestamp NULL,
  endedAt timestamp NULL,
  durationSeconds int NULL,
  status varchar(64) NULL,
  endedReason varchar(128) NULL,
  recordingUrl text NULL,
  transcript mediumtext NULL,
  summary text NULL,
  structuredData json NULL,
  rawPayload json NULL,
  linkedLeadId int NULL,
  linkedBudgetId int NULL,
  linkedReservationId int NULL,
  reviewed boolean NOT NULL DEFAULT false,
  createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vapi_call_id (vapiCallId),
  INDEX idx_vapi_call_startedAt (startedAt),
  INDEX idx_vapi_call_status (status),
  INDEX idx_vapi_call_reviewed (reviewed),
  INDEX idx_vapi_call_leadId (linkedLeadId)
);
