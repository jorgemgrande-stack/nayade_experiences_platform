# Borradores legales para el lanzamiento B2B de Elephant Source

> **BORRADOR. NO PUBLICAR.** Textos preparados el 20/10/2026 para revisión jurídica. Describen lo que hace hoy la plataforma (commit `8239625`). Las marcas **[REVISIÓN JURÍDICA]** y **[DECISIÓN]** señalan lo que requiere validación de un abogado o del propietario.
>
> Los textos publicados vivirán en la web (`/legal/*`, repositorio de la web). Este documento es la fuente para completarlos.

**Datos del titular** (ya presentes en `server/stripe/issuer.ts` y en el `CONTROLLER` de la web): IRON ELEPHANT CONSULTING, S.L. · NIF B26987875 · Calle Corazón de María, 57, 1.º D, 28002 Madrid · privacidad@bigelephant.es · soporte@bigelephant.es.
**Faltan:** los datos del Registro Mercantil de Madrid (tomo, folio, hoja e inscripción) **[DECISIÓN: el propietario debe facilitarlos]**.

---

## A. Condiciones generales de contratación de Elephant Source (empresas y profesionales)

### 1. Objeto y partes
1.1. Estas condiciones regulan el acceso y el uso de **Elephant Source** («el Servicio»), un software de gestión en la nube que presta IRON ELEPHANT CONSULTING, S.L. («Big Elephant») bajo la marca Big Elephant / Elephant Source.
1.2. El Servicio se contrata **exclusivamente por empresas y profesionales** («el Cliente») que actúan en el ámbito de su actividad empresarial o profesional y tienen domicilio fiscal en la **Península o las Islas Baleares**. No se contrata con consumidores. Al contratar, el Cliente declara que cumple estas condiciones y facilita un NIF válido. **[REVISIÓN JURÍDICA: exclusión de consumidores y efectos de una declaración falsa]**
1.3. Contratar requiere aceptar expresamente estas condiciones, la Política de privacidad y el Contrato de encargo del tratamiento (Anexo B). La versión aceptada y su fecha quedan registradas.

### 2. Planes y precios
2.1. **Planes disponibles:**

| Plan | Mensual | Anual |
|---|---|---|
| Essential | 29 € | 279 € |
| Business | 79 € | 759 € |

Los precios son por empresa y **no incluyen el IVA** (21 %), que se añade en la factura. Los límites de cada plan (usuarios, sedes, almacenamiento y funciones) figuran en la web en el momento de contratar y forman parte del contrato.
2.2. Los módulos adicionales no se comercializan en este momento. Su contratación futura se regirá por sus propias condiciones particulares.
2.3. Big Elephant puede cambiar los precios avisando por escrito con **30 días** de antelación. El cambio se aplica desde la siguiente renovación, y el Cliente puede cancelar antes de que entre en vigor. **[REVISIÓN JURÍDICA]**

### 3. Prueba gratuita de 15 días
3.1. El plan Essential puede probarse gratis durante **15 días** naturales, sin tarjeta y sin compromiso. Solo se admite una prueba por empresa.
3.2. Al terminar la prueba sin contratar, la cuenta pasa a **solo lectura**: puede consultarse y exportarse, pero no se crean ni se modifican datos. Los datos se conservan **30 días** desde el fin de la prueba y después se suprimen (cláusula 8).
**[DECISIÓN: la web y la FAQ actuales dicen «se suspende y hay 7 días más». El código aplica solo lectura y conserva los datos. Hay que unificar el texto con el comportamiento real.]**
3.3. Durante la prueba, el Servicio se presta «tal cual», sin los compromisos de servicio de la cláusula 6.

### 4. Duración, renovación y cancelación
4.1. La suscripción es mensual o anual, según el plan elegido, y **se renueva automáticamente** por periodos iguales salvo que el Cliente la cancele.
4.2. El Cliente puede cancelar en cualquier momento desde el portal de cliente o escribiendo a soporte. La cancelación surte efecto **al final del periodo ya pagado**. Hasta entonces, el Servicio sigue disponible. No hay permanencia mínima.
4.3. Para cambiar de plan, el Cliente lo solicita a soporte. Una subida se aplica de inmediato y se cobra en proporción al tiempo que queda del periodo. Una bajada se aplica en la siguiente renovación. **[DECISIÓN: el Portal tiene los cambios de plan desactivados en la apertura]**
4.4. Big Elephant puede resolver el contrato si el Cliente incumple gravemente estas condiciones (cláusula 7), avisándole con 15 días para subsanarlo, salvo que el incumplimiento ponga en riesgo la seguridad del Servicio o de terceros.

### 5. Pago, facturación, impago y reembolsos
5.1. El pago es por adelantado, al inicio de cada periodo, con tarjeta u otro medio admitido en la página de pago de Stripe, nuestro proveedor de pagos. Big Elephant no guarda los datos de la tarjeta.
5.2. **Facturas.** Se emiten a nombre del Cliente con los datos fiscales que facilita al contratar, y se envían por correo y quedan disponibles en el portal de cliente. El Cliente responde de que esos datos sean correctos. **[REVISIÓN DEL ASESOR FISCAL: emisor de la factura legal (Stripe Invoicing o un programa certificado), series, VERI\*FACTU]**
5.3. **Impago.** Si un cobro falla, se avisa al Cliente y se reintenta. Pasados **7 días** sin pago, la cuenta puede pasar a solo lectura hasta que se regularice. Si la deuda no se paga, se aplican la cláusula 4.4 y la conservación de la cláusula 8. **[DECISIÓN D-15]**
5.4. **Reembolsos.** Los periodos iniciados no se reembolsan, ni en todo ni en parte, salvo:
  - cobro duplicado o erróneo;
  - incumplimiento grave por parte de Big Elephant;
  - lo que exija la ley.

  Un reembolso conlleva la factura rectificativa correspondiente. **[DECISIÓN D-S3 y REVISIÓN JURÍDICA]**
5.5. Un contracargo o disputa injustificada permite suspender el Servicio mientras se resuelve.

### 6. Prestación del Servicio y soporte
6.1. Big Elephant pone los medios razonables para que el Servicio esté disponible de forma continua, salvo paradas programadas (avisadas con antelación cuando sea posible) y causas ajenas. **[DECISIÓN: no se ofrece un nivel de servicio (SLA) con compensaciones en la beta. Confirmar.]**
6.2. El soporte se presta por correo (soporte@bigelephant.es) en días laborables de Madrid.
6.3. Big Elephant hace copias de seguridad periódicas, cifradas, con restauración verificada. Son un medio de continuidad del Servicio, no un archivo del Cliente.
6.4. Big Elephant puede mejorar o modificar funciones. Si un cambio reduce de forma sustancial una función esencial del plan contratado, lo avisa con 30 días y el Cliente puede cancelar.

### 7. Obligaciones del Cliente y uso aceptable
7.1. El Cliente custodia sus credenciales y las de sus usuarios, y responde del uso que se haga con ellas.
7.2. No se permite:
  - un uso ilícito o contrario a estas condiciones;
  - introducir código malicioso;
  - intentar acceder a datos de otros clientes;
  - someter el Servicio a cargas abusivas;
  - revenderlo sin autorización.
7.3. El Cliente es el responsable de los datos que trata en el Servicio y de tener una base legal para tratarlos (Anexo B).

### 8. Datos del Cliente: propiedad, exportación y conservación
8.1. Los datos que el Cliente introduce son suyos. Big Elephant solo los trata para prestar el Servicio (Anexo B).
8.2. **Exportación.** El propietario de la cuenta puede descargar en cualquier momento, también en solo lectura, una copia completa de sus datos en un archivo ZIP en formatos abiertos (CSV y JSON), con un enlace personal válido durante 24 horas.
8.3. **Fin del contrato.** Al terminar la suscripción (o la prueba), la cuenta queda en **solo lectura durante 30 días** para que el Cliente exporte sus datos. Pasado ese plazo, Big Elephant **suprime** los datos, salvo los que deba conservar por obligación legal (por ejemplo, la facturación). Las copias de seguridad que los contengan se eliminan en su ciclo ordinario de retención (como máximo, **12 meses**). **[REVISIÓN JURÍDICA: plazos D-17 y retención de copias, 30/12/12]**

### 9. Propiedad intelectual
El software, la marca y la documentación son de Big Elephant o de sus licenciantes. El Cliente recibe un derecho de uso no exclusivo e intransferible mientras dure la suscripción.

### 10. Responsabilidad
10.1. Big Elephant responde de los daños directos que cause por incumplir estas condiciones, hasta el importe que el Cliente haya pagado en los **12 meses** anteriores al hecho.
10.2. Big Elephant no responde del lucro cesante, de la pérdida de negocio ni de los daños indirectos, salvo en caso de dolo o culpa grave.
**[REVISIÓN JURÍDICA]**

### 11. Confidencialidad
Cada parte guarda reserva de la información confidencial de la otra durante el contrato y 3 años después.

### 12. Modificación de las condiciones
Big Elephant puede modificar estas condiciones avisando con 30 días de antelación. Si el Cliente no está de acuerdo, puede cancelar antes de que entren en vigor. Los cambios rigen desde la siguiente renovación.

### 13. Ley aplicable y jurisdicción
Ley española. Para cualquier controversia, las partes se someten a los Juzgados y Tribunales de **Madrid capital**. **[REVISIÓN JURÍDICA]**

---

## B. Contrato de encargo del tratamiento (art. 28 RGPD)

**Responsable:** el Cliente. **Encargado:** IRON ELEPHANT CONSULTING, S.L. (B26987875).

1. **Objeto.** El encargado trata los datos personales que el responsable introduce en Elephant Source (por ejemplo, sus clientes, empleados, proveedores y reservas), solo para prestar el Servicio contratado: alojamiento, operación, copias de seguridad, soporte y envío de comunicaciones que el responsable dispare desde la aplicación.
2. **Duración.** La del contrato, más el plazo de conservación de la cláusula A.8.3.
3. **Instrucciones.** El encargado trata los datos solo siguiendo instrucciones documentadas del responsable, incluidas estas condiciones y el uso que el responsable haga de la aplicación. Si una instrucción le parece contraria a la normativa, lo comunica de inmediato.
4. **Confidencialidad.** Las personas autorizadas a tratar los datos tienen deber de confidencialidad. El acceso de soporte a la cuenta del responsable es delegado, temporal y queda registrado.
5. **Seguridad (art. 32 RGPD).** Entre otras medidas:
   - base de datos separada por empresa;
   - cifrado en tránsito (TLS);
   - copias cifradas (AES-256-GCM) con restauración verificada;
   - control de acceso por roles y verificación en dos pasos para los operadores;
   - registro de auditoría;
   - límites de envío de correo.
6. **Subencargados.** El responsable autoriza de forma general a estos subencargados. Los cambios se avisan con 15 días y el responsable puede oponerse con causa justificada.

   | Subencargado | Función | Ubicación | Garantía |
   |---|---|---|---|
   | Railway Corp. | Alojamiento y bases de datos | [región por confirmar] | **[REVISIÓN JURÍDICA: transferencia internacional y cláusulas tipo / DPF]** |
   | Proveedor de almacenamiento de copias | Almacenamiento de las copias de seguridad | [por confirmar] | [por confirmar] |
   | Sendinblue SAS (Brevo) | Correo transaccional | UE | — |
   | Stripe Payments Europe, Ltd. | Pagos (solo los datos de facturación del responsable) | UE e Irlanda | — |

7. **Derechos de los interesados.** El encargado ayuda al responsable a atenderlos con las funciones de la aplicación (consulta, rectificación, exportación y supresión) y le reenvía cualquier solicitud que reciba.
8. **Brechas de seguridad.** El encargado notifica al responsable sin dilación indebida, y como máximo en **48 horas** desde que tenga constancia, con la información disponible.
9. **Fin del encargo.** Se aplica la cláusula A.8.3: exportación durante 30 días y supresión posterior, con certificado de supresión a petición del responsable.
10. **Auditoría.** El encargado pone a disposición del responsable la información necesaria para demostrar el cumplimiento y permite auditorías razonables, con preaviso y a cargo del responsable.

**[REVISIÓN JURÍDICA: el anexo completo, la lista de subencargados y la región de Railway y del almacenamiento de copias]**

---

## C. Huecos de los textos existentes en la web

| Página (repositorio de la web) | Qué completar |
|---|---|
| `aviso-legal.astro` | IRON ELEPHANT CONSULTING, S.L., NIF B26987875, domicilio, correo, **datos del Registro Mercantil [DECISIÓN]**, propiedad intelectual y responsabilidad |
| `privacidad.astro` | Responsable (los mismos datos) y finalidades: formularios, prueba, contratación, facturación y soporte. Bases legales: contrato, obligación legal e interés legítimo. Plazos: duración del contrato y luego los legales (facturación, 6 años). Destinatarios: los subencargados del Anexo B y la Agencia Tributaria. Derechos y reclamación ante la AEPD |
| `cookies.astro` | Inventario de cookies técnicas: sesión de operador (`Path=/cp/v1`, `SameSite=Strict`), sesión de empresa (`__Host-`) y cookies de Stripe en su página de pago. Sin analítica, así que sin banner de consentimiento **[REVISIÓN JURÍDICA]** |
| `prueba-y-datos.astro` y FAQ | Alinear con la cláusula A.3: solo lectura y 30 días de conservación |
| `cancelacion.astro` y `contratacion.astro` | Sustituir los [PENDIENTE] por las cláusulas A.4, A.5 y A.8 |
| Precios en la web | Mostrar «IVA no incluido» junto a cada precio |

**Publicación técnica:**
- El CRM solo admite 4 claves legales (`server/web/service.ts`). La web lee además `legal-aviso-legal`, `legal-contratacion` y `legal-cancelacion`, y el pie del catálogo sembrado no las enlaza.
- Para la apertura basta con publicarlas desde el repositorio de la web.
- Después, fijar `CP_TERMS_VERSION`, `CP_PRIVACY_VERSION`, `CP_TERMS_URL` y `CP_PRIVACY_URL` (ver `LANZAMIENTO_COMERCIAL.md`).
