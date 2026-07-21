/* ============================================================
   Mapa de coordenadas para rellenar las plantillas PDF
   originales (pdf-lib, origen abajo-izquierda, puntos).

   Las coordenadas salen de medir la propia plantilla: cada dato cae
   justo encima de su línea de relleno y dentro del ancho disponible.

   Tipos:
   - numero: [{page,x,y,size,maxW,c}]
   - text:   [{key,page,x,y,size,maxW, date?, c?, join?, sep?}]
   - wrap:   [{key,page,x,y0,lh,maxW,size,maxLines}]  texto multilínea
   - triple: [{key,page,x,ys:[...],maxW,size,c}]      valor partido por "/"
   - slots:  [{key,page,size,at:[[x,y,ancho],...]}]   valor "/" en casillas sueltas
   - items:  [{key,page,cantX,cantW,descX,y0,step,max,descMaxW,size}]
   - marks:  [{key,page,map:{valor:[[x,y],...]}}]     X centrada en (x,y)
   - grid:   [{key,page,rows:{fila:y},opts:{opcion:x}}] checklist (centros)
   - sigs:   [{key,page,x|cx,y,h,maxW}]               imagen de firma
   - baterias: {page,xBanks:[...],colW,yTop,step,max} tabla UPS pág.2

   Notas:
   - c: 1        centra el valor dentro de [x, x+maxW]
   - join: [...] concatena otros campos en la misma línea
   - cx          centra la firma horizontalmente en ese punto
   - en marks y grid, (x,y) es el CENTRO de la casilla, no su esquina
   ============================================================ */
(function (root) {

const B = "Bien", M = "Mal", R = "Regular", NA = "N/A", NAC = "NAC", NP = "NP";
const SI = "Sí", NO = "No";

const PLANTILLAS = {

  /* ===== FORMATO DE ACTIVIDADES (A4 595x842) ===== */
  actividades: {
    file: "FORMATO DE ACTIVIDADES.pdf",
    text: [
      { key: "cliente", page: 0, x: 139.2, y: 714.2, size: 9, maxW: 181, c: 1 },
      { key: "ciudad", page: 0, x: 369.8, y: 714.2, size: 9, maxW: 130.9, c: 1 },
      { key: "direccion", page: 0, x: 148.7, y: 691.4, size: 9, maxW: 175.8, c: 1 },
      { key: "fecha", page: 0, x: 367, y: 691.4, size: 9, maxW: 136, date: true, c: 1 },
      { key: "hora_servicio", page: 0, x: 87.2, y: 90.4, size: 9, maxW: 145.6, c: 1 },
      { key: "nombre_funcionario", page: 0, x: 85.1, y: 122, size: 8, maxW: 150, c: 1 },
      { key: "nombre_trabajador", page: 0, x: 332.9, y: 122, size: 8, maxW: 155, c: 1 },
    ],
    items: [
      { key: "actividades", page: 0, cantX: 83.9, cantW: 62.7, descX: 153, y0: 642.3, step: 12, max: 16, descMaxW: 356, size: 8 },
      { key: "materiales", page: 0, cantX: 83.9, cantW: 62.7, descX: 153, y0: 410.2, step: 12, max: 18, descMaxW: 356, size: 8 },
    ],
    sigs: [
      { key: "firma_funcionario", page: 0, cx: 160, y: 149, h: 26, maxW: 130 },
      { key: "firma_trabajador", page: 0, cx: 410, y: 149, h: 26, maxW: 130 },
    ],
  },

  /* ===== REPORTE TÉCNICO UPS (carta, 3 pág) ===== */
  ups: {
    file: "Formato Mantenimiento de UPS 2017.pdf",
    numero: [
      { page: 0, x: 403.3, y: 680.7, size: 7.5, maxW: 78.5, c: 1 },
      { page: 2, x: 403.3, y: 700.2, size: 7.5, maxW: 78.5, c: 1 },
    ],
    text: [
      { key: "cliente", page: 0, x: 96.3, y: 629.5, size: 8, maxW: 260.2, c: 1 },
      { key: "fecha", page: 0, x: 396.8, y: 629.5, size: 8, maxW: 82.4, date: true, c: 1 },
      { key: "direccion", page: 0, x: 105, y: 611.8, size: 8, maxW: 207.8, c: 1 },
      { key: "oficina", page: 0, x: 87.7, y: 594.2, size: 8, maxW: 92.1, c: 1 },
      { key: "lugar", page: 0, x: 219, y: 594.2, size: 8, maxW: 93.8, c: 1 },
      { key: "ciudad", page: 0, x: 378.8, y: 594.2, size: 8, maxW: 201.2, c: 1 },
      { key: "marca", page: 0, x: 175.2, y: 576.5, size: 8, maxW: 129.3, c: 1 },
      { key: "modelo", page: 0, x: 344.7, y: 576.5, size: 8, maxW: 90.8, c: 1 },
      { key: "potencia", page: 0, x: 484.2, y: 576.5, size: 8, maxW: 95.8, c: 1 },
      /* la plantilla trae una sola línea para serie/inventario */
      { key: "serie", page: 0, x: 175.2, y: 558.9, size: 7, maxW: 137.6, c: 1, join: ["inventario"] },
      { key: "bancos_baterias", page: 0, x: 122, y: 541.2, size: 7, maxW: 15.2, c: 1 },
      { key: "baterias_cantidad", page: 0, x: 192.5, y: 541.2, size: 7, maxW: 23.5, c: 1 },
      { key: "referencia_baterias", page: 0, x: 387.3, y: 541.2, size: 7, maxW: 67.4, c: 1 },
      { key: "marca_baterias", page: 0, x: 491.8, y: 541.2, size: 7, maxW: 89.2, c: 1 },
      { key: "voltaje_neutro_tierra", page: 0, x: 492, y: 247.7, size: 7, maxW: 41.5, c: 1 },
      { key: "corriente_neutro", page: 0, x: 492, y: 230, size: 7, maxW: 41.5, c: 1 },
      { key: "corriente_tierra", page: 0, x: 492, y: 212.4, size: 7, maxW: 41.5, c: 1 },
      { key: "temperatura", page: 0, x: 380, y: 150.1, size: 8, maxW: 40, c: 1 },
      { key: "voltaje_cargador", page: 0, x: 446.3, y: 167.7, size: 8, maxW: 115, c: 1 },
      { key: "corriente_cargador", page: 0, x: 519, y: 139.1, size: 8, maxW: 54, c: 1 },
      { key: "factor_potencia", page: 0, x: 146.8, y: 94.9, size: 8, maxW: 17, c: 1 },
      { key: "duracion_mantenimiento", page: 2, x: 237.2, y: 331, size: 8, maxW: 75.6, c: 1 },
      { key: "firma_nombre", page: 2, x: 140.2, y: 199, size: 8, maxW: 109.8, c: 1 },
      { key: "firma_cargo", page: 2, x: 96.3, y: 187, size: 8, maxW: 153.7, c: 1 },
      { key: "firma_telefono", page: 2, x: 114.5, y: 175, size: 8, maxW: 135.5, c: 1 },
      { key: "firma_email", page: 2, x: 96.3, y: 163, size: 8, maxW: 153.7, c: 1 },
      { key: "tecnico", page: 2, x: 396.8, y: 121, size: 8, maxW: 152.9, c: 1 },
    ],
    triple: [
      { key: "corrientes_entrada", page: 0, x: 335.2, ys: [294.8, 283, 271.2], maxW: 39.6, size: 7, c: 1 },
      { key: "corrientes_salida", page: 0, x: 335.2, ys: [236, 224.2, 212.5], maxW: 39.6, size: 7, c: 1 },
      { key: "frecuencia", page: 0, x: 314, ys: [161.9, 150.1], maxW: 45, size: 8, c: 1 },
      { key: "potencia_utilizada", page: 0, x: 186, ys: [121, 112.2], maxW: 54, size: 8, c: 1 },
    ],
    /* VAB/VBC/VCA y VAN/VBN/VCN de cada bloque de voltajes */
    slots: [
      { key: "voltaje_entrada", page: 0, size: 6.5, at: [
        [148.8, 294.8, 31], [148.8, 283, 31], [148.8, 271.2, 31],
        [219, 294.8, 31], [219, 283, 31], [219, 271.2, 31]] },
      { key: "voltaje_salida", page: 0, size: 6.5, at: [
        [148.8, 236, 31], [148.8, 224.2, 31], [148.8, 212.5, 31],
        [219, 236, 31], [219, 224.2, 31], [219, 212.5, 31]] },
      { key: "voltaje_bypass", page: 0, size: 6.5, at: [
        [148.8, 171.3, 31], [148.8, 159.5, 31], [148.8, 147.8, 31],
        [219, 171.3, 31], [219, 159.5, 31], [219, 147.8, 31]] },
    ],
    wrap: [
      { key: "procedimiento", page: 0, x: 52, y0: 461.8, lh: 17.75, maxW: 528, size: 9, maxLines: 7 },
      { key: "diagnostico", page: 2, x: 52, y0: 293.2, lh: 16.55, maxW: 508, size: 9, maxLines: 5 },
    ],
    marks: [
      { key: "tipo_servicio", page: 0, map: { "A - Diagnóstico": [[389.8, 716.2]], "B - Mantenimiento preventivo": [[389.8, 704.4]], "C - Mantenimiento correctivo": [[389.8, 692.5]], "D - Instalación": [[389.8, 680.9]] } },
      { key: "tipo_servicio2", src: "tipo_servicio", page: 2, map: { "A - Diagnóstico": [[389.8, 735.5]], "B - Mantenimiento preventivo": [[389.8, 723.9]], "C - Mantenimiento correctivo": [[389.8, 712]], "D - Instalación": [[389.8, 700.3]] } },
      { key: "estado_equipo_inicio", page: 0, map: { Energizado: [[247.4, 504.5]], Desenergizado: [[337.3, 504.5]] } },
      { key: "condicion", page: 0, map: { "Garantía": [[398.6, 504.5]], Contrato: [[468.7, 504.5]], "Orden de trabajo": [[578.3, 504.5]] } },
      { key: "voltajes_medidos", page: 0, map: { "Muy altos": [[578.3, 290.3]], Aceptables: [[578.3, 278.6]], "Muy bajos": [[578.3, 266.8]] } },
      { key: "baterias_libres_mant", page: 0, map: { "Sí": [[424.9, 111]], No: [[451.2, 111]] } },
      { key: "baterias_ubicacion", page: 0, map: { Externas: [[282.5, 545.5], [398.6, 93.4]], Internas: [[319.8, 545.5], [451.2, 93.4]], "Internas y externas": [[282.5, 545.5], [319.8, 545.5], [398.6, 93.4], [451.2, 93.4]] } },
    ],
    grid: [
      { key: "chk_baterias", page: 0, rows: { reposicion_electrolitico: 122.7, gravedad_especifica: 111, voltaje_cada_bateria: 99.2 }, opts: { "Sí": 578.3 }, onlyYes: true },
      { key: "chk_final", page: 0, rows: { equipo_en_linea: 111 }, opts: { "Sí": 311, No: 346.1 } },
      { key: "chk_final_fs", src: "chk_final", page: 0, rows: { fuera_servicio: 93.4 }, opts: { "Sí": 337.3 }, onlyYes: true },
      { key: "chk_inspeccion", page: 2, rows: { luces_displays: 632.5, extractores: 620.5, filtros_aire: 608.5, breakers: 596.5, ventilacion_cuarto: 584.5, aseo_cuarto: 572.5 }, opts: { Bien: 177.3, Mal: 203.6, Regular: 247.4, "N/A": 273.7, NAC: 300, NP: 328.5 } },
      { key: "chk_riesgos", page: 2, rows: { material_metalico: 560.5, derrame_liquidos: 548.5, papeles_cuarto: 536.5, combustible_cuarto: 524.5, cuarto_deposito: 512.5 }, opts: { "Sí": 300, No: 328.5 } },
      { key: "chk_revision", page: 2, rows: { limpieza_equipo: 458.5, limpieza_baterias: 446.5, soplado_interno: 434.5, sonido_inversor: 422.5, sonido_ventiladores: 410.5 }, opts: { "Sí": 256.2, No: 291.3 } },
      { key: "chk_revision_der", src: "chk_revision", page: 2, rows: { revision_conectores: 458.5, retorqueo: 446.5, revision_tarjeteria: 434.5, sonidos_extranos: 422.5, cableado_bueno: 410.5 }, opts: { "Sí": 521.3, No: 556.3 } },
      { key: "chk_final_p3", src: "chk_final", page: 2, rows: { reparado: 365.5, equipo_en_linea: 353.5 }, opts: { "Sí": 168.6, No: 194.8 } },
      { key: "chk_final_p3b", src: "chk_final", page: 2, rows: { funcionando: 365.5, fuera_servicio: 353.5 }, opts: { "Sí": 354.8, No: 381.1 } },
      { key: "chk_final_p3c", src: "chk_final", page: 2, rows: { se_puede_reparar: 365.5 }, opts: { "Sí": 521.3, No: 547.5 } },
    ],
    baterias: { page: 1, xBanks: [98.8, 232, 365.2, 501.4], colW: 70.5, yTop: 582.1, step: 11.759, max: 40, size: 7, numero: { x: 428, y: 672, size: 7.5, maxW: 78, c: 1 }, bancoNoX: [71, 204, 337, 470], bancoNoY: 613 },
    sigs: [
      { key: "firma", page: 2, x: 110, y: 125, h: 28, maxW: 130 },
      { key: "firma_tecnico", page: 2, x: 430, y: 141, h: 26, maxW: 120 },
    ],
  },

  /* ===== MANTENIMIENTO PLANTAS ELÉCTRICAS (carta, 2 pág) ===== */
  plantas: {
    file: "FORMATO MANTENIMIENTO PLANTAS ELCTRICAS.pdf",
    numero: [
      { page: 0, x: 474, y: 687.9, size: 7.5, maxW: 74.5, c: 1 },
      { page: 1, x: 474, y: 674.5, size: 7.5, maxW: 74.5, c: 1 },
    ],
    text: [
      { key: "fecha", page: 0, x: 91.7, y: 660.8, size: 8, maxW: 192, date: true, c: 1 },
      { key: "cliente", page: 0, x: 348.2, y: 660.8, size: 8, maxW: 199.8, c: 1 },
      { key: "direccion", page: 0, x: 101, y: 649.2, size: 8, maxW: 182.7, c: 1 },
      { key: "oficina", page: 0, x: 449.7, y: 649.2, size: 8, maxW: 98.3, c: 1 },
      { key: "lugar", page: 0, x: 91.7, y: 637.7, size: 8, maxW: 192, c: 1 },
      { key: "ciudad", page: 0, x: 338.8, y: 637.7, size: 8, maxW: 209.2, c: 1 },
      { key: "motor_marca", page: 0, x: 117.3, y: 626.2, size: 8, maxW: 72.7, c: 1 },
      { key: "motor_modelo", page: 0, x: 228.2, y: 626.2, size: 8, maxW: 72.6, c: 1 },
      { key: "motor_potencia", page: 0, x: 348.2, y: 626.2, size: 8, maxW: 54.1, c: 1 },
      { key: "gen_marca", page: 0, x: 134.3, y: 614.7, size: 8, maxW: 72.7, c: 1 },
      { key: "gen_modelo", page: 0, x: 245.2, y: 614.7, size: 8, maxW: 55.6, c: 1 },
      { key: "gen_potencia", page: 0, x: 356, y: 614.7, size: 8, maxW: 38.5, c: 1 },
      { key: "baterias_ref", page: 0, x: 167.5, y: 603.2, size: 8, maxW: 70, c: 1 },
      { key: "serie", page: 0, x: 284, y: 603.2, size: 7, maxW: 27, c: 1 },
      { key: "inventario", page: 0, x: 351, y: 603.2, size: 7, maxW: 116, c: 1 },
      { key: "breaker", page: 0, x: 457.2, y: 528.5, size: 7, maxW: 32.1, c: 1 },
      { key: "voltaje_baterias", page: 0, x: 141, y: 444.3, size: 8, maxW: 34, c: 1 },
      { key: "horometro", page: 1, x: 448, y: 425.7, size: 8, maxW: 106, c: 1 },
      { key: "firma_nombre", page: 1, x: 142.8, y: 188.7, size: 8, maxW: 140.9, c: 1 },
      { key: "firma_cargo", page: 1, x: 82, y: 178, size: 8, maxW: 200, c: 1 },
      { key: "firma_telefono", page: 1, x: 95, y: 166.5, size: 8, maxW: 187, c: 1 },
      { key: "firma_email", page: 1, x: 82, y: 154.9, size: 8, maxW: 200, c: 1 },
      { key: "tecnico", page: 1, x: 304.5, y: 90.8, size: 8, maxW: 243.8, c: 1 },
    ],
    triple: [
      { key: "corrientes_salida", page: 0, x: 278.2, ys: [528.5, 516.9, 505.4], maxW: 40.6, size: 7, c: 1 },
      { key: "frecuencia", page: 0, x: 380, ys: [522.7, 505.4], maxW: 33, size: 8, c: 1 },
    ],
    /* VAB/VBC/VCA y VAN/VBN/VCN del generador */
    slots: [
      { key: "voltaje_salida", page: 0, size: 6.5, at: [
        [150.3, 540, 23.4], [150.3, 522.7, 23.4], [150.3, 505.4, 23.4],
        [218.7, 540, 23.5], [218.7, 522.7, 23.5], [218.7, 505.4, 23.5]] },
    ],
    wrap: [
      { key: "trabajo_realizado", page: 1, x: 50, y0: 371, lh: 13, maxW: 496, size: 9, maxLines: 5 },
      { key: "observaciones", page: 1, x: 50, y0: 273, lh: 13, maxW: 496, size: 9, maxLines: 5 },
    ],
    marks: [
      { key: "combustible", page: 0, map: { Gasolina: [[453.8, 629.4]], Diesel: [[507.7, 629.4]], Gas: [[542, 629.4]] } },
      { key: "condicion", page: 0, map: { "Garantía": [[101, 594.8]], Contrato: [[161.8, 594.8]], "Orden de trabajo": [[254.4, 594.8]], "Solicitud escrita o telefónica": [[389.5, 594.8]] } },
      { key: "estado_equipo_inicio", page: 0, map: { Energizado: [[458.3, 594.8]], Desenergizado: [[529, 594.8]] } },
      { key: "precalentador", page: 0, map: { "Sí": [[528.9, 519.9]], No: [[530.3, 508.4]] } },
      { key: "cargador_externo", page: 0, map: { Bueno: [[348, 462.3]], Malo: [[345, 450.8]] } },
      { key: "medidores", page: 0, map: { Buenos: [[399, 468.1], [450.5, 468.1]], Malos: [[395, 456.5], [446.5, 456.5]], "No tiene": [[401, 445], [452, 445]] } },
      { key: "funcionamiento_previo", page: 1, map: { Correcto: [[216.5, 405.1]], Incorrecto: [[298.5, 405.1]], "No saben": [[369.7, 405.1]] } },
    ],
    grid: [
      { key: "chk_motor", page: 0, rows: { presion_aceite: 404.7, filtro_aceite: 393.2, temperatura: 381.7, nivel_lubricante: 370.1, tension_correas: 358.6, nivel_combustible: 347.1, nivel_refrigerante: 335.6, drenaje_prefiltros: 324, motor_arranque: 289.5, alternador: 278 }, opts: { Bien: 188.5, Mal: 221.7, Regular: 268.6, "N/A": 294.3, NAC: 323.8, NP: 354.3 } },
      { key: "chk_fugas", page: 0, rows: { fugas_aceite: 312.5, fugas_combustible: 301 }, opts: { "Sí": 131.1, No: 156 } },
      { key: "chk_sistema", page: 0, rows: { luces_displays: 243.4, extractores: 231.9, filtros_aire: 220.3, breakers: 208.8, ventilacion: 197.3, aseo: 185.8, protecciones: 174.3, cableado_senal: 162.7, cableado_potencia: 151.2 }, opts: { Bien: 188.5, Mal: 221.7, Regular: 268.6, "N/A": 294.3, NAC: 323.8, NP: 354.3 } },
      { key: "chk_sitio", page: 0, rows: { material_metalico: 139.7, liquidos_derramados: 128.2, papeles_sitio: 116.7, combustible_ok: 105.1, sitio_deposito: 93.6 }, opts: { "Sí": 322.9, No: 352 } },
      { key: "chk_limpieza", page: 1, rows: { limpieza_equipo: 629.7, limpieza_baterias: 618.2, sonido_ventiladores: 606.7, sonido_motor: 595.2, sonido_arranque: 583.7 }, opts: { "Sí": 251.1, No: 288.1 } },
      { key: "chk_limpieza_der", src: "chk_limpieza", page: 1, rows: { revision_conectores: 629.7, retorqueo: 618.2, revision_tarjeteria: 606.7 }, opts: { "Sí": 506.7, No: 543.7 } },
      { key: "chk_tablero", page: 1, rows: { totalizador: 543.3, breaker_distribucion: 531.8 }, opts: { "Sí": 251.1, No: 288.1 } },
    ],
    pruebas: { page: 1, arranque_planta: { y: 468.4, si: 172, no: 209, bien: 248, mal: 289 }, transferencia_manual: { y: 456.9, si: 172, no: 209, bien: 248, mal: 289 }, transferencia_automatica: { y: 468.4, si: 427, no: 464.5, bien: 503, mal: 544 } },
    bateriasChk: { page: 0, libres: { si: [121, 462.3], no: [166, 462.3] }, simple: { reposicion_electrolitico: [296, 491.1], gravedad_especifica: [296, 479.6], voltaje_cada_bateria: [296, 468.1], bornes_buenos: [296, 458.6], bornes_sulfatados: [296, 447.1] } },
    sigs: [
      { key: "firma", page: 1, x: 110, y: 99, h: 26, maxW: 130 },
      { key: "firma_tecnico", page: 1, x: 380, y: 116, h: 24, maxW: 110 },
    ],
  },

  /* ===== MANTENIMIENTO A.A (carta, 1 pág) ===== */
  aire: {
    file: "REPORTE TECNICO - A.A - DISTRI.pdf",
    /* Esta plantilla es una tabla: cada dato va centrado en su celda. */
    numero: [
      { page: 0, x: 430.2, y: 706.1, size: 9, maxW: 152.7, c: 1 },
    ],
    text: [
      { key: "fecha", page: 0, x: 148.2, y: 706.1, size: 8, maxW: 179.5, date: true, c: 1 },
      { key: "cliente", page: 0, x: 148.2, y: 693.4, size: 8, maxW: 434.7, c: 1 },
      { key: "ciudad", page: 0, x: 148.2, y: 680.6, size: 8, maxW: 179.5, c: 1 },
      { key: "sucursal", page: 0, x: 430.2, y: 680.6, size: 8, maxW: 152.7, c: 1 },
      { key: "direccion", page: 0, x: 148.2, y: 667.9, size: 8, maxW: 179.5, c: 1 },
      { key: "telefono", page: 0, x: 430.2, y: 667.9, size: 8, maxW: 152.7, c: 1 },
      { key: "contacto", page: 0, x: 148.2, y: 655.6, size: 8, maxW: 179.5, c: 1 },
      { key: "area", page: 0, x: 430.2, y: 655.6, size: 8, maxW: 152.7, c: 1 },
      { key: "marca", page: 0, x: 168.2, y: 642.6, size: 8, maxW: 159.5, c: 1 },
      { key: "capacidad", page: 0, x: 168.2, y: 625.7, size: 8, maxW: 98.9, c: 1 },
      { key: "ubicacion_manejadora", page: 0, x: 168.2, y: 603.3, size: 8, maxW: 159.5, c: 1 },
      { key: "ubicacion_condensadora", page: 0, x: 168.2, y: 581.9, size: 8, maxW: 159.5, c: 1 },
      { key: "manejadora_modelo", page: 0, x: 168.2, y: 564.1, size: 8, maxW: 159.5, c: 1 },
      { key: "manejadora_serie", page: 0, x: 168.2, y: 549.8, size: 8, maxW: 159.5, c: 1 },
      { key: "condensadora_modelo", page: 0, x: 168.2, y: 535.5, size: 8, maxW: 159.5, c: 1 },
      { key: "condensadora_serie", page: 0, x: 168.2, y: 521.2, size: 8, maxW: 159.5, c: 1 },
      { key: "hora_inicio", page: 0, x: 168.2, y: 492.4, size: 8, maxW: 159.5, c: 1 },
      { key: "hora_fin", page: 0, x: 464.3, y: 492.4, size: 8, maxW: 118.6, c: 1 },
      { key: "tecnico", page: 0, x: 148.2, y: 135.2, size: 8, maxW: 179.5, c: 1 },
      { key: "cc_tecnico", page: 0, x: 148.2, y: 97.2, size: 8, maxW: 179.5, c: 1 },
      { key: "firma_nombre", page: 0, x: 430.2, y: 135.2, size: 8, maxW: 152.7, c: 1 },
      { key: "cc_cliente", page: 0, x: 430.2, y: 97.2, size: 8, maxW: 152.7, c: 1 },
    ],
    wrap: [
      { key: "informe", page: 0, x: 54, y0: 455, lh: 11, maxW: 272, size: 8, maxLines: 26 },
      { key: "observaciones", page: 0, x: 332, y0: 273, lh: 11, maxW: 250, size: 8, maxLines: 5 },
      { key: "pendientes", page: 0, x: 332, y0: 200.7, lh: 11, maxW: 250, size: 8, maxLines: 4 },
    ],
    marks: [
      { key: "trabajo", page: 0, map: { "Garantía": [[470.1, 645.5]], "Mantenimiento preventivo": [[470.1, 627.6]], "Mantenimiento correctivo": [[470.1, 606.2]], "Instalación": [[470.1, 584.9]] } },
      { key: "tipo_servicio", page: 0, map: { Laboratorio: [[576, 634.7]], Visita: [[576, 595.5]] } },
      { key: "tipo_equipo", page: 0, map: { "Mini Split": [[470.3, 567.4]], "Piso Techo": [[470.3, 553.1]], Cassete: [[470.3, 538.8]], Paquete: [[470.3, 524.4]], Ventana: [[576, 567.4]], "Split Central": [[576, 553.1]], "Portátil": [[576, 538.8]], "Precisión": [[576, 524.4]] } },
    ],
    grid: [
      { key: "chk_verificacion", page: 0, rows: { funcionamiento: 453.2, carga_refrigerante: 432, serpentin_condensador: 410.6, serpentin_manejadora: 389.2, filtros_aire: 367.8, ventilador_condensador: 346.4, ventilador_manejadora: 324.9, bomba_condensado: 303.6 }, opts: { Bueno: 420.4, Regular: 436.6, Malo: 453.8 } },
      { key: "chk_verificacion_der", src: "chk_verificacion", page: 0, rows: { revision_escapes: 432, aislamiento: 410.6, soportes: 389.2, breakers: 346.4, contactores: 324.9, cableado: 303.6 }, opts: { Bueno: 538.4, Regular: 557.6, Malo: 576.2 } },
    ],
    sigs: [
      { key: "firma_tecnico", page: 0, cx: 238, y: 110, h: 17, maxW: 150 },
      { key: "firma", page: 0, cx: 506.5, y: 110, h: 17, maxW: 130 },
    ],
  },

  /* ===== REPORTE TÉCNICO CCTV (carta, 1 pág) ===== */
  cctv: {
    file: "REPORTE TECNICO CCTV.pdf",
    text: [
      { key: "cliente", page: 0, x: 111.5, y: 608.9, size: 8, maxW: 213.5, c: 1 },
      { key: "fecha", page: 0, x: 111.5, y: 592.1, size: 8, maxW: 213.5, date: true, c: 1 },
      { key: "direccion", page: 0, x: 120, y: 578.5, size: 8, maxW: 205, c: 1 },
      { key: "ciudad", page: 0, x: 103, y: 563.8, size: 8, maxW: 92.5, c: 1 },
      { key: "lugar", page: 0, x: 234.2, y: 563.8, size: 8, maxW: 90.8, c: 1 },
      { key: "equipo", page: 0, x: 103, y: 546.5, size: 8, maxW: 49.8, c: 1 },
      { key: "marca", page: 0, x: 191, y: 546.5, size: 8, maxW: 134, c: 1 },
      { key: "serie", page: 0, x: 103, y: 529.2, size: 8, maxW: 222, c: 1 },
      { key: "modelo", page: 0, x: 111.5, y: 511.9, size: 8, maxW: 213.5, c: 1 },
      { key: "firma_nombre", page: 0, x: 137, y: 208.4, size: 8, maxW: 109, c: 1 },
      { key: "firma_cargo", page: 0, x: 94.7, y: 196.6, size: 8, maxW: 151.3, c: 1 },
      { key: "firma_telefono", page: 0, x: 111.5, y: 184.9, size: 8, maxW: 134.5, c: 1 },
      { key: "firma_email", page: 0, x: 94.7, y: 173.1, size: 8, maxW: 151.3, c: 1 },
      { key: "tecnico", page: 0, x: 389.2, y: 132, size: 8, maxW: 153.6, c: 1 },
    ],
    wrap: [
      { key: "detalles", page: 0, x: 334, y0: 452.5, lh: 11.55, maxW: 219, size: 8, maxLines: 5 },
      { key: "diagnostico", page: 0, x: 49, y0: 300.4, lh: 16.3, maxW: 504, size: 8.5, maxLines: 5 },
    ],
    marks: [
      /* IP y ANL vienen rotulados dentro del recuadro: la X va al lado */
      { key: "tecnologia", page: 0, map: { IP: [[496.5, 610.9]], "Análoga": [[526.5, 610.9]] } },
      { key: "tipo_camara", page: 0, map: { "Domo PTZ": [[469.9, 583.6]], "Fija bala": [[469.8, 568.9]], "Fija mini domo": [[469.9, 552.6]], "Fija con housing": [[470.2, 535.4]], "Fija 360°": [[470.5, 518.1]] } },
    ],
    grid: [
      { key: "chk_componentes", page: 0, rows: { estado_fisico: 467, acrilico: 457.3, fuente_dc: 446.3, balums: 434.5, cableado: 422.8, voltaje_alimentacion: 411, dvr_nvr: 398.6 }, opts: { Bien: 176.1, Mal: 201.6, Regular: 244.2, "N/A": 269.7, NAC: 295.4, NP: 323.1 } },
      { key: "chk_tareas", page: 0, rows: { ajuste_conectores: 386.3, limpieza_equipo: 374.5, limpieza_lente: 362.8, camara_operativa: 350.9 }, opts: { "Sí": 176.1, No: 201.6 } },
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
