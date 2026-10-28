# Procedimiento operativo: Railway como centro de despliegue

Decisión del propietario (28/10/2026): Railway vuelve a ser el centro principal de despliegue y operaciones. GitHub queda
como repositorio y CI auxiliar.

## Live (desde el 28/10/2026)

| Servicio | Configuración | Health check |
|---|---|---|
| `controlplane` | `/deploy/railway/controlplane.json` | `/healthz` |
| `core` | `/deploy/railway/core.json` | `/healthz` |
| `core-gateway` | `/deploy/railway/gateway.json` | `/__gateway/health` |

Los tres servicios están conectados a `jorgemgrande-stack/nayade_experiences_platform`, rama
`integration/elephant-source`, con «Wait for CI».

1. Se fusiona en `integration/elephant-source`.
2. El CI (`ci.yml`) ejecuta las suites y el control de secretos. **Ya no despliega.**
3. Con el CI en verde, Railway compila y despliega los tres servicios en nativo. Cada servicio publica su estado en el
   commit (`Elephant Source - <servicio>`) y en el despliegue de GitHub `Elephant Source / live`.
4. Cuando Railway termina, `publicacion.yml` (evento `deployment_status`) comprueba que los tres servicios terminaron bien
   con el último commit de la rama y lanza la publicación en la rama:
   - **live:** migraciones nuevas de live, con copia previa; comprobaciones funcionales; CRM y web; marca
     `elephant-source/live`;
   - **production ordinario:** solo lo superado en live, con las mismas barreras de siempre.

   En live, lo nuevo se mide contra lo que servía antes del commit (`active-sha --before`). Como Railway ya ha publicado el
   código, las migraciones nuevas de live se aplican después del código. Es aceptable en live; en production, no.

Tras fusionar solo en el CRM o en la web: `gh workflow run ci.yml --ref integration/elephant-source`. El job `publicar`
del CI llama a `publicacion.yml`.

Volver atrás en live: Railway → servicio → Deployments → «Rollback» sobre el despliegue anterior, o
`esRailway.ts rollback-recorded`.

## Production

Sin cambios por ahora. Se publica con `railway up` desde `deploy-elephant-source.yml` tras superar live. El paso
siguiente es la rama `release/production` conectada en nativo, con las migraciones aditivas antes del código.

## Tiempos medidos

| Tramo | Antes (CI + `railway up`) | Railway nativo |
|---|---|---|
| Despliegue nativo de los tres servicios en live (28/10, `eda57a49`) | — | controlplane 21:52:37 → core-gateway 21:57:45: unos 5 min |
