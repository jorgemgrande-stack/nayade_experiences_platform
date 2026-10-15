-- Reversión de 0003_crm_web_requests (se pierden las solicitudes web; los leads se conservan).
DROP TABLE IF EXISTS crm_lead_requests;
