# Controles de secretos y ficheros sensibles

Tres capas evitan que entren en el repositorio credenciales, claves, volcados de bases de datos o exportaciones de herramientas:

| Capa | Dónde | Bloquea |
|---|---|---|
| Reglas de exclusión | `.gitignore` | Que esos ficheros aparezcan como candidatos a commit |
| Gancho `pre-commit` | `.githooks/pre-commit` (local) | El commit, antes de crearse |
| CI | Trabajo «Secretos y ficheros sensibles (bloqueante)» de `.github/workflows/ci.yml` | La fusión del PR |

## Qué se considera sensible

Está definido en `scripts/ci/sensitive-files.mjs` (`SENSITIVE_PATTERNS`):
- `.manus/` y `.manus-logs/`;
- resultados de consultas (`db-query-*.json`);
- `.env*`, salvo las plantillas;
- claves y almacenes (`*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`…);
- ficheros de credenciales (`.netrc`, `.pgpass`, `credentials.json`, `service-account*.json`);
- bases de datos y volcados (`*.sqlite`, `*.db`, `*.dump`, `*.bak`, `*.sql.gz`, `dump*.sql`…).

**No** se bloquean las migraciones (`db/**/migrations/*.sql`), la baseline ni las plantillas `env.example.txt` / `.env.example`.

## Activar el gancho local (una vez por clon)

```bash
git config core.hooksPath .githooks
```

- El gancho comprueba los **nombres** de lo preparado para commit.
- Si `gitleaks` está instalado, también escanea su **contenido**.
- `git commit --no-verify` lo salta, pero el CI aplica el mismo control y es bloqueante.

## Qué hace el CI

1. **Árbol completo:** ningún fichero versionado coincide con los patrones.
2. **Commits nuevos** del PR (o del push a `main`): ninguno **añade o modifica** una ruta sensible. Detecta también historia antigua que vuelva a entrar por una fusión. Borrar una ruta sensible está permitido.
3. **gitleaks 8.21.2**, con la suma SHA-256 verificada, sobre esos commits nuevos y con `.gitleaks.toml`. Los valores aparecen ocultos en los registros.
4. Las pruebas de los propios controles: `server/sensitiveFiles.test.ts`.

## Falsos positivos

- **Valor ficticio en una prueba:** añadir el comentario `gitleaks:allow` en esa línea.
- **Ruta legítima que coincide con un patrón:** añadir una excepción explícita en `ALLOWED` de `scripts/ci/sensitive-files.mjs`, con revisión en el PR.

## Si se detecta un secreto real

1. **No** basta con borrarlo en un commit nuevo: queda en el historial.
2. Rotar o revocar la credencial en su servicio **primero**.
3. Después, valorar la limpieza del historial con el responsable del repositorio.
