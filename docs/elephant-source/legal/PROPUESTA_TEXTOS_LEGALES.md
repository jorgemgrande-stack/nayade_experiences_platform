# Textos legales de Elephant Source: versión final propuesta

> **PROPUESTA FINAL PARA APROBACIÓN JURÍDICA. NO PUBLICAR.** Preparada el 21/10/2026 a partir de los borradores del PR #186, actualizada con el comportamiento real de la plataforma desplegada en `live` (`aa79d4b`).
>
> Marcas:
> - **[CONFIRMADO]**: dato comprobado en el sistema o en registros públicos;
> - **[APROBACIÓN JURÍDICA]**: redacción o decisión que debe validar un abogado;
> - **[DATO DEL PROPIETARIO]**: dato que solo puede aportar el propietario;
> - **[ASESOR FISCAL]**: depende de `PROPUESTA_DECISIONES_FISCALES.md`.
>
> Publicación: estos textos se publican en la web (`/legal/*`). Después se fijan `CP_TERMS_VERSION`, `CP_TERMS_URL`, `CP_PRIVACY_VERSION`, `CP_PRIVACY_URL` y, para particulares, `CP_PRECONTRACT_VERSION` y `CP_CONSUMER_WITHDRAWAL`. Las URL se añaden también al Customer Portal de Stripe.

## 0. Datos del titular y del servicio

| Dato | Valor | Estado |
|---|---|---|
| Titular | IRON ELEPHANT CONSULTING, S.L. | [CONFIRMADO] |
| NIF | B26987875 | [CONFIRMADO] |
| Domicilio | Calle Corazón de María, 57, 1.º D, 28002 Madrid | [CONFIRMADO] (sede en Stripe Tax) |
| Correos | soporte@bigelephant.es · privacidad@bigelephant.es | [CONFIRMADO] en la configuración; **buzones a verificar por el propietario** |
| Registro Mercantil (tomo, folio, hoja, inscripción) | — | **[DATO DEL PROPIETARIO]** |
| NIF-IVA intracomunitario | No figura en VIES (no está en el ROI) | [CONFIRMADO] el 21/10/2026: las empresas de la UE no se abren hasta el alta |
| Precios | Essential 29 €/mes y 279 €/año; Business 79 €/mes y 759 €/año; sin impuestos | [CONFIRMADO] en Stripe Live |
| Prueba gratuita | 15 días, sin tarjeta, una por empresa; al terminar, solo lectura | [CONFIRMADO] en el código |
| Conservación tras el fin | 30 días en solo lectura con exportación; después, supresión | [CONFIRMADO] en el código; plazo **[APROBACIÓN JURÍDICA]** |
| Exportación | ZIP con CSV y JSON; enlace personal válido 24 horas | [CONFIRMADO] |
| Cancelación | Desde el portal de cliente, efectiva al final del periodo pagado | [CONFIRMADO] en el Customer Portal |
| Cambio de plan | Desde el portal de cliente: subida inmediata con prorrateo facturado; bajada y paso a mensual al final del periodo | [CONFIRMADO] en el Customer Portal (21/10/2026) |
| Impago | Reintentos de Stripe; 7 días de gracia y después suspensión, sin borrar datos | [CONFIRMADO] en el código; **[APROBACIÓN JURÍDICA]** |
| Desistimiento de particulares | Botón en la cuenta, justificante con fecha y hora, revisión por el equipo; **sin reembolso automático** | [CONFIRMADO] en el código |
| Alojamiento | Railway Corp., **región `us-west2` (Estados Unidos)**, incluida la base de datos | [CONFIRMADO] el 21/10/2026. **Ver nota de transferencia** |
| Copias de seguridad | Cifradas (AES-256-GCM), cada 15 minutos, restauración verificada; almacenamiento de objetos compatible con S3 | Cifrado [CONFIRMADO]; proveedor y región del almacén **[DATO DEL PROPIETARIO]** |
| Pagos | Stripe Payments Europe, Ltd. (Irlanda) | [CONFIRMADO] |
| Correo transaccional | Postmark (ActiveCampaign, LLC, EE. UU.) **si se activa**; hoy no se envía correo | Propuesto; **[APROBACIÓN JURÍDICA]** de la transferencia |

**Nota de transferencia internacional [APROBACIÓN JURÍDICA]:** con la región actual, los datos de los clientes y de sus propios clientes se alojan en EE. UU. Hay dos opciones:
- **(a, recomendada)** trasladar `live` a la región europea de Railway antes de la primera venta. Hoy no hay ninguna empresa en `live`, así que es el momento de menor coste.
- **(b)** mantener EE. UU. y declararlo, con la base de transferencia aplicable: adhesión del proveedor al Marco de Privacidad de Datos UE-EE. UU., si consta, o cláusulas contractuales tipo.

Los textos siguientes están redactados para la opción (a), con la alternativa (b) indicada.

---

## 1. Condiciones generales de contratación (empresas y profesionales)

**Versión propuesta: `B2B-2026-11-01`**

### 1. Partes y objeto
1.1. Estas condiciones regulan la contratación de **Elephant Source** («el Servicio»), un software de gestión en la nube que presta IRON ELEPHANT CONSULTING, S.L. (NIF B26987875, Calle Corazón de María, 57, 1.º D, 28002 Madrid; inscrita en el Registro Mercantil de Madrid, [DATO DEL PROPIETARIO]) («Big Elephant»).
1.2. Se aplican a quien contrata como **empresa o profesional**, en el ámbito de su actividad («el Cliente»), con domicilio en un territorio en el que la contratación esté habilitada. Al contratar, el Cliente declara esa condición y facilita su identificador fiscal. Si la declaración es falsa, el Cliente responde de las consecuencias fiscales y Big Elephant puede resolver el contrato. **[APROBACIÓN JURÍDICA]**
1.3. Para contratar, el Cliente acepta expresamente estas condiciones, las Condiciones del servicio SaaS (documento 2), la Política de privacidad (documento 3) y el Contrato de encargo del tratamiento (anexo del documento 2). Big Elephant registra la versión aceptada, la fecha y el origen de la aceptación.

### 2. Planes, precios e impuestos
2.1. Planes y precios por empresa, **impuestos no incluidos**:

| Plan | Mensual | Anual |
|---|---|---|
| Essential | 29 € | 279 € |
| Business | 79 € | 759 € |

2.2. A los precios se añade el impuesto que corresponda al territorio del Cliente, que se muestra antes de pagar. **[ASESOR FISCAL]**
2.3. Los límites de cada plan (usuarios, sedes, almacenamiento y funciones) son los publicados en la web en el momento de contratar y forman parte del contrato.
2.4. Big Elephant puede modificar los precios avisando por escrito con **30 días** de antelación. El cambio se aplica desde la siguiente renovación, y el Cliente puede cancelar antes sin coste.

### 3. Proceso de contratación
3.1. El Cliente elige plan y periodicidad, facilita los datos de su empresa (razón social, identificador fiscal y domicilio), acepta estas condiciones y paga en la página segura de Stripe.
3.2. El contrato se perfecciona con la confirmación del pago. Big Elephant activa la cuenta de la empresa y envía al correo indicado el acceso de su administrador.
3.3. Los datos fiscales y el domicilio quedan fijados en la factura. Para corregirlos, el Cliente escribe a soporte.

### 4. Duración, renovación, cambios y cancelación
4.1. La suscripción es mensual o anual y **se renueva automáticamente** por periodos iguales hasta que el Cliente la cancele.
4.2. **Cancelación:** en cualquier momento desde el portal de cliente o escribiendo a soporte. Surte efecto **al final del periodo pagado**; hasta entonces el Servicio sigue disponible. No hay permanencia ni penalización.
4.3. **Cambio de plan:** desde el portal de cliente.
   - Una subida de plan, o el paso de mensual a anual, se aplica de inmediato y se factura en ese momento la parte proporcional del periodo en curso.
   - Una bajada de plan, o el paso de anual a mensual, se aplica en la siguiente renovación.
4.4. Big Elephant puede resolver el contrato por incumplimiento grave del Cliente (cláusula 7), con 15 días para subsanarlo. Sin preaviso solo si el incumplimiento pone en riesgo la seguridad del Servicio o de terceros.

### 5. Pago, facturación, impago y reembolsos
5.1. El pago es por adelantado, al inicio de cada periodo, con los medios que admite la página de pago de Stripe. Big Elephant no guarda los datos de la tarjeta.
5.2. **Facturas:** se emiten a nombre del Cliente con los datos que facilita al contratar, se envían por correo y están disponibles en el portal de cliente. **[ASESOR FISCAL: decisiones 6 y 7]**
5.3. **Impago:** si un cobro falla, Stripe lo reintenta y se avisa al Cliente. Pasados **7 días** sin pago, la cuenta puede quedar suspendida hasta que se regularice, sin borrar datos. Si la deuda persiste, se aplican la cláusula 4.4 y la conservación de la cláusula 8. **[APROBACIÓN JURÍDICA]**
5.4. **Reembolsos:** los periodos iniciados no se reembolsan, salvo cobro duplicado o erróneo, incumplimiento grave de Big Elephant o lo que exija la ley. Un reembolso conlleva la factura rectificativa correspondiente.
5.5. Un contracargo injustificado permite suspender el Servicio mientras se resuelve.

### 6. Servicio y soporte
Se remite a las Condiciones del servicio SaaS (documento 2).

### 7. Obligaciones del Cliente
7.1. Custodiar sus credenciales y las de sus usuarios, y responder del uso que se haga con ellas.
7.2. No usar el Servicio de forma ilícita, no introducir código malicioso, no intentar acceder a datos de otros clientes, no someterlo a cargas abusivas y no revenderlo sin autorización.
7.3. Tener base legal para los datos personales que trate en el Servicio.

### 8. Datos del Cliente
8.1. Los datos que el Cliente introduce son suyos.
8.2. El propietario de la cuenta puede exportarlos en cualquier momento, también en solo lectura, en un archivo ZIP con formatos abiertos (CSV y JSON).
8.3. Al terminar la suscripción, la cuenta queda **en solo lectura durante 30 días** para que el Cliente exporte sus datos. Después se suprimen, salvo los que deban conservarse por ley (por ejemplo, la facturación). Las copias de seguridad que los contengan se eliminan en su ciclo de retención, como máximo **12 meses**. **[APROBACIÓN JURÍDICA: plazos]**

### 9. Propiedad intelectual
El software, la marca y la documentación son de Big Elephant o de sus licenciantes. El Cliente recibe un derecho de uso no exclusivo e intransferible mientras dure la suscripción.

### 10. Responsabilidad
10.1. Big Elephant responde de los daños directos causados por su incumplimiento, hasta el importe pagado por el Cliente en los **12 meses** anteriores al hecho.
10.2. No responde del lucro cesante, de la pérdida de negocio ni de los daños indirectos, salvo dolo o culpa grave. **[APROBACIÓN JURÍDICA]**

### 11. Confidencialidad
Cada parte guarda reserva de la información confidencial de la otra durante el contrato y 3 años después.

### 12. Modificación de las condiciones
Big Elephant puede modificarlas avisando con 30 días de antelación. Si el Cliente no está de acuerdo, puede cancelar antes de que entren en vigor.

### 13. Ley y jurisdicción
Ley española. Juzgados y tribunales de Madrid capital. **[APROBACIÓN JURÍDICA: clientes de otros países]**

### 14. Idioma
El contrato se celebra en español. Una traducción, si se ofrece, es informativa.

---

## 2. Condiciones del servicio SaaS (nivel de servicio, uso y seguridad)

**Versión propuesta: `SAAS-2026-11-01`**. Se aplica a empresas y a particulares.

1. **Disponibilidad.** Big Elephant pone los medios razonables para que el Servicio esté disponible de forma continua. Se excluyen las paradas programadas, avisadas con antelación cuando sea posible, y las causas ajenas a Big Elephant. **No se ofrece un nivel de servicio con compensaciones económicas.** **[DATO DEL PROPIETARIO: confirmar]**
2. **Soporte.** Por correo, a soporte@bigelephant.es, en días laborables de Madrid. Las incidencias y las solicitudes desde la propia aplicación quedan registradas con su historial.
3. **Seguridad.**
   - Cada empresa tiene su propia base de datos.
   - Comunicaciones cifradas (TLS).
   - Copias cifradas (AES-256-GCM) cada 15 minutos, con restauración verificada periódicamente.
   - Control de acceso por roles y verificación en dos pasos para el personal de Big Elephant.
   - Registro de auditoría de los accesos de soporte, que son delegados y temporales.
4. **Copias de seguridad.** Son un medio de continuidad del Servicio, no un archivo del Cliente. Para conservar sus datos, el Cliente usa la exportación.
5. **Evolución del Servicio.** Big Elephant puede mejorar o modificar funciones. Si un cambio reduce de forma sustancial una función esencial del plan contratado, lo avisa con 30 días y el Cliente puede cancelar sin coste.
6. **Límites de uso.** Los del plan contratado. Al alcanzarlos, la aplicación lo indica y propone ampliar. No se borran datos por superarlos.
7. **Uso aceptable.** Se prohíben:
   - los contenidos ilícitos;
   - el envío de comunicaciones no solicitadas;
   - los intentos de acceso no autorizado;
   - las pruebas de carga o de seguridad sin autorización escrita.
   El incumplimiento permite suspender la cuenta afectada.

### Anexo. Contrato de encargo del tratamiento (art. 28 RGPD)
**Responsable:** el Cliente. **Encargado:** IRON ELEPHANT CONSULTING, S.L.
1. **Objeto.** Tratar los datos personales que el Cliente introduce en Elephant Source, solo para prestar el Servicio: alojamiento, operación, copias, soporte y envío de las comunicaciones que el Cliente dispare desde la aplicación.
2. **Duración.** La del contrato, más el plazo de la cláusula 8.3 de las Condiciones generales.
3. **Instrucciones.** El encargado trata los datos solo siguiendo instrucciones documentadas del Cliente, incluidas estas condiciones y el uso que haga de la aplicación. Si una instrucción le parece contraria a la normativa, lo avisa.
4. **Confidencialidad.** El personal autorizado tiene deber de confidencialidad. El acceso de soporte es delegado, temporal y queda registrado.
5. **Seguridad.** Las medidas del punto 3 de estas condiciones.
6. **Subencargados.** Autorización general. Los cambios se avisan con 15 días y el Cliente puede oponerse con causa justificada.

   | Subencargado | Función | Ubicación | Garantía |
   |---|---|---|---|
   | Railway Corp. | Alojamiento y bases de datos | **Opción (a):** región europea. **Opción (b):** EE. UU. (`us-west2`) | (a) Sin transferencia. (b) **[APROBACIÓN JURÍDICA]**: Marco de Privacidad UE-EE. UU. si consta, o cláusulas contractuales tipo |
   | [DATO DEL PROPIETARIO] | Almacén de copias cifradas | [DATO DEL PROPIETARIO] | [APROBACIÓN JURÍDICA] |
   | Stripe Payments Europe, Ltd. | Pagos (solo datos de facturación del Cliente) | Irlanda | — |
   | ActiveCampaign, LLC (Postmark), **si se activa** | Correo transaccional | EE. UU. | **[APROBACIÓN JURÍDICA]**: Marco de Privacidad o cláusulas contractuales tipo |

7. **Derechos de los interesados.** El encargado ayuda al Cliente con las funciones de la aplicación (consulta, rectificación, exportación y supresión) y le reenvía cualquier solicitud que reciba.
8. **Brechas de seguridad.** Notificación al Cliente sin dilación indebida y como máximo en **48 horas** desde que el encargado tenga constancia.
9. **Fin del encargo.** Exportación durante 30 días y supresión posterior; certificado de supresión a petición del Cliente.
10. **Auditoría.** El encargado facilita la información necesaria para demostrar el cumplimiento y permite auditorías razonables, con preaviso y a cargo del Cliente.

---

## 3. Política de privacidad

**Versión propuesta: `PRIV-2026-11-01`**

1. **Responsable.** IRON ELEPHANT CONSULTING, S.L., NIF B26987875, Calle Corazón de María, 57, 1.º D, 28002 Madrid. Contacto: privacidad@bigelephant.es.
2. **Qué datos tratamos y para qué.**

   | Finalidad | Datos | Base legal | Plazo |
   |---|---|---|---|
   | Atender solicitudes de la web (contacto, demostración, presupuesto) | Nombre, correo, teléfono, empresa, mensaje | Medidas precontractuales a petición del interesado | 12 meses sin contratación **[APROBACIÓN JURÍDICA]** |
   | Prueba gratuita | Datos del administrador y de la empresa | Medidas precontractuales | Prueba + 30 días |
   | Contratación, prestación del servicio y soporte | Datos del cliente, de sus usuarios y de las incidencias | Ejecución del contrato | Duración del contrato + 30 días |
   | Facturación y obligaciones fiscales | Datos fiscales, facturas y pagos | Obligación legal | 6 años (Código de Comercio) y plazos fiscales |
   | Seguridad y registros de acceso | IP, fechas y acciones | Interés legítimo en la seguridad | 12 meses **[APROBACIÓN JURÍDICA]** |
   | Comunicaciones del servicio (altas, pagos, avisos de seguridad) | Correo electrónico | Ejecución del contrato | Las del contrato |

3. **No** se usan los datos para publicidad de terceros, **no** se venden y **no** se toman decisiones automatizadas con efectos jurídicos.
4. **Destinatarios.**
   - Los proveedores del anexo del documento 2, como encargados del tratamiento.
   - La Agencia Tributaria y otras autoridades, cuando lo exija la ley.
   - Stripe trata los datos de pago como responsable independiente para sus propias obligaciones.
5. **Transferencias internacionales.**
   - **Opción (a):** el alojamiento está en la UE. Puede haber transferencias puntuales a EE. UU. a través del proveedor de correo, con las garantías indicadas en el anexo.
   - **Opción (b):** el alojamiento está en EE. UU., con las garantías del anexo. **[APROBACIÓN JURÍDICA]**
6. **Derechos.** Acceso, rectificación, supresión, oposición, limitación y portabilidad, escribiendo a privacidad@bigelephant.es. El interesado puede reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).
7. **Datos que tratan nuestros clientes.** Los datos que una empresa introduce en Elephant Source sobre sus propios clientes y empleados los trata como responsable. Big Elephant actúa como su encargado (anexo del documento 2). Para ejercer derechos sobre esos datos, hay que dirigirse a esa empresa.
8. **Cookies.** Solo técnicas: sesión del personal de Big Elephant, sesión de cada empresa (cookie `__Host-`, ligada a su dominio) y las de la página de pago de Stripe. No hay cookies de analítica ni de publicidad, así que no se muestra banner de consentimiento. **[APROBACIÓN JURÍDICA]**

---

## 4. Política de cancelación

**Versión propuesta: `CANC-2026-11-01`**

1. **Cómo cancelar.** Desde el portal de cliente («Gestionar suscripción» → «Cancelar»), o escribiendo a soporte@bigelephant.es desde el correo del administrador.
2. **Efecto.**
   - La cancelación se aplica **al final del periodo ya pagado**.
   - Hasta entonces, el servicio sigue disponible con normalidad.
   - Hasta esa fecha se puede deshacer desde el mismo portal.
3. **Sin penalización ni permanencia.**
4. **Reembolsos.** Cancelar no da derecho a reembolsar el periodo en curso, salvo las excepciones de la cláusula 5.4 de las Condiciones generales o, para particulares, el derecho de desistimiento (documento 5).
5. **Después de la cancelación.**
   - La cuenta pasa a **solo lectura durante 30 días**, con exportación de los datos.
   - Pasado ese plazo, los datos se suprimen, salvo los de conservación legal.
   - Las copias de seguridad se eliminan en su ciclo de retención (máximo 12 meses).
6. **Cancelación por impago.** Se aplica la cláusula 5.3 de las Condiciones generales.

---

## 5. Derecho de desistimiento (particulares)

**Versión propuesta: `DESIST-2026-11-01`.** **Solo se publica cuando se abra la contratación de particulares** (ola 3 de `PROPUESTA_DECISIONES_FISCALES.md`). **[APROBACIÓN JURÍDICA completa]**

1. **Plazo.** El particular puede desistir del contrato en **14 días naturales** desde su celebración, sin indicar el motivo y sin penalización (arts. 102 a 108 del TRLGDCU).
2. **Inicio inmediato del servicio.** Al contratar, el particular puede pedir expresamente que el servicio empiece de inmediato, marcando una casilla propia. Si lo pide y desiste después, **pagará la parte proporcional del servicio prestado** hasta el momento de comunicar el desistimiento (art. 108.3 TRLGDCU).
3. **Cómo desistir.**
   - **Desde su cuenta**, con el botón **«Desistir del contrato aquí»** y su confirmación («Confirmar desistimiento»). Recibe al momento un justificante con la referencia, la fecha y la hora.
   - O escribiendo a soporte@bigelephant.es, o con el formulario modelo del anexo.
4. **Reembolso.** Big Elephant reembolsa lo pagado, descontada en su caso la parte proporcional del punto 2, **en un máximo de 14 días** desde que recibe el desistimiento, por el **mismo medio de pago**, sin coste para el particular.
5. **Efectos.**
   - La suscripción se da de baja.
   - La cuenta queda en solo lectura durante 30 días para exportar los datos, y después se suprimen.

**Formulario modelo de desistimiento.** A la atención de IRON ELEPHANT CONSULTING, S.L., Calle Corazón de María, 57, 1.º D, 28002 Madrid, soporte@bigelephant.es:

> Por la presente le comunico que desisto de mi contrato del servicio Elephant Source, contratado el [fecha], a nombre de [nombre], con el correo [correo]. Fecha y firma (solo si se envía en papel).

**Nota operativa [CONFIRMADO]:** la plataforma registra la solicitud y emite el justificante, pero **no ejecuta reembolsos ni bajas automáticamente**: los resuelve el equipo desde el CRM (Atención al cliente → Desistimientos). El plazo de 14 días del punto 4 obliga a revisar las solicitudes a diario.

---

## 6. Información de facturación y suscripciones

**Versión propuesta: `FACT-2026-11-01`**

1. **Precios.**
   - Para empresas, los precios no incluyen impuestos; el impuesto aplicable se muestra antes de pagar.
   - Para particulares, se muestra siempre el **precio final con impuestos** (cuando se abra esa contratación).
2. **Cobro.** Por adelantado, al inicio de cada periodo mensual o anual, en la página segura de Stripe (tarjeta y otros medios que se muestren). Big Elephant no guarda datos de tarjetas.
3. **Renovación automática.** Al final de cada periodo, la suscripción se renueva y se cobra con el mismo medio de pago, salvo que se haya cancelado antes. **[DATO DEL PROPIETARIO: aviso previo a la renovación anual para particulares; hoy no existe]**
4. **Facturas.**
   - Se emite una factura por cada cobro, a nombre de la empresa o del particular, con los datos fiscales facilitados al contratar.
   - Se envía por correo y queda disponible en el portal de cliente («Historial de facturas»).
   - **[ASESOR FISCAL: emisor, series y VERI\*FACTU (decisiones 6 a 8)]**
5. **Datos fiscales.** El domicilio y el identificador fiscal se fijan al contratar y no se pueden cambiar en la página de pago. Para corregirlos, se escribe a soporte, y se emite la factura rectificativa que corresponda.
6. **Cambios de plan.** Una subida se factura de inmediato por la parte proporcional del periodo en curso. Una bajada se aplica en la siguiente renovación, sin reembolso del periodo en curso.
7. **Cobros fallidos.** Stripe reintenta el cobro y se avisa por correo. Pasados 7 días sin pago, la cuenta puede quedar suspendida hasta que se regularice, sin perder datos.
8. **Reembolsos.** Solo en los casos de la cláusula 5.4 de las Condiciones generales y del derecho de desistimiento. Se documentan con una factura rectificativa y se abonan por el mismo medio de pago.
9. **Medio de pago.** Se puede cambiar en cualquier momento desde el portal de cliente.

---

## Resumen de lo que necesita aprobación

| Punto | Quién | Bloquea |
|---|---|---|
| Datos del Registro Mercantil | Propietario | Condiciones generales y aviso legal |
| Ubicación de los datos: región europea (a) o EE. UU. (b) | Propietario y jurídico | Política de privacidad y encargo |
| Proveedor y región del almacén de copias | Propietario | Encargo del tratamiento |
| SLA sin compensaciones | Propietario | Condiciones del servicio |
| Responsabilidad, fuero, plazos de conservación e impago | Jurídico | Condiciones generales |
| Textos de consumo y desistimiento; aviso de renovación anual | Jurídico | Particulares (ola 3) |
| Facturas, series y VERI\*FACTU | Asesor fiscal | Facturación |
