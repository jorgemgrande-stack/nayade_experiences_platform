/**
 * Revisión del catálogo del 10/11/2026 — Restos de texto en los módulos Elephant Net HEREDADOS.
 *
 * La unificación de Elephant Net (review20261109netunificacion.ts) marcó los 19 módulos sueltos como heredados
 * (`catalog.legacy`) sin tocar sus fichas, que siguen publicadas para quien ya los tiene (contratos, facturas y
 * «Mis módulos»). Sus textos seguían hablando de ellos como módulos que se venden por separado o que llegarán
 * «próximamente». Esta revisión corrige solo eso, en 18 de los 19 (`restaurant-net-bookings` no tenía nada que corregir):
 *  - `hotel-net-pms`: «Channel Manager y Housekeeping (submódulos aparte, próximamente)» y las dos respuestas de su
 *    FAQ que remitían al Motor de reservas «que se contrata aparte» y al Channel Manager «que llegará próximamente».
 *  - «Próximamente: …» y «En preparación: …» (titular, propuesta de valor y descripción SEO) y «(próximamente)» (título SEO) → «Forma parte de
 *    <solución>: …» y «(parte de <solución>)». No afirma disponibilidad: el estado real de cada funcionalidad lo da la
 *    ficha de la solución (`commercial.includedFeatures`).
 *  - «¿Puedo contratarlo ya?» y las condiciones de activación («Todavía no se puede contratar…», «Activación automática…»)
 *    → no se contrata por separado: forma parte de la solución. Solo los que llegaron a venderse (los dos de Social Token
 *    Net) dicen «Ya no…» y que quien lo tenía lo conserva.
 *  - Comparaciones con módulos sueltos: «¿Forma parte de algún paquete? Sí, de … Complete», «submódulo …», «se contrata
 *    sin la escuela», «que ya se implanta por separado», «pensado para trabajar con Hotel Net PMS», «serán Care Net …».
 *  - El Channel Manager se nombra como parte de Hotel Net «en implantación» (su estado en la ficha de la solución).
 *
 * Los textos de partida («from») son los publicados en production el 10/11/2026
 * (https://admin.bigelephant.es/cp/v1/public/site), campo a campo; los nuevos salen de ellos con reglas fijas (el mismo
 * texto en todos los módulos). Las siete soluciones no cambian: en lo publicado ya no dicen «próximamente» ni se
 * comparan con módulos sueltos.
 *
 * Mecanismo y garantías: applyListingReview (review20261108fichas.ts) con `overDraft`: cada campo solo cambia desde su
 * valor publicado de partida; un borrador ajeno nunca se publica (la revisión se aplica sobre lo publicado y el borrador
 * se conserva); idempotente; simulación por defecto. Solo textos: sin precios, estados, ámbitos, capacidades, oferta,
 * marca de heredado ni evidencia. Se aplica con `catalog-review` (server/controlPlane/backupJob.ts), después de las demás.
 */
import type { ListingChange } from "./review20261108fichas";

export const REVIEW_ID_2026_11_10_NET_LEGACY = "revision-catalogo-2026-11-10-net-heredados";

/** `inDirectSale`: los dos módulos heredados de Social Token Net conservan su oferta de venta directa; aquí solo cambian textos. */
export const NET_LEGACY_LISTINGS_2026_11_10: readonly ListingChange[] = [
  {
    "key": "hotel-net-pms",
    "inDirectSale": true,
    "fields": {
      "excludes": {
        "from": [
          "Channel Manager y Housekeeping (submódulos aparte, próximamente)",
          "Venta de alojamiento de terceros (Travel Net)"
        ],
        "to": [
          "Channel Manager y Housekeeping (forman parte de Hotel Net)",
          "Venta de alojamiento de terceros (Travel Net)"
        ]
      },
      "faq": {
        "from": [
          {
            "a": "Es una implantación acompañada: envías la solicitud y nuestro equipo la activa y la configura contigo. Enviar la solicitud no activa ni cobra nada por sí solo.",
            "q": "¿Cómo se pone en marcha?"
          },
          {
            "a": "Sí. La habitación se retiene noche a noche al crear la reserva: si alguna noche no queda sitio, la reserva no se hace.",
            "q": "¿Evita las sobreventas?"
          },
          {
            "a": "No. La reserva directa con pago online es el Motor de reservas, que se contrata aparte.",
            "q": "¿Incluye la venta en mi web?"
          },
          {
            "a": "No. La sincronización con canales será el Channel Manager, que llegará próximamente.",
            "q": "¿Se conecta con Booking u otras OTAs?"
          },
          {
            "a": "No, hoy no forman parte del módulo.",
            "q": "¿Incluye check-in online o el parte de viajeros?"
          },
          {
            "a": "No. Los importes del catálogo son sin IVA; el 21 % se añade aparte.",
            "q": "¿El precio incluye IVA?"
          }
        ],
        "to": [
          {
            "a": "Es una implantación acompañada: envías la solicitud y nuestro equipo la activa y la configura contigo. Enviar la solicitud no activa ni cobra nada por sí solo.",
            "q": "¿Cómo se pone en marcha?"
          },
          {
            "a": "Sí. La habitación se retiene noche a noche al crear la reserva: si alguna noche no queda sitio, la reserva no se hace.",
            "q": "¿Evita las sobreventas?"
          },
          {
            "a": "No. La reserva directa con pago online es el Motor de reservas, que forma parte de Hotel Net.",
            "q": "¿Incluye la venta en mi web?"
          },
          {
            "a": "No. La sincronización con canales es el Channel Manager de Hotel Net, que está en implantación.",
            "q": "¿Se conecta con Booking u otras OTAs?"
          },
          {
            "a": "No, hoy no forman parte del módulo.",
            "q": "¿Incluye check-in online o el parte de viajeros?"
          },
          {
            "a": "No. Los importes del catálogo son sin IVA; el 21 % se añade aparte.",
            "q": "¿El precio incluye IVA?"
          }
        ]
      }
    }
  },
  {
    "key": "hotel-net-channel-manager",
    "inDirectSale": true,
    "fields": {
      "headline": {
        "from": "Próximamente: tus canales de venta sincronizados.",
        "to": "Forma parte de Hotel Net: tus canales de venta sincronizados."
      },
      "valueProposition": {
        "from": "Próximamente: la disponibilidad y las tarifas de tu alojamiento sincronizadas con tus canales de venta.",
        "to": "Forma parte de Hotel Net: la disponibilidad y las tarifas de tu alojamiento sincronizadas con tus canales de venta."
      },
      "faq": {
        "from": [
          {
            "a": "Todavía no: estará disponible próximamente y hasta entonces no se puede contratar.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "No. Las comisiones de cada canal se pagan aparte a cada OTA.",
            "q": "¿Las comisiones de los canales estarán incluidas?"
          },
          {
            "a": "Tus propias cuentas en cada canal de venta.",
            "q": "¿Qué necesitaré?"
          }
        ],
        "to": [
          {
            "a": "No se contrata por separado: forma parte de Hotel Net, la solución completa.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "No. Las comisiones de cada canal se pagan aparte a cada OTA.",
            "q": "¿Las comisiones de los canales estarán incluidas?"
          },
          {
            "a": "Tus propias cuentas en cada canal de venta.",
            "q": "¿Qué necesitaré?"
          }
        ]
      },
      "terms": {
        "from": {
          "activation": "Todavía no se puede contratar: estará disponible próximamente."
        },
        "to": {
          "activation": "No se contrata por separado: forma parte de Hotel Net."
        }
      },
      "seo": {
        "from": {
          "slug": "hotel-channel-manager",
          "title": "Channel Manager hotelero (próximamente) | Big Elephant",
          "description": "Próximamente: sincronización de disponibilidad y tarifas con los canales de venta de tu alojamiento."
        },
        "to": {
          "slug": "hotel-channel-manager",
          "title": "Channel Manager hotelero (parte de Hotel Net) | Big Elephant",
          "description": "Forma parte de Hotel Net: sincronización de disponibilidad y tarifas con los canales de venta de tu alojamiento."
        }
      }
    }
  },
  {
    "key": "hotel-net-booking-engine",
    "inDirectSale": true,
    "fields": {
      "faq": {
        "from": [
          {
            "a": "Es una implantación acompañada: envías la solicitud y nuestro equipo la activa y la configura contigo. Enviar la solicitud no activa ni cobra nada por sí solo.",
            "q": "¿Cómo se pone en marcha?"
          },
          {
            "a": "Con Redsys, usando el TPV virtual de tu propia empresa: las credenciales son tuyas.",
            "q": "¿Con qué pasarela se cobra?"
          },
          {
            "a": "Sí: el motor publica las tipologías, la disponibilidad y los precios que gestionas con el PMS.",
            "q": "¿Necesito Hotel Net PMS?"
          },
          {
            "a": "Hoy cada reserva corresponde a una habitación.",
            "q": "¿Se pueden reservar varias habitaciones a la vez?"
          },
          {
            "a": "No. Los importes del catálogo son sin IVA; el 21 % se añade aparte.",
            "q": "¿El precio incluye IVA?"
          }
        ],
        "to": [
          {
            "a": "Es una implantación acompañada: envías la solicitud y nuestro equipo la activa y la configura contigo. Enviar la solicitud no activa ni cobra nada por sí solo.",
            "q": "¿Cómo se pone en marcha?"
          },
          {
            "a": "Con Redsys, usando el TPV virtual de tu propia empresa: las credenciales son tuyas.",
            "q": "¿Con qué pasarela se cobra?"
          },
          {
            "a": "Sí: el motor publica las tipologías, la disponibilidad y los precios que gestionas con el PMS.",
            "q": "¿Necesito el PMS de Hotel Net?"
          },
          {
            "a": "Hoy cada reserva corresponde a una habitación.",
            "q": "¿Se pueden reservar varias habitaciones a la vez?"
          },
          {
            "a": "No. Los importes del catálogo son sin IVA; el 21 % se añade aparte.",
            "q": "¿El precio incluye IVA?"
          }
        ]
      }
    }
  },
  {
    "key": "hotel-net-housekeeping",
    "inDirectSale": true,
    "fields": {
      "headline": {
        "from": "Próximamente: limpieza y estado de habitaciones.",
        "to": "Forma parte de Hotel Net: limpieza y estado de habitaciones."
      },
      "valueProposition": {
        "from": "Próximamente: recepción y limpieza coordinadas, con el estado de cada habitación a la vista.",
        "to": "Forma parte de Hotel Net: recepción y limpieza coordinadas, con el estado de cada habitación a la vista."
      },
      "faq": {
        "from": [
          {
            "a": "Todavía no: estará disponible próximamente y hasta entonces no se puede contratar.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "Llevará el estado de limpieza de cada habitación y las tareas del equipo de limpieza.",
            "q": "¿Qué hará?"
          },
          {
            "a": "Sí, está pensado para trabajar con Hotel Net PMS.",
            "q": "¿Funcionará con el PMS?"
          }
        ],
        "to": [
          {
            "a": "No se contrata por separado: forma parte de Hotel Net, la solución completa.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "Llevará el estado de limpieza de cada habitación y las tareas del equipo de limpieza.",
            "q": "¿Qué hará?"
          },
          {
            "a": "Sí, está pensado para trabajar con el PMS de Hotel Net.",
            "q": "¿Funcionará con el PMS?"
          }
        ]
      },
      "terms": {
        "from": {
          "activation": "Todavía no se puede contratar: estará disponible próximamente."
        },
        "to": {
          "activation": "No se contrata por separado: forma parte de Hotel Net."
        }
      },
      "seo": {
        "from": {
          "slug": "housekeeping-hotel",
          "title": "Housekeeping para hoteles (próximamente) | Big Elephant",
          "description": "Próximamente: gestión de limpieza y estado de habitaciones conectada con tu PMS."
        },
        "to": {
          "slug": "housekeeping-hotel",
          "title": "Housekeeping para hoteles (parte de Hotel Net) | Big Elephant",
          "description": "Forma parte de Hotel Net: gestión de limpieza y estado de habitaciones conectada con tu PMS."
        }
      }
    }
  },
  {
    "key": "ski-net-school",
    "inDirectSale": true,
    "fields": {
      "valueProposition": {
        "from": "Próximamente: el planning de profesores, las clases y los alumnos de tu escuela de esquí en Elephant Core.",
        "to": "Forma parte de Ski Net: el planning de profesores, las clases y los alumnos de tu escuela de esquí en Elephant Core."
      },
      "excludes": {
        "from": [
          "Forfaits, alojamientos y paquetes de nieve (adaptación en la implantación o Travel Net)",
          "Liquidaciones de profesores (submódulo Profesores)"
        ],
        "to": [
          "Forfaits, alojamientos y paquetes de nieve (adaptación en la implantación o Travel Net)",
          "Liquidaciones de profesores (forman parte de Ski Net)"
        ]
      },
      "faq": {
        "from": [
          {
            "a": "Todavía no: estará disponible próximamente y hasta entonces no se puede contratar.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "No. El alquiler es Ski Net Alquiler, que se contrata sin la escuela.",
            "q": "¿Incluye el alquiler de material?"
          },
          {
            "a": "No. Los forfaits y los paquetes de nieve no forman parte de la escuela.",
            "q": "¿Incluye forfaits?"
          }
        ],
        "to": [
          {
            "a": "No se contrata por separado: forma parte de Ski Net, la solución completa.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "No. El alquiler de material forma parte de Ski Net.",
            "q": "¿Incluye el alquiler de material?"
          },
          {
            "a": "No. Los forfaits y los paquetes de nieve no forman parte de la escuela.",
            "q": "¿Incluye forfaits?"
          }
        ]
      },
      "terms": {
        "from": {
          "activation": "Todavía no se puede contratar: estará disponible próximamente."
        },
        "to": {
          "activation": "No se contrata por separado: forma parte de Ski Net."
        }
      }
    }
  },
  {
    "key": "ski-net-rental",
    "inDirectSale": true,
    "fields": {
      "valueProposition": {
        "from": "En preparación: el material, los contratos y las fianzas de tu tienda de alquiler bajo control.",
        "to": "Forma parte de Ski Net: el material, los contratos y las fianzas de tu tienda de alquiler bajo control."
      },
      "longDescription": {
        "from": "Alquiler de material de esquí: inventario, contratos con firma, taquillas, taller, previsión, cargos y fianzas. Se contrata sin la escuela.",
        "to": "Alquiler de material de esquí: inventario, contratos con firma, taquillas, taller, previsión, cargos y fianzas. Funciona sin la escuela."
      },
      "faq": {
        "from": [
          {
            "a": "Todavía no: está en preparación y no se puede contratar hasta que esté listo.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "No. Ski Net Alquiler se contrata sin la escuela.",
            "q": "¿Necesito la escuela?"
          },
          {
            "a": "No. Los contratos con clientes y proveedores serán Contratos y firma electrónica.",
            "q": "¿Sirve para los contratos generales de mi empresa?"
          }
        ],
        "to": [
          {
            "a": "No se contrata por separado: forma parte de Ski Net, la solución completa.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "No: el alquiler funciona sin la escuela. Los dos forman parte de Ski Net.",
            "q": "¿Necesito la escuela?"
          },
          {
            "a": "No. Los contratos con clientes y proveedores serán Contratos y firma electrónica.",
            "q": "¿Sirve para los contratos generales de mi empresa?"
          }
        ]
      },
      "terms": {
        "from": {
          "activation": "Todavía no se puede contratar: está en preparación."
        },
        "to": {
          "activation": "No se contrata por separado: forma parte de Ski Net."
        }
      }
    },
    "product": {
      "tagline": {
        "from": "Alquiler de material, hasta 300 equipos. Se contrata sin la escuela.",
        "to": "Alquiler de material, hasta 300 equipos. Funciona sin la escuela."
      }
    }
  },
  {
    "key": "ski-net-courses",
    "inDirectSale": true,
    "fields": {
      "valueProposition": {
        "from": "Próximamente: grupos de cursillo por nivel, formados desde el planning de tu escuela.",
        "to": "Forma parte de Ski Net: grupos de cursillo por nivel, formados desde el planning de tu escuela."
      },
      "faq": {
        "from": [
          {
            "a": "Todavía no: estará disponible próximamente y hasta entonces no se puede contratar.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "Está pensado para trabajar con Ski Net Escuela.",
            "q": "¿Funcionará sin la escuela?"
          },
          {
            "a": "Sí, de Ski Net Complete.",
            "q": "¿Forma parte de algún paquete?"
          }
        ],
        "to": [
          {
            "a": "No se contrata por separado: forma parte de Ski Net, la solución completa.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "Está pensado para trabajar con la escuela de Ski Net.",
            "q": "¿Funcionará sin la escuela?"
          },
          {
            "a": "Sí: Ski Net es la solución completa que lo incluye.",
            "q": "¿Forma parte de Ski Net?"
          }
        ]
      },
      "terms": {
        "from": {
          "activation": "Todavía no se puede contratar: estará disponible próximamente."
        },
        "to": {
          "activation": "No se contrata por separado: forma parte de Ski Net."
        }
      }
    }
  },
  {
    "key": "ski-net-instructors",
    "inDirectSale": true,
    "fields": {
      "valueProposition": {
        "from": "Próximamente: horas, disponibilidad y liquidaciones de tus profesores, con su propio portal.",
        "to": "Forma parte de Ski Net: horas, disponibilidad y liquidaciones de tus profesores, con su propio portal."
      },
      "faq": {
        "from": [
          {
            "a": "Todavía no: estará disponible próximamente y hasta entonces no se puede contratar.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "No. Las nóminas y los fichajes del personal son de Elephant People.",
            "q": "¿Sustituye a Elephant People?"
          },
          {
            "a": "Sí, de Ski Net Complete.",
            "q": "¿Forma parte de algún paquete?"
          }
        ],
        "to": [
          {
            "a": "No se contrata por separado: forma parte de Ski Net, la solución completa.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "No. Las nóminas y los fichajes del personal son de Elephant People.",
            "q": "¿Sustituye a Elephant People?"
          },
          {
            "a": "Sí: Ski Net es la solución completa que lo incluye.",
            "q": "¿Forma parte de Ski Net?"
          }
        ]
      },
      "terms": {
        "from": {
          "activation": "Todavía no se puede contratar: estará disponible próximamente."
        },
        "to": {
          "activation": "No se contrata por separado: forma parte de Ski Net."
        }
      }
    }
  },
  {
    "key": "travel-net-agency",
    "inDirectSale": true,
    "fields": {
      "valueProposition": {
        "from": "En preparación: los expedientes de tu agencia de viajes con el régimen especial de agencias (REAV), tus proveedores y un área de viajes para tus clientes.",
        "to": "Forma parte de Travel Net: los expedientes de tu agencia de viajes con el régimen especial de agencias (REAV), tus proveedores y un área de viajes para tus clientes."
      },
      "faq": {
        "from": [
          {
            "a": "Todavía no: está en preparación y no se puede contratar hasta que esté listo.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "Sí. Los expedientes calculan el margen y el IVA del régimen especial de agencias de viajes.",
            "q": "¿Calculará el REAV?"
          },
          {
            "a": "No por ahora: los circuitos y el transporte gestionado no están incluidos.",
            "q": "¿Incluye circuitos?"
          }
        ],
        "to": [
          {
            "a": "No se contrata por separado: forma parte de Travel Net, la solución completa.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "Sí. Los expedientes calculan el margen y el IVA del régimen especial de agencias de viajes.",
            "q": "¿Calculará el REAV?"
          },
          {
            "a": "No por ahora: los circuitos y el transporte gestionado no están incluidos.",
            "q": "¿Incluye circuitos?"
          }
        ]
      },
      "terms": {
        "from": {
          "activation": "Todavía no se puede contratar: está en preparación."
        },
        "to": {
          "activation": "No se contrata por separado: forma parte de Travel Net."
        }
      }
    }
  },
  {
    "key": "travel-net-packages",
    "inDirectSale": true,
    "fields": {
      "valueProposition": {
        "from": "Próximamente: diseña y vende combinados con los precios de tus proveedores.",
        "to": "Forma parte de Travel Net: diseña y vende combinados con los precios de tus proveedores."
      },
      "faq": {
        "from": [
          {
            "a": "Todavía no: estará disponible próximamente y hasta entonces no se puede contratar.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "No por ahora: los circuitos y el transporte gestionado no están incluidos.",
            "q": "¿Incluye circuitos?"
          },
          {
            "a": "Sí, de Travel Net Complete.",
            "q": "¿Forma parte de algún paquete?"
          }
        ],
        "to": [
          {
            "a": "No se contrata por separado: forma parte de Travel Net, la solución completa.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "No por ahora: los circuitos y el transporte gestionado no están incluidos.",
            "q": "¿Incluye circuitos?"
          },
          {
            "a": "Sí: Travel Net es la solución completa que lo incluye.",
            "q": "¿Forma parte de Travel Net?"
          }
        ]
      },
      "terms": {
        "from": {
          "activation": "Todavía no se puede contratar: estará disponible próximamente."
        },
        "to": {
          "activation": "No se contrata por separado: forma parte de Travel Net."
        }
      }
    }
  },
  {
    "key": "travel-net-connectors",
    "inDirectSale": true,
    "fields": {
      "valueProposition": {
        "from": "Próximamente: tus proveedores de alojamiento y forfaits conectados en una sola búsqueda.",
        "to": "Forma parte de Travel Net: tus proveedores de alojamiento y forfaits conectados en una sola búsqueda."
      },
      "faq": {
        "from": [
          {
            "a": "Todavía no: estará disponible próximamente y hasta entonces no se puede contratar.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "Por integración. Las tarifas de los proveedores se pagan aparte a cada uno.",
            "q": "¿Cómo se cobrará?"
          },
          {
            "a": "Credenciales propias de tu agencia con cada proveedor.",
            "q": "¿Qué necesitaré?"
          }
        ],
        "to": [
          {
            "a": "No se contrata por separado: forma parte de Travel Net, la solución completa.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "Por integración. Las tarifas de los proveedores se pagan aparte a cada uno.",
            "q": "¿Cómo se cobrará?"
          },
          {
            "a": "Credenciales propias de tu agencia con cada proveedor.",
            "q": "¿Qué necesitaré?"
          }
        ]
      },
      "terms": {
        "from": {
          "activation": "Todavía no se puede contratar: estará disponible próximamente."
        },
        "to": {
          "activation": "No se contrata por separado: forma parte de Travel Net."
        }
      }
    }
  },
  {
    "key": "restaurant-net-floor",
    "inDirectSale": true,
    "fields": {
      "valueProposition": {
        "from": "Próximamente: sala, mesas y comandas conectadas con la cocina y la caja, con el coste de cada plato.",
        "to": "Forma parte de Restaurant Net: sala, mesas y comandas conectadas con la cocina y la caja, con el coste de cada plato."
      },
      "faq": {
        "from": [
          {
            "a": "Todavía no: estará disponible próximamente y hasta entonces no se puede contratar.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "No. Cobrarás con la caja básica de tu plan o con Elephant POS.",
            "q": "¿Incluirá la caja?"
          },
          {
            "a": "No: es el submódulo Cocina/KDS.",
            "q": "¿Incluirá la pantalla de cocina?"
          }
        ],
        "to": [
          {
            "a": "No se contrata por separado: forma parte de Restaurant Net, la solución completa.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "No. Cobrarás con la caja básica de tu plan o con Elephant POS.",
            "q": "¿Incluirá la caja?"
          },
          {
            "a": "No: la pantalla de cocina (KDS) forma parte de Restaurant Net.",
            "q": "¿Incluirá la pantalla de cocina?"
          }
        ]
      },
      "terms": {
        "from": {
          "activation": "Todavía no se puede contratar: estará disponible próximamente."
        },
        "to": {
          "activation": "No se contrata por separado: forma parte de Restaurant Net."
        }
      }
    }
  },
  {
    "key": "restaurant-net-kds",
    "inDirectSale": true,
    "fields": {
      "valueProposition": {
        "from": "Próximamente: las comandas llegan a cocina al momento, desde un comandero móvil.",
        "to": "Forma parte de Restaurant Net: las comandas llegan a cocina al momento, desde un comandero móvil."
      },
      "faq": {
        "from": [
          {
            "a": "Todavía no: estará disponible próximamente y hasta entonces no se puede contratar.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "Está pensado para trabajar con Restaurant Net Sala y comandas.",
            "q": "¿Funcionará sin Sala y comandas?"
          },
          {
            "a": "Sí, de Restaurant Net Complete.",
            "q": "¿Forma parte de algún paquete?"
          }
        ],
        "to": [
          {
            "a": "No se contrata por separado: forma parte de Restaurant Net, la solución completa.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "Está pensado para trabajar con la sala y las comandas de Restaurant Net.",
            "q": "¿Funcionará sin Sala y comandas?"
          },
          {
            "a": "Sí: Restaurant Net es la solución completa que lo incluye.",
            "q": "¿Forma parte de Restaurant Net?"
          }
        ]
      },
      "terms": {
        "from": {
          "activation": "Todavía no se puede contratar: estará disponible próximamente."
        },
        "to": {
          "activation": "No se contrata por separado: forma parte de Restaurant Net."
        }
      }
    }
  },
  {
    "key": "care-net-agenda",
    "inDirectSale": true,
    "fields": {
      "faq": {
        "from": [
          {
            "a": "Es una implantación acompañada: envías la solicitud y nuestro equipo la activa y la configura contigo. Enviar la solicitud no activa ni cobra nada por sí solo.",
            "q": "¿Cómo se pone en marcha?"
          },
          {
            "a": "Sí. Las plazas se retienen al reservar y cada hueco respeta su capacidad.",
            "q": "¿Evita las reservas por encima de la capacidad?"
          },
          {
            "a": "No. La historia y el seguimiento especializados serán Care Net Gestión clínica.",
            "q": "¿Incluye la historia clínica?"
          },
          {
            "a": "No. Los bonos y las sesiones serán Care Net Tratamientos y bonos, que está en preparación.",
            "q": "¿Incluye bonos de sesiones?"
          },
          {
            "a": "No. Los importes del catálogo son sin IVA; el 21 % se añade aparte.",
            "q": "¿El precio incluye IVA?"
          }
        ],
        "to": [
          {
            "a": "Es una implantación acompañada: envías la solicitud y nuestro equipo la activa y la configura contigo. Enviar la solicitud no activa ni cobra nada por sí solo.",
            "q": "¿Cómo se pone en marcha?"
          },
          {
            "a": "Sí. Las plazas se retienen al reservar y cada hueco respeta su capacidad.",
            "q": "¿Evita las reservas por encima de la capacidad?"
          },
          {
            "a": "No. La historia y el seguimiento especializados forman parte de Care Net.",
            "q": "¿Incluye la historia clínica?"
          },
          {
            "a": "No. Los bonos y las sesiones forman parte de Care Net.",
            "q": "¿Incluye bonos de sesiones?"
          },
          {
            "a": "No. Los importes del catálogo son sin IVA; el 21 % se añade aparte.",
            "q": "¿El precio incluye IVA?"
          }
        ]
      }
    }
  },
  {
    "key": "care-net-clinical",
    "inDirectSale": true,
    "fields": {
      "headline": {
        "from": "Próximamente: historia y seguimiento con datos protegidos.",
        "to": "Forma parte de Care Net: historia y seguimiento con datos protegidos."
      },
      "valueProposition": {
        "from": "Próximamente: historia y seguimiento especializados con una ficha integral cifrada.",
        "to": "Forma parte de Care Net: historia y seguimiento especializados con una ficha integral cifrada."
      },
      "faq": {
        "from": [
          {
            "a": "Todavía no: estará disponible próximamente y hasta entonces no se puede contratar.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "Al tratar datos de salud, requiere una evaluación de impacto y medidas reforzadas de protección de datos (RGPD) antes de activarse.",
            "q": "¿Qué requisitos tendrá?"
          },
          {
            "a": "Sí, está pensada para trabajar con Care Net Agenda.",
            "q": "¿Funcionará con la agenda?"
          }
        ],
        "to": [
          {
            "a": "No se contrata por separado: forma parte de Care Net, la solución completa.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "Al tratar datos de salud, requiere una evaluación de impacto y medidas reforzadas de protección de datos (RGPD) antes de activarse.",
            "q": "¿Qué requisitos tendrá?"
          },
          {
            "a": "Sí, está pensada para trabajar con la agenda de Care Net.",
            "q": "¿Funcionará con la agenda?"
          }
        ]
      },
      "terms": {
        "from": {
          "activation": "Todavía no se puede contratar: estará disponible próximamente."
        },
        "to": {
          "activation": "No se contrata por separado: forma parte de Care Net."
        }
      },
      "seo": {
        "from": {
          "slug": "gestion-clinica",
          "title": "Gestión clínica especializada (próximamente) | Big Elephant",
          "description": "Próximamente: historia y seguimiento especializados con ficha cifrada para centros de salud y bienestar."
        },
        "to": {
          "slug": "gestion-clinica",
          "title": "Gestión clínica especializada (parte de Care Net) | Big Elephant",
          "description": "Forma parte de Care Net: historia y seguimiento especializados con ficha cifrada para centros de salud y bienestar."
        }
      }
    }
  },
  {
    "key": "care-net-treatments",
    "inDirectSale": true,
    "fields": {
      "valueProposition": {
        "from": "En preparación: bonos y paquetes de sesiones con el saldo de cada cliente y su venta en el TPV del centro.",
        "to": "Forma parte de Care Net: bonos y paquetes de sesiones con el saldo de cada cliente y su venta en el TPV del centro."
      },
      "faq": {
        "from": [
          {
            "a": "Todavía no: está en preparación y no se puede contratar hasta que esté listo.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "Sí, con Care Net Agenda, que ya se implanta por separado.",
            "q": "¿Puedo reservar tratamientos mientras tanto?"
          },
          {
            "a": "Sí, de Care Net Complete.",
            "q": "¿Forma parte de algún paquete?"
          }
        ],
        "to": [
          {
            "a": "No se contrata por separado: forma parte de Care Net, la solución completa.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.",
            "q": "¿Puedo dejar mi interés?"
          },
          {
            "a": "Sí, con la agenda de Care Net.",
            "q": "¿Puedo reservar tratamientos mientras tanto?"
          },
          {
            "a": "Sí: Care Net es la solución completa que lo incluye.",
            "q": "¿Forma parte de Care Net?"
          }
        ]
      },
      "terms": {
        "from": {
          "activation": "Todavía no se puede contratar: está en preparación."
        },
        "to": {
          "activation": "No se contrata por separado: forma parte de Care Net."
        }
      }
    }
  },
  {
    "key": "social-token-net-communities",
    "inDirectSale": true,
    "fields": {
      "faq": {
        "from": [
          {
            "a": "Sí. Pulsa «Contratar ahora»: el módulo se activa en cuanto se confirma el pago.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí. Cada comunidad puede ser pública o privada, con invitaciones y roles de moderación.",
            "q": "¿Las comunidades pueden ser privadas?"
          },
          {
            "a": "Sí, de Social Token Net Complete, que incluye también Tokens internos. Si cambias a Complete conservas tus comunidades y solo pagas la diferencia prorrateada.",
            "q": "¿Forma parte de algún paquete?"
          },
          {
            "a": "No con este módulo: la venta en canales externos es de Venta multicanal.",
            "q": "¿Puedo vender entradas en otras plataformas?"
          }
        ],
        "to": [
          {
            "a": "Ya no se contrata por separado: forma parte de Social Token Net, la solución completa. Si ya lo tenías contratado, lo conservas.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "Sí. Cada comunidad puede ser pública o privada, con invitaciones y roles de moderación.",
            "q": "¿Las comunidades pueden ser privadas?"
          },
          {
            "a": "Sí: Social Token Net es la solución completa, que incluye también Tokens internos. Si cambias a Social Token Net conservas tus comunidades y solo pagas la diferencia prorrateada.",
            "q": "¿Forma parte de Social Token Net?"
          },
          {
            "a": "No con este módulo: la venta en canales externos es de Venta multicanal.",
            "q": "¿Puedo vender entradas en otras plataformas?"
          }
        ]
      },
      "terms": {
        "from": {
          "activation": "Activación automática: en cuanto se confirma el pago, las funcionalidades contratadas se añaden al administrador de tu empresa."
        },
        "to": {
          "activation": "Ya no se contrata por separado: forma parte de Social Token Net."
        }
      }
    }
  },
  {
    "key": "social-token-net-tokens",
    "inDirectSale": true,
    "fields": {
      "faq": {
        "from": [
          {
            "a": "Sí. Pulsa «Contratar ahora»: el módulo se activa en cuanto se confirma el pago.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "No. Son tokens internos sin valor monetario: solo se canjean por las recompensas que defines.",
            "q": "¿Los tokens tienen valor en dinero?"
          },
          {
            "a": "Cada canje genera un código de un solo uso que tu equipo comprueba y consume desde el panel.",
            "q": "¿Cómo se valida un canje?"
          },
          {
            "a": "Sí, de Social Token Net Complete, que incluye también Comunidades. Si cambias a Complete conservas los puntos y las recompensas y solo pagas la diferencia prorrateada.",
            "q": "¿Forma parte de algún paquete?"
          }
        ],
        "to": [
          {
            "a": "Ya no se contrata por separado: forma parte de Social Token Net, la solución completa. Si ya lo tenías contratado, lo conservas.",
            "q": "¿Puedo contratarlo ya?"
          },
          {
            "a": "No. Son tokens internos sin valor monetario: solo se canjean por las recompensas que defines.",
            "q": "¿Los tokens tienen valor en dinero?"
          },
          {
            "a": "Cada canje genera un código de un solo uso que tu equipo comprueba y consume desde el panel.",
            "q": "¿Cómo se valida un canje?"
          },
          {
            "a": "Sí: Social Token Net es la solución completa, que incluye también Comunidades. Si cambias a Social Token Net conservas los puntos y las recompensas y solo pagas la diferencia prorrateada.",
            "q": "¿Forma parte de Social Token Net?"
          }
        ]
      },
      "terms": {
        "from": {
          "activation": "Activación automática: en cuanto se confirma el pago, las funcionalidades contratadas se añaden al administrador de tu empresa."
        },
        "to": {
          "activation": "Ya no se contrata por separado: forma parte de Social Token Net."
        }
      }
    }
  }
];
