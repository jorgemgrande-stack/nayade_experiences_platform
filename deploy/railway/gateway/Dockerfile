# Pasarela de acceso restringido (Caddy) para los servicios de Elephant Source en Railway.
FROM caddy:2.8.4-alpine
COPY deploy/railway/gateway/Caddyfile /etc/caddy/Caddyfile
# Entrada de las empresas clientes (solo se sirve en APP_ENTRY_HOST)
COPY deploy/railway/gateway/app-entry /srv/app-entry
# {$APP_ENTRY_HOST:…} y {$PUBLIC_HOSTS:…} del Caddyfile solo usan el valor por defecto si la variable NO existe: definida y vacía,
# Caddy no arranca («module value cannot be null»). Se fija aquí también para el caso vacío.
CMD ["sh", "-c", "export APP_ENTRY_HOST=\"${APP_ENTRY_HOST:-app-entry.invalid}\" PUBLIC_HOSTS=\"${PUBLIC_HOSTS:-public-hosts.invalid}\"; exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"]
