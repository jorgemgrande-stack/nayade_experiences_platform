# Pasarela de acceso restringido (Caddy) para los servicios de Elephant Source en Railway.
FROM caddy:2.8.4-alpine
COPY deploy/railway/gateway/Caddyfile /etc/caddy/Caddyfile
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
