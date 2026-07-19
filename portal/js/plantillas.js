/* ============================================================
   Mapa de coordenadas para rellenar las plantillas PDF
   originales (pdf-lib, origen abajo-izquierda, puntos).

   Tipos:
   - numero: {page,x,y,size}
   - text:   [{key,page,x,y,size,maxW, date?}]
   - wrap:   [{key,page,x,y0,lh,maxW,size,maxLines}]  texto multilínea
   - triple: [{key,page,x,ys:[...],maxW,size}]        valor partido por "/"
   - items:  [{key,page,cantX,descX,y0,step,max,descMaxW,size}]
   - marks:  [{key,page,map:{valor:[[x,y],...]}}]     X según select
   - grid:   [{key,page,rows:{fila:y},opts:{opcion:x}}] checklist
   - sigs:   [{key,page,x,y,h,maxW}]                  imagen de firma
   - baterias: {page,xBanks:[...],yTop,step,max}      tabla UPS pág.2
   ============================================================ */
(function (root) {

const B = "Bien", M = "Mal", R = "Regular", NA = "N/A", NAC = "NAC", NP = "NP";
const SI = "Sí", NO = "No";

const PLANTILLAS = {

  /* ================= FORMATO DE ACTIVIDADES (A4 595x842) ================= */
  actividades: {
    file: "FORMATO DE ACTIVIDADES.pdf",
    text: [
      { key: "cliente", page: 0, x: 140, y: 710, size: 9, maxW: 165 },
      { key: "ciudad", page: 0, x: 380, y: 710, size: 9, maxW: 130 },
      { key: "direccion", page: 0, x: 148, y: 692, size: 9, maxW: 160 },
      { key: "fecha", page: 0, x: 370, y: 692, size: 9, maxW: 140, date: true },
      { key: "hora_servicio", page: 0, x: 95, y: 82, size: 9, maxW: 150 },
      { key: "nombre_funcionario", page: 0, x: 100, y: 112, size: 8 },
      { key: "nombre_trabajador", page: 0, x: 355, y: 112, size: 8 },
    ],
    items: [
      { key: "actividades", page: 0, cantX: 108, descX: 158, y0: 648, step: 11.3, max: 17, descMaxW: 380, size: 8 },
      { key: "materiales", page: 0, cantX: 108, descX: 158, y0: 406.5, step: 11.3, max: 19, descMaxW: 380, size: 8 },
    ],
    sigs: [
      { key: "firma_funcionario", page: 0, x: 100, y: 126, h: 30, maxW: 130 },
      { key: "firma_trabajador", page: 0, x: 355, y: 126, h: 30, maxW: 130 },
    ],
  },

  /* ================= REPORTE TÉCNICO UPS (carta, 3 pág) ================= */
  ups: {
    file: "Formato Mantenimiento de UPS 2017.pdf",
    numero: [{ page: 0, x: 415, y: 678, size: 10 }, { page: 2, x: 415, y: 696, size: 10 }],
    text: [
      { key: "cliente", page: 0, x: 112, y: 632, size: 8, maxW: 230 },
      { key: "fecha", page: 0, x: 390, y: 632, size: 8, maxW: 115, date: true },
      { key: "direccion", page: 0, x: 125, y: 615, size: 8, maxW: 200 },
      { key: "oficina", page: 0, x: 112, y: 599, size: 8, maxW: 70 },
      { key: "lugar", page: 0, x: 216, y: 599, size: 8, maxW: 100 },
      { key: "ciudad", page: 0, x: 372, y: 599, size: 8, maxW: 120 },
      { key: "marca", page: 0, x: 170, y: 582, size: 8, maxW: 110 },
      { key: "modelo", page: 0, x: 345, y: 582, size: 8, maxW: 90 },
      { key: "potencia", page: 0, x: 510, y: 582, size: 8, maxW: 60 },
      { key: "serie", page: 0, x: 93, y: 565, size: 7, maxW: 42 },
      { key: "inventario", page: 0, x: 163, y: 565, size: 7, maxW: 80 },
      { key: "bancos_baterias", page: 0, x: 120, y: 548, size: 7, maxW: 60 },
      { key: "referencia_baterias", page: 0, x: 382, y: 548, size: 7, maxW: 95 },
      { key: "voltaje_entrada", page: 0, x: 138, y: 290, size: 6.5, maxW: 128 },
      { key: "voltaje_salida", page: 0, x: 138, y: 236, size: 6.5, maxW: 128 },
      { key: "voltaje_bypass", page: 0, x: 138, y: 180, size: 6.5, maxW: 128 },
      { key: "voltaje_neutro_tierra", page: 0, x: 538, y: 241, size: 7, maxW: 38 },
      { key: "corriente_neutro", page: 0, x: 538, y: 228, size: 7, maxW: 38 },
      { key: "corriente_tierra", page: 0, x: 538, y: 214, size: 7, maxW: 38 },
      { key: "temperatura", page: 0, x: 393, y: 160, size: 8, maxW: 32 },
      { key: "voltaje_cargador", page: 0, x: 520, y: 163, size: 8, maxW: 55 },
      { key: "corriente_cargador", page: 0, x: 520, y: 147, size: 8, maxW: 50 },
      { key: "factor_potencia", page: 0, x: 158, y: 99, size: 8, maxW: 80 },
      { key: "duracion_mantenimiento", page: 2, x: 238, y: 335, size: 8, maxW: 150 },
      { key: "firma_nombre", page: 2, x: 150, y: 197, size: 8, maxW: 115 },
      { key: "firma_cargo", page: 2, x: 110, y: 185, size: 8, maxW: 150 },
      { key: "firma_telefono", page: 2, x: 125, y: 173, size: 8, maxW: 140 },
      { key: "firma_email", page: 2, x: 110, y: 161, size: 8, maxW: 150 },
      { key: "tecnico", page: 2, x: 390, y: 119.5, size: 8, maxW: 160 },
    ],
    triple: [
      { key: "corrientes_entrada", page: 0, x: 340, ys: [292, 280.5, 269], maxW: 38, size: 7 },
      { key: "corrientes_salida", page: 0, x: 340, ys: [238.5, 227, 215.5], maxW: 38, size: 7 },
      { key: "frecuencia", page: 0, x: 332, ys: [168, 154], maxW: 30, size: 8 },
      { key: "potencia_utilizada", page: 0, x: 210, ys: [124, 112], maxW: 55, size: 8 },
    ],
    wrap: [
      { key: "procedimiento", page: 0, x: 82, y0: 456.5, lh: 16.7, maxW: 460, size: 9, maxLines: 7 },
      { key: "diagnostico", page: 2, x: 82, y0: 290, lh: 16.7, maxW: 470, size: 9, maxLines: 5 },
    ],
    marks: [
      { key: "tipo_servicio", page: 0, map: {
        "A - Diagnóstico": [[388, 710]],
        "B - Mantenimiento preventivo": [[388, 698]],
        "C - Mantenimiento correctivo": [[388, 686.5]],
        "D - Instalación": [[388, 675]],
      }},
      { key: "tipo_servicio2", src: "tipo_servicio", page: 2, map: {
        "A - Diagnóstico": [[388, 730]],
        "B - Mantenimiento preventivo": [[388, 718.5]],
        "C - Mantenimiento correctivo": [[388, 707]],
        "D - Instalación": [[388, 695.5]],
      }},
      { key: "estado_equipo_inicio", page: 0, map: {
        "Energizado": [[249, 500]], "Desenergizado": [[362, 500]],
      }},
      { key: "condicion", page: 0, map: {
        "Garantía": [[417, 500]], "Contrato": [[471, 500]], "Orden de trabajo": [[580, 500]],
      }},
      { key: "voltajes_medidos", page: 0, map: {
        "Muy altos": [[578.5, 290]], "Aceptables": [[578.5, 278.5]], "Muy bajos": [[578.5, 267]],
      }},
      { key: "baterias_libres_mant", page: 0, map: {
        [SI]: [[421, 111]], [NO]: [[446, 111]],
      }},
      { key: "baterias_ubicacion", page: 0, map: {
        "Externas": [[282, 546], [394, 89]],
        "Internas": [[320, 546], [452, 89]],
        "Internas y externas": [[282, 546], [320, 546], [394, 89], [452, 89]],
      }},
    ],
    grid: [
      { key: "chk_baterias", page: 0,
        rows: { reposicion_electrolitico: 119.5, gravedad_especifica: 106.5, voltaje_cada_bateria: 93.5 },
        opts: { [SI]: 574 }, onlyYes: true },
      { key: "chk_final", page: 0,
        rows: { equipo_en_linea: 111 },
        opts: { [SI]: 306, [NO]: 340 } },
      { key: "chk_final_fs", src: "chk_final", page: 0,
        rows: { fuera_servicio: 89 },
        opts: { [SI]: 341 }, onlyYes: true },
      { key: "chk_inspeccion", page: 2,
        rows: { luces_displays: 627, extractores: 615, filtros_aire: 603.5, breakers: 591.5, ventilacion_cuarto: 579.5, aseo_cuarto: 567.5 },
        opts: { [B]: 174, [M]: 201, [R]: 243, [NA]: 272, [NAC]: 296, [NP]: 327 } },
      { key: "chk_riesgos", page: 2,
        rows: { material_metalico: 556, derrame_liquidos: 543.5, papeles_cuarto: 531, combustible_cuarto: 519, cuarto_deposito: 506 },
        opts: { [SI]: 303, [NO]: 332 } },
      { key: "chk_revision", page: 2,
        rows: { limpieza_equipo: 454.5, limpieza_baterias: 442.5, soplado_interno: 430.5, sonido_inversor: 418.5, sonido_ventiladores: 407 },
        opts: { [SI]: 255, [NO]: 282 } },
      { key: "chk_revision_der", src: "chk_revision", page: 2,
        rows: { revision_conectores: 454.5, retorqueo: 442.5, revision_tarjeteria: 430.5, sonidos_extranos: 418.5, cableado_bueno: 407 },
        opts: { [SI]: 520, [NO]: 547 } },
      { key: "chk_final_p3", src: "chk_final", page: 2,
        rows: { reparado: 360, equipo_en_linea: 347 },
        opts: { [SI]: 166, [NO]: 185 } },
      { key: "chk_final_p3b", src: "chk_final", page: 2,
        rows: { funcionando: 360, fuera_servicio: 347 },
        opts: { [SI]: 354, [NO]: 372 } },
      { key: "chk_final_p3c", src: "chk_final", page: 2,
        rows: { se_puede_reparar: 360 },
        opts: { [SI]: 516, [NO]: 545 } },
    ],
    baterias: { page: 1, xBanks: [110, 242, 374, 506], yTop: 581, step: 11.79, max: 40, size: 7,
      numero: { x: 440, y: 676, size: 10 }, bancoNoX: [70, 202, 334, 466], bancoNoY: 610 },
    sigs: [
      { key: "firma", page: 2, x: 110, y: 125, h: 28, maxW: 130 },
      { key: "firma_tecnico", page: 2, x: 430, y: 141, h: 26, maxW: 120 },
    ],
  },

  /* ============ MANTENIMIENTO PLANTAS ELÉCTRICAS (carta, 2 pág) ============ */
  plantas: {
    file: "FORMATO MANTENIMIENTO PLANTAS ELCTRICAS.pdf",
    numero: [{ page: 0, x: 485, y: 685, size: 10 }, { page: 1, x: 490, y: 672, size: 10 }],
    text: [
      { key: "fecha", page: 0, x: 105, y: 662, size: 8, maxW: 170, date: true },
      { key: "cliente", page: 0, x: 340, y: 662, size: 8, maxW: 210 },
      { key: "direccion", page: 0, x: 125, y: 651.5, size: 8, maxW: 200 },
      { key: "oficina", page: 0, x: 455, y: 651.5, size: 8, maxW: 100 },
      { key: "lugar", page: 0, x: 105, y: 637.5, size: 8, maxW: 190 },
      { key: "ciudad", page: 0, x: 340, y: 637.5, size: 8, maxW: 140 },
      { key: "motor_marca", page: 0, x: 140, y: 624.5, size: 8, maxW: 100 },
      { key: "motor_modelo", page: 0, x: 250, y: 624.5, size: 8, maxW: 85 },
      { key: "motor_potencia", page: 0, x: 348, y: 624.5, size: 8, maxW: 55 },
      { key: "gen_marca", page: 0, x: 155, y: 611.5, size: 8, maxW: 90 },
      { key: "gen_modelo", page: 0, x: 250, y: 611.5, size: 8, maxW: 85 },
      { key: "gen_potencia", page: 0, x: 348, y: 611.5, size: 8, maxW: 55 },
      { key: "baterias_ref", page: 0, x: 185, y: 598.5, size: 8, maxW: 110 },
      { key: "serie", page: 0, x: 300, y: 598.5, size: 8, maxW: 55 },
      { key: "inventario", page: 0, x: 358, y: 598.5, size: 8, maxW: 95 },
      { key: "voltaje_salida", page: 0, x: 140, y: 530, size: 7, maxW: 130 },
      { key: "breaker", page: 0, x: 462, y: 531, size: 7, maxW: 35 },
      { key: "voltaje_baterias", page: 0, x: 150, y: 447, size: 8, maxW: 35 },
      { key: "horometro", page: 1, x: 430, y: 426, size: 8, maxW: 125 },
      { key: "firma_nombre", page: 1, x: 150, y: 191, size: 8, maxW: 130 },
      { key: "firma_cargo", page: 1, x: 110, y: 178, size: 8, maxW: 160 },
      { key: "firma_telefono", page: 1, x: 125, y: 165, size: 8, maxW: 150 },
      { key: "firma_email", page: 1, x: 110, y: 152, size: 8, maxW: 160 },
      { key: "tecnico", page: 1, x: 365, y: 96, size: 8, maxW: 150 },
    ],
    triple: [
      { key: "corrientes_salida", page: 0, x: 278, ys: [529, 519, 509], maxW: 38, size: 7 },
      { key: "frecuencia", page: 0, x: 378, ys: [524, 504], maxW: 30, size: 8 },
    ],
    wrap: [
      { key: "trabajo_realizado", page: 1, x: 80, y0: 362, lh: 13, maxW: 470, size: 9, maxLines: 6 },
      { key: "observaciones", page: 1, x: 80, y0: 264, lh: 13, maxW: 470, size: 9, maxLines: 5 },
    ],
    marks: [
      { key: "combustible", page: 0, map: {
        "Gasolina": [[455, 622]], "Diesel": [[515, 622]], "Gas": [[580, 622]],
      }},
      { key: "condicion", page: 0, map: {
        "Garantía": [[100, 586]], "Contrato": [[160, 586]], "Orden de trabajo": [[258, 586]], "Solicitud escrita o telefónica": [[390, 586]],
      }},
      { key: "estado_equipo_inicio", page: 0, map: {
        "Energizado": [[470, 586]], "Desenergizado": [[556, 586]],
      }},
      { key: "precalentador", page: 0, map: { [SI]: [[527, 517]], [NO]: [[527, 504]] } },
      { key: "cargador_externo", page: 0, map: {
        "Bueno": [[350, 466]], "Malo": [[350, 454]],
      }},
      { key: "medidores", page: 0, map: {
        "Buenos": [[402, 466], [447, 466]], "Malos": [[402, 454], [447, 454]], "No tiene": [[402, 442], [447, 442]],
      }},
      { key: "funcionamiento_previo", page: 1, map: {
        "Correcto": [[222, 402]], "Incorrecto": [[302, 402]], "No saben": [[373, 402]],
      }},
    ],
    grid: [
      { key: "chk_motor", page: 0,
        rows: { presion_aceite: 400, filtro_aceite: 388.3, temperatura: 376.6, nivel_lubricante: 364.9, tension_correas: 353.2, nivel_combustible: 341.5, nivel_refrigerante: 329.8, drenaje_prefiltros: 318.1, motor_arranque: 289, alternador: 282 },
        opts: { [B]: 190, [M]: 218, [R]: 262, [NA]: 299, [NAC]: 324, [NP]: 356 } },
      { key: "chk_fugas", page: 0,
        rows: { fugas_aceite: 303.5, fugas_combustible: 296 },
        opts: { [SI]: 143, [NO]: 163 } },
      { key: "chk_sistema", page: 0,
        rows: { luces_displays: 240, extractores: 228.4, filtros_aire: 216.8, breakers: 205.2, ventilacion: 193.6, aseo: 182, protecciones: 170.4, cableado_senal: 158.8, cableado_potencia: 147.2 },
        opts: { [B]: 190, [M]: 218, [R]: 262, [NA]: 299, [NAC]: 324, [NP]: 356 } },
      { key: "chk_sitio", page: 0,
        rows: { material_metalico: 135.6, liquidos_derramados: 124, papeles_sitio: 112.4, combustible_ok: 100.8, sitio_deposito: 89.2 },
        opts: { [SI]: 471, [NO]: 514 } },
      { key: "chk_limpieza", page: 1,
        rows: { limpieza_equipo: 630.5, limpieza_baterias: 617.5, sonido_ventiladores: 604.5, sonido_motor: 591.5, sonido_arranque: 579 },
        opts: { [SI]: 248, [NO]: 284 } },
      { key: "chk_limpieza_der", src: "chk_limpieza", page: 1,
        rows: { revision_conectores: 630.5, retorqueo: 617.5, revision_tarjeteria: 604.5 },
        opts: { [SI]: 503, [NO]: 539 } },
      { key: "chk_tablero", page: 1,
        rows: { totalizador: 540.5, breaker_distribucion: 527.5 },
        opts: { [SI]: 248, [NO]: 284 } },
    ],
    pruebas: { page: 1,
      arranque_planta: { y: 464.5, si: 172, no: 207, bien: 254, mal: 292 },
      transferencia_manual: { y: 453, si: 172, no: 207, bien: 254, mal: 292 },
      transferencia_automatica: { y: 464.5, si: 424, no: 456, bien: 492, mal: 537 },
    },
    bateriasChk: { page: 0,
      libres: { si: [120, 463], no: [160, 463] },
      simple: {
        reposicion_electrolitico: [296, 493], gravedad_especifica: [296, 481],
        voltaje_cada_bateria: [296, 469], bornes_buenos: [296, 457], bornes_sulfatados: [296, 445],
      } },
    sigs: [
      { key: "firma", page: 1, x: 110, y: 99, h: 26, maxW: 130 },
      { key: "firma_tecnico", page: 1, x: 380, y: 116, h: 24, maxW: 110 },
    ],
  },

  /* ============ MANTENIMIENTO A.A (carta, 1 pág) ============ */
  aire: {
    file: "REPORTE TECNICO - A.A - DISTRI.pdf",
    numero: [{ page: 0, x: 440, y: 706, size: 9 }],
    text: [
      { key: "fecha", page: 0, x: 155, y: 706, size: 8, maxW: 100, date: true },
      { key: "cliente", page: 0, x: 155, y: 692, size: 8, maxW: 380 },
      { key: "ciudad", page: 0, x: 155, y: 680, size: 8, maxW: 180 },
      { key: "sucursal", page: 0, x: 398, y: 680, size: 8, maxW: 150 },
      { key: "direccion", page: 0, x: 155, y: 668, size: 8, maxW: 180 },
      { key: "telefono", page: 0, x: 403, y: 668, size: 8, maxW: 145 },
      { key: "contacto", page: 0, x: 155, y: 656, size: 8, maxW: 180 },
      { key: "area", page: 0, x: 402, y: 656, size: 8, maxW: 145 },
      { key: "marca", page: 0, x: 152, y: 641, size: 8, maxW: 140 },
      { key: "capacidad", page: 0, x: 152, y: 624, size: 8, maxW: 115 },
      { key: "ubicacion_manejadora", page: 0, x: 172, y: 602, size: 7, maxW: 72 },
      { key: "ubicacion_condensadora", page: 0, x: 172, y: 582, size: 7, maxW: 72 },
      { key: "manejadora_modelo", page: 0, x: 168, y: 563, size: 8, maxW: 175 },
      { key: "manejadora_serie", page: 0, x: 168, y: 549, size: 8, maxW: 175 },
      { key: "condensadora_modelo", page: 0, x: 168, y: 535, size: 8, maxW: 175 },
      { key: "condensadora_serie", page: 0, x: 168, y: 520, size: 8, maxW: 175 },
      { key: "hora_inicio", page: 0, x: 170, y: 492, size: 8, maxW: 160 },
      { key: "hora_fin", page: 0, x: 465, y: 492, size: 8, maxW: 115 },
      { key: "tecnico", page: 0, x: 152, y: 136, size: 8, maxW: 170 },
      { key: "cc_tecnico", page: 0, x: 152, y: 98, size: 8, maxW: 170 },
      { key: "firma_nombre", page: 0, x: 410, y: 136, size: 8, maxW: 170 },
      { key: "cc_cliente", page: 0, x: 410, y: 98, size: 8, maxW: 170 },
    ],
    wrap: [
      { key: "informe", page: 0, x: 52, y0: 455, lh: 11, maxW: 268, size: 8, maxLines: 26 },
      { key: "observaciones", page: 0, x: 336, y0: 270, lh: 11, maxW: 245, size: 8, maxLines: 6 },
      { key: "pendientes", page: 0, x: 336, y0: 200, lh: 11, maxW: 245, size: 8, maxLines: 5 },
    ],
    marks: [
      { key: "trabajo", page: 0, map: {
        "Garantía": [[463, 640]],
        "Mantenimiento preventivo": [[463, 623]],
        "Mantenimiento correctivo": [[463, 601]],
        "Instalación": [[463, 580]],
      }},
      { key: "tipo_servicio", page: 0, map: {
        "Laboratorio": [[569, 631]], "Visita": [[569, 588]],
      }},
      { key: "tipo_equipo", page: 0, map: {
        "Mini Split": [[463, 562]], "Piso Techo": [[463, 548]], "Cassete": [[463, 533]], "Paquete": [[463, 519]],
        "Ventana": [[569, 562]], "Split Central": [[569, 548]], "Portátil": [[569, 533]], "Precisión": [[569, 519]],
      }},
    ],
    grid: [
      { key: "chk_verificacion", page: 0,
        rows: { funcionamiento: 448.5, carga_refrigerante: 428, serpentin_condensador: 407.5, serpentin_manejadora: 384.5, filtros_aire: 363, ventilador_condensador: 343, ventilador_manejadora: 320, bomba_condensado: 300.5 },
        opts: { "Bueno": 425, "Regular": 444, "Malo": 461 } },
      { key: "chk_verificacion_der", src: "chk_verificacion", page: 0,
        rows: { revision_escapes: 428, aislamiento: 407.5, soportes: 384.5, breakers: 343, contactores: 320, cableado: 300.5 },
        opts: { "Bueno": 545, "Regular": 564, "Malo": 583 } },
    ],
    sigs: [
      { key: "firma_tecnico", page: 0, x: 160, y: 110, h: 26, maxW: 150 },
      { key: "firma", page: 0, x: 415, y: 110, h: 26, maxW: 150 },
    ],
  },

  /* ============ REPORTE TÉCNICO CCTV (carta, 1 pág) ============ */
  cctv: {
    file: "REPORTE TECNICO CCTV.pdf",
    text: [
      { key: "cliente", page: 0, x: 112, y: 608, size: 8, maxW: 225 },
      { key: "fecha", page: 0, x: 112, y: 593, size: 8, maxW: 225, date: true },
      { key: "direccion", page: 0, x: 125, y: 577, size: 8, maxW: 210 },
      { key: "ciudad", page: 0, x: 112, y: 563, size: 8, maxW: 95 },
      { key: "lugar", page: 0, x: 245, y: 563, size: 8, maxW: 90 },
      { key: "equipo", page: 0, x: 112, y: 547, size: 8, maxW: 55 },
      { key: "marca", page: 0, x: 190, y: 547, size: 8, maxW: 145 },
      { key: "serie", page: 0, x: 112, y: 530, size: 8, maxW: 225 },
      { key: "modelo", page: 0, x: 118, y: 513, size: 8, maxW: 220 },
      { key: "firma_nombre", page: 0, x: 140, y: 209, size: 8, maxW: 110 },
      { key: "firma_cargo", page: 0, x: 110, y: 196, size: 8, maxW: 140 },
      { key: "firma_telefono", page: 0, x: 125, y: 185.5, size: 8, maxW: 130 },
      { key: "firma_email", page: 0, x: 110, y: 173.5, size: 8, maxW: 140 },
      { key: "tecnico", page: 0, x: 390, y: 131, size: 8, maxW: 155 },
    ],
    wrap: [
      { key: "detalles", page: 0, x: 340, y0: 441, lh: 11, maxW: 210, size: 8, maxLines: 5 },
      { key: "diagnostico", page: 0, x: 80, y0: 290, lh: 11, maxW: 460, size: 8, maxLines: 6 },
    ],
    marks: [
      { key: "tecnologia", page: 0, map: { "IP": [[475, 609]], "Análoga": [[514, 609]] } },
      { key: "tipo_camara", page: 0, map: {
        "Domo PTZ": [[467.5, 580]], "Fija bala": [[467.5, 564.5]], "Fija mini domo": [[467.5, 549]],
        "Fija con housing": [[467.5, 526.5]], "Fija 360°": [[467.5, 514.5]],
      }},
    ],
    grid: [
      { key: "chk_componentes", page: 0,
        rows: { estado_fisico: 463, acrilico: 452, fuente_dc: 441, balums: 430, cableado: 419, voltaje_alimentacion: 408, dvr_nvr: 397 },
        opts: { [B]: 175, [M]: 199, [R]: 242, [NA]: 272, [NAC]: 294, [NP]: 326 } },
      { key: "chk_tareas", page: 0,
        rows: { ajuste_conectores: 382, limpieza_equipo: 370, limpieza_lente: 358, camara_operativa: 345.5 },
        opts: { [SI]: 172, [NO]: 199 } },
    ],
    sigs: [
      { key: "firma", page: 0, x: 110, y: 139, h: 28, maxW: 130 },
      { key: "firma_tecnico", page: 0, x: 425, y: 152, h: 24, maxW: 95 },
    ],
  },
};

if (typeof module !== "undefined" && module.exports) module.exports = PLANTILLAS;
else root.PLANTILLAS = PLANTILLAS;

})(typeof window !== "undefined" ? window : globalThis);
