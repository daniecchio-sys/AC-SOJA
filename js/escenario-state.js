// ============================================================================
// escenario-state.js
// Única fuente de verdad del módulo ESCENARIOS. Motor de: constructor +
// filtrado AND, indicador principal, tarjeta de resumen, heatmap
// Fecha de siembra × Ciclo con dispersión relativa, ranking de
// combinaciones, lotes registrados que superaron determinados rendimientos,
// mensajes automáticos, e historial. Arquitectura funcional v2 (documento
// AC_SOJA_25_26_Arquitectura_Funcional_Escenarios_v2.md) -- ya NO reutiliza
// el gráfico de serie temporal de Explorar ni sus dos indicadores clásicos
// (ver Sección 6.2 y 8 del documento): esa decisión quedó aprobada por
// escrito, no es una omisión.
//
// Reutiliza SIN modificar: applyFilters/FILTERABLE_FIELDS/getDistinctValues
// (filters.js), buildFixedWindows/selectVisibleWindows/computeWindowSummary/
// computeKPIs/generateMessages/MIN_OBS_KPI/computeDispersionRelativa
// (stats.js).
// ============================================================================

import { applyFilters, FILTERABLE_FIELDS, getDistinctValues } from './filters.js';
import {
  buildFixedWindows,
  selectVisibleWindows,
  computeWindowSummary,
  computeKPIs,
  generateMessages,
  computeDispersionRelativa,
  MIN_OBS_KPI,
} from './stats.js';
import { createIdGenerator, round, medianOf } from './utils.js';

// Mismo umbral que rige "Escenario completo analizable" (Sección 5 del
// documento funcional).
export const MIN_OBS_ESCENARIO = 50;

// Umbrales fijos del bloque "Lotes registrados que superaron" (Sección 7).
export const UMBRALES_LOTES_SUPERADOS = [3000, 4000, 5000];

// Los 4 ciclos de uso frecuente en la base (Sección 6.2 del documento v2) --
// filas fijas del heatmap, en este orden, siempre presentes aunque tengan
// n=0 en un escenario particular. Confirmado contra la distribución real de
// la base: "5 CORTO" (3.900), "6 CORTO" (1.228), "4 LARGO" (1.461), "5
// LARGO" (320) concentran la enorme mayoría del uso; el resto de los
// valores reales de ciclo ("6 LARGO", "S/D", "3 LARGO", etc.) es uso eventual
// y queda en la fila plegada.
export const CICLOS_FRECUENTES = ['4 LARGO', '5 CORTO', '5 LARGO', '6 CORTO'];

export { MIN_OBS_KPI };

// Exactamente las mismas 7 variables ya habilitadas como "comparar por" en
// Comparar (Sección 4 del documento funcional de Escenarios). Se redefine
// acá en vez de importarla desde comparison-state.js a propósito:
// Escenarios depende del motor de Explorar (filters.js/stats.js), no de
// otro módulo hermano.
// Lista de variables permitidas para el buscador de Escenarios -- ACTUALIZADA
// a pedido explícito (quita Ciclo, agrega Departamento), en contra de lo que
// decía la Sección 4 del documento funcional v2 hasta este cambio. Ciclo
// sigue existiendo como dato (el heatmap y el ranking lo usan directo desde
// filteredData, no dependen de que sea una condición seleccionable), pero
// ya no se puede fijar como condición del escenario.
const CLAVES_VARIABLES_PERMITIDAS = [
  'zona', 'enso', 'ocupacion', 'riego', 'fertilizacion', 'antecesor', 'departamento',
];
CLAVES_VARIABLES_PERMITIDAS.forEach((key) => {
  if (!FILTERABLE_FIELDS.some((f) => f.key === key)) {
    throw new Error(`escenario-state.js: la variable "${key}" no existe en FILTERABLE_FIELDS (filters.js).`);
  }
});
export { CLAVES_VARIABLES_PERMITIDAS };

const nextListenerId = createIdGenerator();

/**
 * Crea una instancia independiente del estado de Escenarios.
 * @returns {object} API del estado
 */
/**
 * Crea una instancia independiente del estado de Escenarios.
 * @param {object} [opciones]
 * @param {() => Array} [opciones.windowBuilder] función que construye las
 *   ventanas fijas -- por defecto buildFixedWindows() (5 días, la fuente de
 *   verdad vigente). Mismo parámetro, mismo motivo y mismo criterio ya
 *   agregado a state.js (Explorar): permitir una prueba metodológica
 *   reversible con ventanas de ~10 días (ver stats-ventanas-10dias.js) sin
 *   bifurcar este archivo. Sin este parámetro, Escenarios queda exactamente
 *   igual.
 * @returns {object} API del estado
 */
export function createEscenarioState({ windowBuilder = buildFixedWindows } = {}) {
  // ---- capa 1: datos base ----
  let rawRecords = [];
  const windows = windowBuilder(); // 21 ventanas de 5 días por defecto; parametrizable para pruebas

  // ---- capa 2: estado de interacción ----
  // Mismo formato que appliedFilters de Explorar: { key: {type:'in', values:[...]} }.
  // Sin capa de "borrador": cada cambio se aplica de inmediato (Sección 2,
  // punto 4 del documento funcional -- "no hay una acción explícita de
  // construir o calcular").
  let condiciones = {};

  // ---- capa 3: estado derivado ----
  let filteredData = [];
  let campanasIncluidas = 0; // cantidad de campañas DISTINTAS entre las observaciones del escenario (Sección 8)
  let windowSummary = []; // agregado GLOBAL del escenario (todos los ciclos juntos) -- alimenta mensajes y la tabla general de valores exactos, YA NO alimenta ningún gráfico
  let visibleWindows = [];
  let kpis = null;
  let messages = [];
  let lotesSuperados = []; // [{ umbral, count, pct }] -- Sección 7, calculado SIEMPRE sobre el total del escenario, nunca por ventana

  // Heatmap Fecha de siembra × Ciclo (Sección 6.2 v2): un objeto por fila
  // de ciclo (4 frecuentes + N eventuales presentes en este escenario
  // particular), cada uno con sus 21 celdas (una por ventana).
  let heatmapFilas = []; // [{ ciclo, esFrecuente, n, celdas: [{windowId,label,mes,n,p25,mediana,p75,dispersionRelativa}] }]
  let ciclosEventualesPresentes = []; // valores reales de ciclo fuera de CICLOS_FRECUENTES, con al menos 1 observación en este escenario

  // Ranking de combinaciones (Sección 6.2 v2): TODAS las celdas elegibles
  // (n >= MIN_OBS_KPI) de TODOS los ciclos (frecuentes + eventuales), sin
  // ordenar -- el criterio de orden ("Priorizar según") es responsabilidad
  // de la capa de presentación, no del motor.
  let rankingElegible = []; // [{ windowId, windowLabel, ciclo, n, p25, mediana, p75, dispersionRelativa }]

  // Referencias del gráfico de dispersión (Sección 6.3 v2): mediana de las
  // medianas y mediana de las dispersiones relativas de TODAS las
  // combinaciones elegibles del escenario -- líneas de posición relativa,
  // nunca umbrales. Se recalculan junto con rankingElegible, de la misma
  // lista, sin un segundo recorrido de filteredData.
  let medianaDeMedianas = null;
  let medianaDeDispersiones = null;

  const listeners = new Map();
  function notify(eventType) {
    listeners.forEach((callback) => callback(eventType, getSnapshot()));
  }

  /**
   * Agrega, para UN valor de ciclo, las 21 celdas del heatmap -- reutiliza
   * computeWindowSummary() tal cual (ya hace exactamente el cálculo de
   * percentiles por ventana que una fila del heatmap necesita), llamada
   * sobre el subconjunto de filteredData que además cumple ese ciclo. No
   * se escribió ninguna matemática de percentiles nueva para el heatmap --
   * es la misma función de siempre, aplicada una vez por fila.
   * @param {string} ciclo
   * @returns {{ciclo:string, n:number, celdas:Array}}
   */
  function computeFilaHeatmap(ciclo) {
    const subset = filteredData.filter((r) => r.ciclo === ciclo);
    const resumenPorVentana = computeWindowSummary(subset, windows);
    const celdas = resumenPorVentana.map((w) => ({
      windowId: w.windowId,
      label: w.label,
      n: w.n,
      p25: w.p25,
      mediana: w.mediana,
      p75: w.p75,
      dispersionRelativa: w.n >= MIN_OBS_KPI ? computeDispersionRelativa(w.p25, w.p75, w.mediana) : null,
    }));
    return { ciclo, n: subset.length, celdas };
  }

  function recomputeDerived() {
    filteredData = applyFilters(rawRecords, condiciones);
    campanasIncluidas = new Set(filteredData.map((r) => r.campana)).size;

    windowSummary = computeWindowSummary(filteredData, windows);
    visibleWindows = selectVisibleWindows(windowSummary, 'auto');
    kpis = computeKPIs(filteredData, windowSummary);
    messages = generateMessages(windowSummary, kpis);

    // Bloque de lotes registrados que superaron determinados rendimientos
    // (Sección 7): SIEMPRE sobre filteredData.length (el total del
    // escenario), nunca por ventana. "Superar" = estrictamente mayor a.
    const total = filteredData.length;
    lotesSuperados = UMBRALES_LOTES_SUPERADOS.map((umbral) => {
      const count = filteredData.filter((r) => r.rendimiento > umbral).length;
      const pct = total > 0 ? round((count / total) * 100, 0) : null;
      return { umbral, count, pct, total };
    });

    // Heatmap: filas fijas (4 ciclos frecuentes, SIEMPRE presentes aunque
    // tengan n=0 en este escenario) + filas eventuales (cualquier otro
    // valor real de ciclo con al menos 1 observación en este escenario
    // particular -- Sección 6.2 v2, "fila plegada").
    const valoresDeCicloPresentes = getDistinctValues(filteredData, 'ciclo');
    ciclosEventualesPresentes = valoresDeCicloPresentes.filter((c) => !CICLOS_FRECUENTES.includes(c));

    const filasFrecuentes = CICLOS_FRECUENTES.map((ciclo) => ({ ...computeFilaHeatmap(ciclo), esFrecuente: true }));
    const filasEventuales = ciclosEventualesPresentes
      .map((ciclo) => ({ ...computeFilaHeatmap(ciclo), esFrecuente: false }))
      // orden descendente por n total de la fila -- no especificado de forma
      // literal en el documento funcional más allá de "fila plegada", se
      // elige n descendente por ser el mismo criterio que ya usa Comparar
      // para la selección automática de grupos (consistencia entre
      // módulos), no una decisión nueva sin precedente en el producto.
      .sort((a, b) => b.n - a.n);

    heatmapFilas = [...filasFrecuentes, ...filasEventuales];

    // Ranking: TODAS las celdas elegibles (n>=MIN_OBS_KPI) de TODAS las
    // filas (frecuentes + eventuales), sobre TODO el escenario -- Sección
    // 6.2 v2: "calculado sobre todo el escenario... independiente de la
    // posición del deslizable de fecha o de si la fila de ciclos
    // eventuales está expandida".
    rankingElegible = [];
    heatmapFilas.forEach((fila) => {
      fila.celdas.forEach((celda) => {
        if (celda.n >= MIN_OBS_KPI) {
          rankingElegible.push({
            windowId: celda.windowId,
            windowLabel: celda.label,
            ciclo: fila.ciclo,
            n: celda.n,
            p25: celda.p25,
            mediana: celda.mediana,
            p75: celda.p75,
            dispersionRelativa: celda.dispersionRelativa,
          });
        }
      });
    });

    medianaDeMedianas = medianOf(rankingElegible.map((c) => c.mediana));
    medianaDeDispersiones = medianOf(rankingElegible.map((c) => c.dispersionRelativa));
  }

  function getSnapshot() {
    const nEscenario = filteredData.length;
    const hayCondiciones = Object.keys(condiciones).some((k) => condicionActiva(condiciones[k]));
    return {
      windows,
      nTotalDataset: rawRecords.length,
      condiciones,
      hayCondiciones,
      filteredData,
      nEscenario,
      campanasIncluidas,
      windowSummary,
      visibleWindows,
      kpis,
      messages,
      lotesSuperados,
      heatmapFilas,
      ciclosEventualesPresentes,
      rankingElegible,
      medianaDeMedianas,
      medianaDeDispersiones,
      // Estado del indicador principal, ya resuelto acá (capa de motor, no
      // de presentación) porque la regla ("alcanza el mínimo o no") es
      // metodológica, no visual -- ver Sección 5 y 9 del documento
      // funcional. La interfaz solo decide CÓMO mostrar cada caso, nunca
      // recalcula el umbral por su cuenta.
      alcanzaMinimo: nEscenario >= MIN_OBS_ESCENARIO,
    };
  }

  /**
   * Serializa el estado DEFINIDO POR EL USUARIO -- únicamente `condiciones`,
   * nunca datos derivados (filteredData, windowSummary, kpis, mensajes,
   * lotesSuperados). Mismo criterio ya aplicado en Comparar
   * (comparison-state.js): al restaurar, todo lo derivado se recalcula con
   * recomputeDerived(), nunca se guarda ni se compara directamente.
   * Escenarios es el snapshot más simple de los tres módulos -- un único
   * objeto plano, sin variable de agrupamiento ni lista de grupos.
   * @returns {{condiciones: object}}
   */
  function getSerializableSnapshot() {
    return { condiciones: JSON.parse(JSON.stringify(condiciones)) };
  }

  /**
   * Restaura el estado de interacción a partir de un snapshot serializado y
   * recalcula toda la capa derivada con las mismas funciones que cualquier
   * otro cambio de estado. No dispara ninguna lógica de historial
   * (push/pop) -- responsabilidad exclusiva de quien llama.
   * @param {object} snapshot
   */
  function restoreFromSnapshot(snapshot) {
    condiciones = JSON.parse(JSON.stringify(snapshot.condiciones || {}));
    recomputeDerived();
    notify('snapshotRestored');
  }

  return {
    // -------------------------------------------------------------------
    // Carga inicial
    // -------------------------------------------------------------------
    load(records) {
      rawRecords = records;
      condiciones = {};
      recomputeDerived();
      notify('dataLoaded');
    },

    // -------------------------------------------------------------------
    // Etapa 1-2: constructor + filtrado AND
    // -------------------------------------------------------------------
    /**
     * Agrega o reemplaza una condición. Todas las condiciones activas se
     * combinan con AND (Sección 4) -- comportamiento nativo de
     * applyFilters(), sin ninguna lógica nueva acá.
     * @param {string} key debe estar en CLAVES_VARIABLES_PERMITIDAS
     * @param {object} condition ej: {type:'in', values:['4']}
     */
    setCondicion(key, condition) {
      if (!CLAVES_VARIABLES_PERMITIDAS.includes(key)) {
        throw new Error(`Variable no permitida en Escenarios: ${key}`);
      }
      condiciones = { ...condiciones, [key]: condition };
      recomputeDerived();
      notify('condicionesChanged');
    },

    quitarCondicion(key) {
      condiciones = { ...condiciones };
      delete condiciones[key];
      recomputeDerived();
      notify('condicionesChanged');
    },

    // -------------------------------------------------------------------
    // Historial: serialización / restauración
    // -------------------------------------------------------------------
    getSerializableSnapshot,
    restoreFromSnapshot,

    // -------------------------------------------------------------------
    // Suscripción + lectura
    // -------------------------------------------------------------------
    subscribe(callback) {
      const id = nextListenerId();
      listeners.set(id, callback);
      return id;
    },
    unsubscribe(id) {
      listeners.delete(id);
    },
    getSnapshot,
  };
}

function condicionActiva(condition) {
  if (!condition) return false;
  if (condition.type === 'in') return Array.isArray(condition.values) && condition.values.length > 0;
  if (condition.type === 'range') return condition.min !== null && condition.min !== undefined
    || condition.max !== null && condition.max !== undefined;
  return false;
}
