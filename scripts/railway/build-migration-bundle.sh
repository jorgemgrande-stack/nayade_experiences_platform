#!/usr/bin/env bash
# Paquete de migraciones reproducible a partir de un commit EXACTO del Core (registro y CRM).
#
#   scripts/railway/build-migration-bundle.sh <commit> <carpeta-de-salida>
#
# Exporta el commit con `git archive` (nunca el árbol de trabajo), empaqueta con esbuild los ejecutores
# auditados (scripts/db/migrate.ts y scripts/registry-migrate.ts) junto a las migraciones de ese commit y el
# lanzador (scripts/railway/migration-runner.cjs), y deja <salida>/migrations-<commit>.tgz con su SHA-256.
# El paquete se sube al contenedor del plano de control y se ejecuta allí (ver DESPLIEGUE_LIVE.md). No aplica
# nada por sí mismo.
set -euo pipefail
commit="${1:?Uso: build-migration-bundle.sh <commit> <carpeta-de-salida>}"
out="${2:?Falta la carpeta de salida}"
repo="$(git rev-parse --show-toplevel)"
sha="$(git -C "$repo" rev-parse --short "$commit")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git -C "$repo" archive "$sha" | tar -x -C "$work/"
mkdir -p "$work/.mig/scripts" "$work/.mig/db/crm" "$out"
( cd "$repo" && npx esbuild "$work/scripts/db/migrate.ts" --bundle --platform=node --packages=external --format=esm --outfile="$work/.mig/scripts/migrate.mjs" --log-level=error )
( cd "$repo" && npx esbuild "$work/scripts/registry-migrate.ts" --bundle --platform=node --packages=external --format=esm --outfile="$work/.mig/scripts/registry-migrate.mjs" --log-level=error )
cp -r "$work/db/crm/migrations" "$work/.mig/db/crm/"
cp -r "$work/db/registry" "$work/.mig/db/"
cp "$work/scripts/railway/migration-runner.cjs" "$work/.mig/run.cjs"
( cd "$out" && tar -czf "migrations-$sha.tgz" -C "$work/.mig" . )
echo "commit: $sha"
echo "crm: $(ls "$work/.mig/db/crm/migrations" | grep -cE '^[0-9]{4}_[a-z0-9_]+\.sql$') migraciones (última: $(ls "$work/.mig/db/crm/migrations" | grep -E '^[0-9]{4}_[a-z0-9_]+\.sql$' | tail -1))"
echo "registro: última $(ls "$work/.mig/db/registry" | grep -E '^[0-9]{4}_' | tail -1)"
( cd "$out" && sha256sum "migrations-$sha.tgz" )
