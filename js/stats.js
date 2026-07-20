// ============================================================================
// stats.js
// Funciones PURAS: reciben datos, devuelven datos. Ningún acceso a DOM, a
// Plotly, ni a state.js. Esto es lo que permite testear el motor sin interfaz
// (tal como pide la Etapa 5) y lo que en el futuro va a poder testearse de
// forma aislada.
//
// Implementa el modelo aprobado en la Etapa 4, con los ajustes de la Etapa 5
// y la corrección de alcance posterior al QA (período definitivo: 1 de
// octubre a 15 de enero, inclusive):
//   - ventanas fijas de 5 días dentro del período 01/oct-15/ene (21 ventanas
//     -- ver PERIODO_ANALIZADO más abajo, nunca hardcodeado como número
//     mágico en otro lugar del motor), con modo "automático" (recorta los
//     extremos vacíos) y modo "calendario completo";
//   - percentiles por ventana (P25, mediana, P75), sin boxplot completo;
//   - clasificación de cada observación contra los percentiles de su propia
//     ventana;
//   - reglas de confiabilidad según n (n≥10 / 5-9 / <5 / vacía);
//   - KPIs mínimos;
//   - representatividad temporal del subconjunto (regla simple, no estadística);
//   - mensajes de interpretación automática, sin lenguaje causal.
// ============================================================================

import { round } from './utils.js';

// ---------------------------------------------------------------------------
// Configuración central de umbrales. Deliberadamente en un solo lugar: la
// Etapa 4 dejó documentado que estos valores son convenciones a validar con
// el equipo agronómico, no verdades matemáticas. Cambiarlos acá alcanza para
// que todo el motor (KPIs, mensajes, representatividad temporal) los respete.
// ---------------------------------------------------------------------------
export const THRESHOLDS = {
  N_ALTA_CONFIANZA: 10, // n >= este valor: percentiles con confianza plena
  N_MINIMO_PARA_PERCENTILES: 5, // n < este valor: no se calculan percentiles
  // Fracciones del TOTAL de ventanas del período analizado (no un conteo
  // fijo) usadas por computeRepresentatividadTemporal(). Con el período
  // definitivo de 21 ventanas dan exactamente los mismos umbrales que antes
  // (10.5->11 y 3.5->4 redondeando hacia arriba), pero quedan expresadas
  // como proporción para no tener que volver a tocarlas si el período
  // analizado cambia de nuevo en el futuro.
  REPRESENTATIVIDAD_ALTA_FRACCION: 0.5, // mitad o más de las ventanas con evidencia suficiente
  REPRESENTATIVIDAD_MEDIA_FRACCION: 1 / 6, // al menos una sexta parte de las ventanas
};

// ---------------------------------------------------------------------------
// Período analizado: definición única y explícita del alcance del
// explorador. CUALQUIER cambio de alcance (como el corregido tras el QA,
// que originalmente incluía todo enero por error) se hace ACÁ, en un solo
// lugar -- ningún otro módulo ni ninguna prueba debe repetir estos números.
// Regla de fuera de rango: cualquier fecha anterior al inicio o posterior al
// fin de este período.
// ---------------------------------------------------------------------------
export const PERIODO_ANALIZADO = {
  inicio: { mes: 10, dia: 1 }, // 1 de octubre
  fin: { mes: 1, dia: 15 }, // 15 de enero, inclusive
};

// Meses que participan del período, con el último día considerado en cada
// uno (31/oct, 30/nov, 31/dic completos; enero se corta en el día 15 según
// PERIODO_ANALIZADO.fin). Exportado (además de usarse acá) para que
// experimentos de configuración de ventanas alternativas (ej. prueba de 10
// días) puedan reutilizar el mismo período analizado sin duplicarlo -- ver
// stats-ventanas-10dias.js.
export const MESES_VENTANA = [
  { mes: 10, nombre: 'Octubre', ultimoDia: 31 },
  { mes: 11, nombre: 'Noviembre', ultimoDia: 30 },
  { mes: 12, nombre: 'Diciembre', ultimoDia: 31 },
  { mes: 1, nombre: 'Enero', ultimoDia: PERIODO_ANALIZADO.fin.dia },
];

/**
 * Determina si una fecha (mes 1-12, día del mes) cae dentro del período
 * analizado (01/oct al 15/ene, inclusive). Es la ÚNICA función que debe
 * usarse para esa decisión -- tanto data-loader.js (al normalizar cada
 * registro) como cualquier verificación posterior deben apoyarse en ella,
 * en vez de reimplementar la comparación de meses/días por su cuenta.
 * @param {number} mes 1-12
 * @param {number} dia 1-31
 * @returns {boolean}
 */
export function estaDentroDelPeriodoAnalizado(mes, dia) {
  const { inicio, fin } = PERIODO_ANALIZADO;
  // El período cruza fin de año calendario (oct-dic de un año, ene del
  // siguiente), así que se evalúa en dos tramos:
  //   - mes de inicio (octubre): válido desde el día de inicio en adelante;
  //   - meses intermedios completos (noviembre, diciembre): siempre válidos;
  //   - mes de fin (enero): válido solo hasta el día de fin, inclusive.
  if (mes === PERIODO_ANALIZADO.inicio.mes) return dia >= PERIODO_ANALIZADO.inicio.dia;
  if (mes === PERIODO_ANALIZADO.fin.mes) return dia <= PERIODO_ANALIZADO.fin.dia;
  return mes > PERIODO_ANALIZADO.inicio.mes || mes < PERIODO_ANALIZADO.fin.mes;
}

// Desplazamiento (en días) del primer día de cada mes del período respecto
// del 1 de octubre, ignorando el año calendario -- es lo que permite ubicar
// una fecha de cualquier campaña en UNA sola línea de tiempo relativa
// ("día de temporada"), para poder superponer todas las campañas en el mismo
// eje. Se deriva de MESES_VENTANA, nunca hardcodeado aparte.
const OFFSET_INICIO_MES = (() => {
  const offsets = {};
  let acumulado = 0;
  MESES_VENTANA.forEach(({ mes }) => {
    offsets[mes] = acumulado;
    acumulado += diasEnMes(mes);
  });
  return offsets;
})();

/**
 * Convierte una fecha (mes 1-12, día del mes) en un único número de "día de
 * temporada": 0 = 1 de octubre, y así sucesivamente hasta el 15 de enero.
 * Ignora el año calendario a propósito -- dos observaciones de campañas
 * distintas sembradas el mismo día del ciclo (ej. 3 de diciembre de 2019 y
 * 3 de diciembre de 2023) devuelven el mismo número, que es justamente lo
 * que permite compararlas en un solo eje. Devuelve null para fechas fuera
 * del período analizado (donde "día de temporada" no está definido).
 * Pensada para la capa de presentación (selección directa sobre el
 * gráfico) -- el cálculo de ventanas y percentiles del motor no depende de
 * esta función, solo la usa como una conveniencia adicional.
 * @param {number} mes 1-12
 * @param {number} dia 1-31
 * @returns {number|null}
 */
export function diaDeTemporada(mes, dia) {
  if (!estaDentroDelPeriodoAnalizado(mes, dia)) return null;
  return OFFSET_INICIO_MES[mes] + (dia - 1);
}

/**
 * Inverso de diaDeTemporada(): dado un número de día de temporada (0 = 1 de
 * octubre), devuelve el mes y día de calendario que le corresponden, más una
 * etiqueta legible ("3 de diciembre"). Se usa únicamente para mostrarle al
 * usuario, en lenguaje natural, qué fechas seleccionó al recortar un tramo
 * directamente sobre el gráfico -- no participa de ningún cálculo del motor.
 * @param {number} diaTemporada
 * @returns {{mes: number, dia: number, label: string}|null}
 */
export function fechaDesdeDiaDeTemporada(diaTemporada) {
  const NOMBRES_MES = { 10: 'octubre', 11: 'noviembre', 12: 'diciembre', 1: 'enero' };
  let mesEncontrado = null;
  let diaEncontrado = null;
  MESES_VENTANA.forEach(({ mes }) => {
    const inicio = OFFSET_INICIO_MES[mes];
    const fin = inicio + diasEnMes(mes) - 1;
    if (diaTemporada >= inicio && diaTemporada <= fin) {
      mesEncontrado = mes;
      diaEncontrado = diaTemporada - inicio + 1;
    }
  });
  if (mesEncontrado === null) return null;
  return { mes: mesEncontrado, dia: diaEncontrado, label: `${diaEncontrado} de ${NOMBRES_MES[mesEncontrado]}` };
}

// ---------------------------------------------------------------------------
// Construcción de las ventanas fijas del período analizado.
// ---------------------------------------------------------------------------

export function diasEnMes(mes) {
  const config = MESES_VENTANA.find((m) => m.mes === mes);
  return config.ultimoDia;
}

/**
 * Construye las ventanas fijas de siembra del período analizado (01/oct al
 * 15/ene), en orden cronológico agronómico. Cada ventana cubre 5 días,
 * salvo el último tramo de cada mes de 31 días, que absorbe el día
 * sobrante (6 días). Enero se corta en el día definido por
 * PERIODO_ANALIZADO.fin.dia (15), que es exactamente divisible por 5, así
 * que no genera ningún tramo irregular.
 *
 * La cantidad total de ventanas NO está hardcodeada en ningún lado: surge
 * de sumar las ventanas de cada mes según su cantidad real de días. Con el
 * período definitivo (01/oct-15/ene) da 21 ventanas; ese número se verifica
 * en las pruebas, pero no se repite como constante en el motor.
 * @returns {Array<{id: number, mes: number, nombreMes: string, diaInicio: number, diaFin: number, label: string}>}
 */
export function buildFixedWindows() {
  const windows = [];
  let id = 0;
  MESES_VENTANA.forEach(({ mes, nombre }) => {
    const totalDias = diasEnMes(mes);
    // Cantidad de ventanas "base" de 5 días que entran en el tramo del mes
    // que pertenece al período analizado. El resto (0 a 4 días) se funde en
    // la última ventana, para no dejar nunca una ventana huérfana de 1 día.
    const cantidadVentanas = Math.floor(totalDias / 5);
    for (let i = 0; i < cantidadVentanas; i++) {
      const esUltimaVentanaDelMes = i === cantidadVentanas - 1;
      const diaInicio = i * 5 + 1;
      const diaFin = esUltimaVentanaDelMes ? totalDias : diaInicio + 4;
      windows.push({
        id,
        mes,
        nombreMes: nombre,
        diaInicio,
        diaFin,
        label: `${diaInicio}-${diaFin} ${nombre}`,
      });
      id++;
    }
  });
  return windows;
}

/**
 * Determina, para un modo de visualización dado, qué ventanas deben
 * mostrarse -- devolviendo directamente las entradas del RESUMEN por ventana
 * (con n, percentiles, confianza), no solo la definición de rango de días.
 * Es lo que la interfaz va a necesitar para dibujar el eje X: nunca tiene
 * que salir a buscar el resumen por separado y unirlo por id.
 *
 * En modo 'completo' son siempre todas las ventanas del período analizado. En modo 'auto', se recortan los
 * extremos (inicio y fin) que no tengan ninguna observación en el
 * subconjunto filtrado, preservando huecos internos (una ventana vacía
 * *entre* dos ventanas con datos sigue siendo información relevante, según
 * el modelo aprobado en la Etapa 4; el ajuste de la Etapa 5 solo pidió evitar
 * los espacios vacíos en los BORDES del eje).
 * @param {Array} windowSummary resultado de computeWindowSummary()
 * @param {'auto'|'completo'} mode
 * @returns {Array} subconjunto de windowSummary a renderizar, en orden
 */
export function selectVisibleWindows(windowSummary, mode) {
  if (mode === 'completo') return windowSummary;

  const indicesConDatos = windowSummary
    .map((w, idx) => (w.n > 0 ? idx : null))
    .filter((idx) => idx !== null);

  if (indicesConDatos.length === 0) return []; // no hay ninguna observación en todo el subconjunto

  const primerIdx = indicesConDatos[0];
  const ultimoIdx = indicesConDatos[indicesConDatos.length - 1];
  return windowSummary.slice(primerIdx, ultimoIdx + 1);
}

/**
 * Asigna a cada registro el id de ventana que le corresponde según su fecha
 * de siembra. Los registros fuera del rango octubre-enero devuelven null.
 * @param {object} record ya normalizado por data-loader.js
 * @param {Array} windows resultado de buildFixedWindows()
 * @returns {number|null}
 */
export function assignWindowId(record, windows) {
  if (record.fechaFueraDeRangoAnalizado) return null;
  const mes = record.fechaSiembraMes;
  const dia = record.fechaSiembraDia;
  const win = windows.find((w) => w.mes === mes && dia >= w.diaInicio && dia <= w.diaFin);
  return win ? win.id : null;
}

// ---------------------------------------------------------------------------
// Percentiles
// ---------------------------------------------------------------------------

/**
 * Percentil por interpolación lineal (método equivalente a Excel
 * PERCENTILE.INC / numpy 'linear', el más difundido y el más fácil de
 * explicar a un usuario no estadístico). Requiere un array YA ordenado
 * ascendentemente.
 * @param {number[]} sortedValues
 * @param {number} p entre 0 y 1
 * @returns {number}
 */
function percentileOfSorted(sortedValues, p) {
  const n = sortedValues.length;
  if (n === 1) return sortedValues[0];
  const rank = p * (n - 1);
  const lowerIdx = Math.floor(rank);
  const upperIdx = Math.ceil(rank);
  if (lowerIdx === upperIdx) return sortedValues[lowerIdx];
  const weight = rank - lowerIdx;
  return sortedValues[lowerIdx] * (1 - weight) + sortedValues[upperIdx] * weight;
}

/**
 * Clasifica el nivel de confianza de una ventana según su n, de acuerdo a
 * las reglas aprobadas en la Etapa 4.
 * @param {number} n
 * @returns {'VACIA'|'INSUFICIENTE'|'REDUCIDA'|'ALTA'}
 */
export function confidenceLevel(n) {
  if (n === 0) return 'VACIA';
  if (n < THRESHOLDS.N_MINIMO_PARA_PERCENTILES) return 'INSUFICIENTE';
  if (n < THRESHOLDS.N_ALTA_CONFIANZA) return 'REDUCIDA';
  return 'ALTA';
}

/**
 * Calcula el resumen estadístico por ventana para un subconjunto ya
 * filtrado de registros.
 * @param {object[]} filteredRecords
 * @param {Array} windows resultado de buildFixedWindows()
 * @returns {Array} un elemento por ventana, en el mismo orden que `windows`
 */
export function computeWindowSummary(filteredRecords, windows) {
  const byWindow = new Map(windows.map((w) => [w.id, []]));

  filteredRecords.forEach((record) => {
    const windowId = assignWindowId(record, windows);
    if (windowId === null) return; // fuera de rango analizado, no entra en ninguna ventana
    byWindow.get(windowId).push(record.rendimiento);
  });

  return windows.map((w) => {
    const values = byWindow.get(w.id).slice().sort((a, b) => a - b);
    const n = values.length;
    const confianza = confidenceLevel(n);

    const base = {
      windowId: w.id,
      label: w.label,
      n,
      confianza,
      min: null,
      p25: null,
      mediana: null,
      p75: null,
      max: null,
    };

    if (n === 0) return base;

    base.min = round(values[0]);
    base.max = round(values[n - 1]);

    if (n >= THRESHOLDS.N_MINIMO_PARA_PERCENTILES) {
      base.p25 = round(percentileOfSorted(values, 0.25));
      base.mediana = round(percentileOfSorted(values, 0.5));
      base.p75 = round(percentileOfSorted(values, 0.75));
    }

    return base;
  });
}

/**
 * Convención de clasificación en los límites exactos de percentil.
 *
 * La QA previa a esta versión detectó que el código resolvía los empates
 * exactos (una observación cuyo rendimiento coincide EXACTAMENTE con P25,
 * la mediana o P75) de forma implícita, sin que el modelo aprobado dijera
 * qué debía pasar en ese punto. Esta es la convención que queda fijada de
 * forma explícita y documentada a partir de esta versión:
 *
 *   Rendimiento <  P25                    -> INFERIOR_A_P25
 *   P25       <= Rendimiento <  Mediana   -> ENTRE_P25_MEDIANA
 *   Mediana   <= Rendimiento <= P75       -> ENTRE_MEDIANA_P75
 *   Rendimiento >  P75                    -> SUPERIOR_A_P75
 *
 * Es decir: los límites P25 y Mediana pertenecen al grupo que empieza en
 * ellos (no al que termina en ellos), y P75 es el único límite que queda
 * INCLUIDO en el grupo inferior ("Entre Mediana y P75") en vez de abrir el
 * grupo superior -- una observación exactamente en el P75 se lee como
 * "todavía dentro del rango central", no como "por encima de él". Cada
 * observación cae siempre en exactamente un grupo; no hay superposición ni
 * casos sin clasificar salvo por falta de percentiles (ver más abajo).
 */
export const CLASSIFICATION_LABELS = {
  INFERIOR_A_P25: 'Inferior al P25',
  ENTRE_P25_MEDIANA: 'Entre P25 y Mediana',
  ENTRE_MEDIANA_P75: 'Entre Mediana y P75',
  SUPERIOR_A_P75: 'Superior al P75',
};

/**
 * Clasifica cada observación del subconjunto filtrado respecto de los
 * percentiles de SU PROPIA ventana (nunca contra el subconjunto global —
 * ver Sección 4 del modelo aprobado). Devuelve un nuevo array; no muta
 * filteredRecords. La convención de límites exactos está documentada arriba,
 * en CLASSIFICATION_LABELS.
 * @param {object[]} filteredRecords
 * @param {Array} windows
 * @param {Array} windowSummary resultado de computeWindowSummary(), mismo orden que windows
 * @returns {object[]} copias de los registros originales + { windowId, posicionRelativa }
 */
export function classifyObservations(filteredRecords, windows, windowSummary) {
  const summaryByWindowId = new Map(windowSummary.map((s) => [s.windowId, s]));

  return filteredRecords.map((record) => {
    const windowId = assignWindowId(record, windows);
    let posicionRelativa = null;

    if (windowId !== null) {
      const summary = summaryByWindowId.get(windowId);
      if (summary && summary.mediana !== null) {
        const { p25, mediana, p75 } = summary;
        if (record.rendimiento < p25) posicionRelativa = 'INFERIOR_A_P25';
        else if (record.rendimiento < mediana) posicionRelativa = 'ENTRE_P25_MEDIANA';
        else if (record.rendimiento <= p75) posicionRelativa = 'ENTRE_MEDIANA_P75';
        else posicionRelativa = 'SUPERIOR_A_P75';
      }
    }

    return { ...record, windowId, posicionRelativa };
  });
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

/**
 * Calcula los 4 KPIs definidos en el modelo aprobado (Etapa 4, Sección 8).
 * @param {object[]} filteredRecords
 * @param {Array} windowSummary
 * @returns {object}
 */
export function computeKPIs(filteredRecords, windowSummary) {
  const nTotal = filteredRecords.length;

  // KPI 1: mediana general del subconjunto filtrado (todas las observaciones,
  // sin agrupar por ventana).
  const rendimientos = filteredRecords.map((r) => r.rendimiento).sort((a, b) => a - b);
  const medianaGeneral = nTotal > 0 ? round(percentileOfSorted(rendimientos, 0.5)) : null;

  // KPI 2: ventana con mayor mediana. Solo se consideran ventanas donde la
  // mediana efectivamente se calculó (n >= N_MINIMO_PARA_PERCENTILES) -- de
  // lo contrario "la mejor ventana" podría ser una con un solo dato.
  const ventanasConMediana = windowSummary.filter((w) => w.mediana !== null);
  let mejorVentana = null;
  ventanasConMediana.forEach((w) => {
    if (!mejorVentana || w.mediana > mejorVentana.mediana) mejorVentana = w;
  });

  // KPI 3: amplitud entre ventanas de alta confianza (n >= N_ALTA_CONFIANZA),
  // para no dejar que una ventana de n bajo infle la diferencia.
  const ventanasAltaConfianza = windowSummary.filter((w) => w.confianza === 'ALTA');
  let amplitudEntreVentanas = null;
  let ventanaMaxima = null;
  let ventanaMinima = null;
  if (ventanasAltaConfianza.length > 0) {
    ventanaMaxima = ventanasAltaConfianza.reduce((a, b) => (b.mediana > a.mediana ? b : a));
    ventanaMinima = ventanasAltaConfianza.reduce((a, b) => (b.mediana < a.mediana ? b : a));
    amplitudEntreVentanas = round(ventanaMaxima.mediana - ventanaMinima.mediana);
  }

  // KPI 4: desglose de confiabilidad de las ventanas del período analizado.
  // totalVentanas nunca se hardcodea -- surge de windowSummary.length, que a
  // su vez surge de buildFixedWindows() según PERIODO_ANALIZADO (stats.js).
  const totalVentanas = windowSummary.length;
  const desglose = {
    alta: windowSummary.filter((w) => w.confianza === 'ALTA').length,
    reducida: windowSummary.filter((w) => w.confianza === 'REDUCIDA').length,
    insuficiente: windowSummary.filter((w) => w.confianza === 'INSUFICIENTE').length,
    vacia: windowSummary.filter((w) => w.confianza === 'VACIA').length,
  };

  // Conteo dinámico de observaciones fuera del período analizado DENTRO del
  // subconjunto filtrado actual. La QA previa a esta versión detectó que
  // este dato solo existía como estadística de la carga inicial completa (en
  // el reporte de auditoría de data-loader.js) y no se recalculaba con cada
  // filtro, lo que podía generar mensajes engañosos ("no hay datos" cuando
  // en realidad había datos fuera de rango). Se agrega acá para que viaje
  // junto con el resto del estado derivado y se actualice en cada aplicación
  // de filtros, como cualquier otro KPI.
  const observacionesFueraDeRango = filteredRecords.filter((r) => r.fechaFueraDeRangoAnalizado).length;

  return {
    nTotal,
    totalVentanas,
    medianaGeneral,
    mejorVentana: mejorVentana
      ? { label: mejorVentana.label, mediana: mejorVentana.mediana, n: mejorVentana.n }
      : null,
    amplitudEntreVentanas,
    ventanaMaxima: ventanaMaxima ? { label: ventanaMaxima.label, mediana: ventanaMaxima.mediana, n: ventanaMaxima.n } : null,
    ventanaMinima: ventanaMinima ? { label: ventanaMinima.label, mediana: ventanaMinima.mediana, n: ventanaMinima.n } : null,
    desgloseConfiabilidad: desglose,
    observacionesFueraDeRango,
  };
}

// ---------------------------------------------------------------------------
// Representatividad temporal del subconjunto (Etapa 5, ajuste 3 · renombrado
// en la iteración posterior a la QA)
// ---------------------------------------------------------------------------

/**
 * Clasifica la REPRESENTATIVIDAD TEMPORAL del subconjunto filtrado, con una
 * regla simple y determinística (no un test estadístico).
 *
 * Nombre elegido deliberadamente para no confundirse con "calidad de los
 * datos": este indicador NO evalúa si las observaciones son correctas,
 * confiables o están bien medidas -- de eso ya se ocupó la auditoría de
 * datos, antes de que la base llegara al motor. Lo que este indicador mide
 * es otra cosa, más acotada: qué tan bien distribuida está la evidencia
 * disponible A LO LARGO DEL PERÍODO DE SIEMBRA ANALIZADO (01/oct al 15/ene).
 * Un subconjunto puede tener datos impecables y aun así tener una
 * representatividad temporal baja -- por ejemplo, si el usuario filtró a
 * propósito para estudiar una sola ventana de siembra: esos datos no son de
 * mala calidad, simplemente no cubren todo el período. Ese matiz es
 * justamente lo que el nombre anterior ("calidad") no dejaba claro.
 *
 * Reglas, en orden (la primera que se cumple gana). Los umbrales de
 * cobertura se expresan como FRACCIÓN del total de ventanas del período
 * analizado (`kpis.totalVentanas`, nunca un número fijo) -- ver
 * THRESHOLDS.REPRESENTATIVIDAD_ALTA_FRACCION / _MEDIA_FRACCION en la
 * configuración central de este archivo:
 *   1. nTotal < 5                                                    -> INSUFICIENTE
 *   2. ventanas ALTA >= mitad del total y vacías <=25%                -> ALTA
 *   3. ventanas ALTA >= 1/6 del total y vacías <=50%                  -> MEDIA
 *   4. cualquier otro caso                                            -> BAJA
 *
 * @param {object} kpis resultado de computeKPIs() (debe incluir totalVentanas)
 * @returns {{ nivel: 'INSUFICIENTE'|'BAJA'|'MEDIA'|'ALTA', motivo: string, descripcion: string }}
 */
export function computeRepresentatividadTemporal(kpis) {
  const DESCRIPCION =
    'Evalúa qué tan bien distribuida está la evidencia a lo largo del período de siembra ' +
    'analizado (01 de octubre al 15 de enero) para la combinación de filtros activa. No es una ' +
    'medida de la calidad estadística intrínseca de las observaciones -- un subconjunto ' +
    'concentrado en una sola ventana puede tener datos perfectamente confiables y aun así una ' +
    'representatividad temporal baja, simplemente porque no cubre el resto del período.';

  const { nTotal, totalVentanas, desgloseConfiabilidad } = kpis;
  const pctVacias = desgloseConfiabilidad.vacia / totalVentanas;
  const minVentanasAlta = Math.ceil(totalVentanas * THRESHOLDS.REPRESENTATIVIDAD_ALTA_FRACCION);
  const minVentanasMedia = Math.ceil(totalVentanas * THRESHOLDS.REPRESENTATIVIDAD_MEDIA_FRACCION);

  if (nTotal < 5) {
    return {
      nivel: 'INSUFICIENTE',
      motivo: `Solo ${nTotal} observaciones en todo el subconjunto filtrado.`,
      descripcion: DESCRIPCION,
    };
  }
  if (desgloseConfiabilidad.alta >= minVentanasAlta && pctVacias <= 0.25) {
    return {
      nivel: 'ALTA',
      motivo: `${desgloseConfiabilidad.alta} de ${totalVentanas} ventanas con evidencia suficiente (n≥${THRESHOLDS.N_ALTA_CONFIANZA}) y solo ${desgloseConfiabilidad.vacia} vacías: la evidencia cubre bien el período analizado.`,
      descripcion: DESCRIPCION,
    };
  }
  if (desgloseConfiabilidad.alta >= minVentanasMedia && pctVacias <= 0.5) {
    return {
      nivel: 'MEDIA',
      motivo: `${desgloseConfiabilidad.alta} de ${totalVentanas} ventanas con evidencia suficiente (n≥${THRESHOLDS.N_ALTA_CONFIANZA}); ${desgloseConfiabilidad.vacia} ventanas vacías: la evidencia cubre parte del período.`,
      descripcion: DESCRIPCION,
    };
  }
  return {
    nivel: 'BAJA',
    motivo: `Solo ${desgloseConfiabilidad.alta} de ${totalVentanas} ventanas con evidencia suficiente; ${desgloseConfiabilidad.vacia} ventanas vacías: la evidencia se concentra en una parte acotada del período (esto no implica que esos datos sean poco confiables).`,
    descripcion: DESCRIPCION,
  };
}

// ---------------------------------------------------------------------------
// Mensajes de interpretación automática (Etapa 4, Sección 11)
// ---------------------------------------------------------------------------

/**
 * Ventana con mayor n dentro de windowSummary -- extraída de
 * generateMessages() (vivía como un .reduce() inline) para que la
 * presentación pueda reutilizarla como KPI ("Mayor respaldo histórico") sin
 * duplicar el cálculo. Null si ninguna ventana tiene observaciones.
 * @param {Array} windowSummary
 * @returns {{label:string, n:number}|null}
 */
export function ventanaConMayorN(windowSummary) {
  const candidata = windowSummary.reduce((a, b) => (b.n > a.n ? b : a), { n: -1 });
  return candidata.n > 0 ? { label: candidata.label, n: candidata.n } : null;
}

/**
 * Genera mensajes descriptivos (nunca causales) a partir del resumen por
 * ventana y los KPIs ya calculados. Cada mensaje que menciona una ventana
 * incluye su n en la misma oración.
 * @param {Array} windowSummary
 * @param {object} kpis
 * @returns {string[]}
 */
export function generateMessages(windowSummary, kpis) {
  const messages = [];

  if (kpis.nTotal === 0) {
    messages.push('No hay observaciones en el subconjunto filtrado. Probá relajar alguno de los filtros activos.');
    return messages;
  }

  if (kpis.mejorVentana) {
    messages.push(
      `La ventana ${kpis.mejorVentana.label} presentó la mediana más alta ` +
      `(${kpis.mejorVentana.mediana} kg/ha) dentro del subconjunto filtrado (n=${kpis.mejorVentana.n}).`
    );
  }

  const ventanaMasPoblada = ventanaConMayorN(windowSummary);
  if (ventanaMasPoblada) {
    messages.push(
      `La ventana ${ventanaMasPoblada.label} concentra la mayor cantidad de observaciones del subconjunto (n=${ventanaMasPoblada.n}).`
    );
  }

  if (kpis.amplitudEntreVentanas !== null) {
    messages.push(
      `La diferencia entre la ventana de mayor y menor mediana es de ${kpis.amplitudEntreVentanas} kg/ha ` +
      `entre las ventanas con evidencia suficiente (n≥${THRESHOLDS.N_ALTA_CONFIANZA}): ` +
      `${kpis.ventanaMaxima.label} (n=${kpis.ventanaMaxima.n}) frente a ${kpis.ventanaMinima.label} (n=${kpis.ventanaMinima.n}).`
    );
  }

  const vacias = windowSummary.filter((w) => w.confianza === 'VACIA').length;
  if (vacias > 0) {
    messages.push(
      `${vacias} de las ${windowSummary.length} ventanas no registran observaciones para esta combinación de filtros.`
    );
  }

  // Corrección de un hallazgo de QA: cuando el subconjunto filtrado tiene
  // observaciones que caen fuera del rango octubre-enero, el mensaje de
  // "ventanas vacías" de arriba podía leerse como "no hay datos" aunque sí
  // los hubiera (solo que fuera del período analizado). Este mensaje
  // desambigua explícitamente ese escenario.
  if (kpis.observacionesFueraDeRango > 0) {
    messages.push(
      `${kpis.observacionesFueraDeRango} observación(es) del subconjunto filtrado quedaron fuera del ` +
      'período analizado (01 de octubre al 15 de enero) y no se incluyen en ninguna ventana.'
    );
  }

  const insuficientes = windowSummary.filter((w) => w.confianza === 'INSUFICIENTE').length;
  if (insuficientes > 0) {
    messages.push(
      `${insuficientes} ventana(s) tienen muestra insuficiente (n<${THRESHOLDS.N_MINIMO_PARA_PERCENTILES}) ` +
      'para calcular percentiles con esta combinación de filtros.'
    );
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Indicadores laterales "Mayor potencial observado" / "Mayor piso
// productivo" -- extraídos tal cual desde app.js (Explorar), donde vivían
// como funciones privadas no exportadas. Se movieron acá, sin cambiar una
// sola línea de su lógica, para que Escenarios pueda reutilizarlas
// literalmente (mismas reglas metodológicas: MIN_OBS_KPI=20, búsqueda de
// máximo P75/P25 sobre las ventanas visibles) en vez de duplicar el
// algoritmo. app.js ahora importa estas mismas funciones desde acá -- su
// comportamiento no cambió, se re-verificó contra las 89+73 verificaciones
// ya existentes de Explorar tras el movimiento.
// ---------------------------------------------------------------------------

export const MIN_OBS_KPI = 20;

/**
 * Ventana con mayor P75 entre las que alcanzan MIN_OBS_KPI. No es un KPI
 * nuevo del motor: es una búsqueda de máximo sobre datos que
 * computeWindowSummary() ya entrega -- se documenta acá para que ambos
 * módulos (Explorar, Escenarios) lean exactamente la misma regla.
 * @param {Array} visibleWindows
 * @returns {object|null}
 */
export function ventanaConMayorP75(visibleWindows) {
  const candidatas = visibleWindows.filter((w) => w.p75 !== null && w.n >= MIN_OBS_KPI);
  if (candidatas.length === 0) return null;
  return candidatas.reduce((a, b) => (b.p75 > a.p75 ? b : a));
}

/**
 * Ventana con mayor P25 entre las que alcanzan MIN_OBS_KPI. Ver
 * ventanaConMayorP75() -- misma lógica, invertida al percentil 25.
 * @param {Array} visibleWindows
 * @returns {object|null}
 */
export function ventanaConMayorP25(visibleWindows) {
  const candidatas = visibleWindows.filter((w) => w.p25 !== null && w.n >= MIN_OBS_KPI);
  if (candidatas.length === 0) return null;
  return candidatas.reduce((a, b) => (b.p25 > a.p25 ? b : a));
}

// ---------------------------------------------------------------------------
// Dispersión relativa -- métrica nueva (Sección 6.2 del documento funcional
// de Escenarios v2). Deliberadamente NO es el coeficiente de variación
// clásico (que usa el promedio): se define como (P75-P25)/Mediana×100, para
// mantener la regla ya vigente en todo el producto de no usar el promedio en
// ningún indicador. Función pura y genérica -- vive acá (no en
// escenario-state.js) porque opera sobre los mismos tres números que ya
// entrega computeWindowSummary() para cualquier ventana o celda, sin
// depender de nada específico de Escenarios.
// ---------------------------------------------------------------------------

/**
 * Dispersión relativa de una ventana/celda: (P75-P25)/Mediana×100. Solo
 * tiene sentido con evidencia suficiente -- el llamador es responsable de
 * no invocarla (o de ignorar el resultado) por debajo de MIN_OBS_KPI; esta
 * función solo protege contra división por cero o datos nulos.
 * @param {number|null} p25
 * @param {number|null} p75
 * @param {number|null} mediana
 * @returns {number|null}
 */
export function computeDispersionRelativa(p25, p75, mediana) {
  if (p25 === null || p75 === null || mediana === null || mediana === 0) return null;
  return round(((p75 - p25) / mediana) * 100, 0);
}
