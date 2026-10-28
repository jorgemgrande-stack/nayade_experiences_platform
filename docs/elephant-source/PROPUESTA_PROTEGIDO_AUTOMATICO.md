# Propuesta: el CI solicita solo el despliegue protegido de production

Estado: **preparada, sin aplicar**. Claude Code no puede editar los flujos de GitHub Actions: el control de seguridad lo clasifica como «CI Bypass». Para aplicarla hace falta una de estas dos cosas:
- que el propietario la aplique él mismo;
- o que autorice expresamente a Claude Code a editar `.github/workflows/ci.yml` y `.github/workflows/deploy-elephant-source.yml` para este cambio.

## Problema

Cuando un commit trae un cambio extraordinario, por ejemplo `server/stripe/liveReadiness.ts` en #391:
1. La publicación ordinaria de production se lo salta y deja un aviso.
2. Hay que lanzar a mano «Despliegue Elephant Source» con `desplegar-controlplane` y aprobarlo.

El 27/10/2026 eso retrasó horas la activación de Stripe Live.

## Cambio propuesto (no quita ninguna protección)

1. **`deploy-elephant-source.yml`: nueva acción `publicar-aprobado`, solo para production.**
   - No figura en la lista de acciones ordinarias, así que usa el entorno `elephant-source-production`, que exige la aprobación del propietario en GitHub.
   - Hace lo mismo que `publicar`: comprueba que el commit superó el CI y live y tiene vuelta atrás automática.
   - Diferencia: con un cambio extraordinario (código de salida 5) continúa, porque la aprobación humana ya se ha dado.
   - Excepción: si el cambio extraordinario incluye **migraciones no aditivas**, falla y remite a `preparar-production` / `aplicar-production`.
2. **Salida `protegido`.** El job `run` la expone y `workflow_call` la publica: vale `1` cuando la publicación automática se saltó el Core, el CRM o la web por ser extraordinarios.
3. **`ci.yml`: job `publicar-production-aprobacion`.**
   - Se ejecuta con `needs: [publicar-production]` e `if: needs.publicar-production.outputs.protegido == '1'`.
   - Llama a `deploy-elephant-source.yml` con `environment: production`, `action: publicar-aprobado` y `confirm: production`.
   - GitHub deja la ejecución en «Waiting for review» y avisa al propietario, que solo tiene que pulsar «Approve and deploy».

```yaml
# ci.yml (después de publicar-production)
  publicar-production-aprobacion:
    name: Publicar en production (con aprobación)
    needs: [publicar-production]
    if: needs.publicar-production.outputs.protegido == '1'
    permissions:
      contents: read
      checks: read
      statuses: write
    uses: ./.github/workflows/deploy-elephant-source.yml
    with:
      environment: production
      action: publicar-aprobado
      confirm: production
    secrets: inherit
```

En `deploy-elephant-source.yml`:
- añadir `publicar-aprobado` a las opciones;
- añadir `outputs: { protegido: … }` en `workflow_call` y en el job `run`;
- en los tres bloques `RC = 5` (Core, CRM y web), escribir `protegido=1` en `$GITHUB_OUTPUT` cuando `ES_AUTO=true` y continuar cuando `ES_ACTION=publicar-aprobado`;
- en los pasos con `inputs.action == 'publicar'`, aceptar también `publicar-aprobado`.

## Qué no cambia

- La aprobación del propietario en `elephant-source-production` sigue siendo obligatoria.
- Las migraciones no aditivas, los interruptores, las variables y los secretos siguen por sus acciones protegidas.
- Lo ordinario se sigue publicando solo.
- Mientras una aprobación está pendiente, las publicaciones posteriores de production esperan en la misma cola de concurrencia. Llevarían el mismo cambio extraordinario, así que también se lo saltarían.
