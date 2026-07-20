// ============================================================================
// state.js
// Única fuente de verdad del explorador. Ningún otro módulo debe mutar datos
// por fuera de acá. Sin DOM, sin gráficos: se puede probar de punta a punta
// desde una consola de Node, tal como pide la Etapa 5.
//
// Comportamiento de filtros (ajuste aprobado en la Etapa 5): los filtros NO
// se aplican en cada cambio individual. El usuario modifica un "borrador" de
// filtros (draftFilters) y recién al confirmar (applyFilters()) se recalcula
// todo el motor de una sola vez. Esto evita recomputar de más cuando el
// usuario cambia varios filtros seguidos.
//
// Capas del estado:
//   1. Datos base       -> rawRecords, windows (fijos tras load(), inmutables)
//   2. Estado de interacción -> draftFilters, appliedFilters, windowMode (mutable)
//   3. Estado derivado   -> todo lo que sale de recomputeDerived(); nunca se
//                           edita a mano, siempre se recalcula a partir de (1)+(2)
// ============================================================================

import { applyFilters as applyFiltersLogic, createEmptyFilters } from './filters.js';
import {
  buildFixedWindows,
  selectVisibleWindows,
  computeWindowSummary,
  classifyObservations,
  computeKPIs,
  computeRepresentatividadTemporal,
  generateMessages,
} from './stats.js';
import { createIdGenerator } from './utils.js';

const nextListenerId = createIdGenerator();

/**
 * Crea una instancia independiente del estado del explorador. Se usa una
 * fábrica (en vez de un singleton exportado) para que el motor se pueda
 * instanciar más de una vez en un mismo proceso -- por ejemplo, durante los
 * tests, sin que un test contamine el estado de otro.
 * @param {object} [opciones]
 * @param {() => Array} [opciones.windowBuilder] función que construye las
 *   ventanas fijas -- por defecto buildFixedWindows() (5 días, la fuente de
 *   verdad vigente). Parámetro agregado para permitir pruebas metodológicas
 *   reversibles con una configuración de ventanas alternativa (ej. 10 días,
 *   ver stats-ventanas-10dias.js) SIN bifurcar este archivo ni duplicar el
 *   pipeline de borrador/aplicar -- mismo criterio ya usado con
 *   `baseSentence` en query-builder.js. Sin este parámetro, el comportamiento
 *   de Explorar queda exactamente igual.
 * @returns {object} API del estado
 */
export function createAppState({ windowBuilder = buildFixedWindows } = {}) {
  // ---- capa 1: datos base ----
  let rawRecords = [];
  let windows = windowBuilder(); // constante una vez cargado, no cambia con los filtros

  // ---- capa 2: estado de interacción ----
  let draftFilters = createEmptyFilters();
  let appliedFilters = createEmptyFilters();
  let windowMode = 'auto'; // 'auto' | 'completo'

  // ---- capa 3: estado derivado (se recalcula, nunca se edita a mano) ----
  let filteredData = [];
  let windowSummary = [];
  let classifiedData = [];
  let visibleWindows = [];
  let kpis = null;
  let representatividadTemporal = null;
  let messages = [];

  // ---- suscripciones ----
  const listeners = new Map();

  function notify(eventType) {
    listeners.forEach((callback) => callback(eventType, getSnapshot()));
  }

  /**
   * Recalcula TODA la capa derivada a partir de rawRecords + appliedFilters.
   * Es el único lugar del motor donde se encadena el pipeline completo:
   * filtrar -> resumen por ventana -> clasificar -> KPIs -> representatividad temporal -> mensajes.
   */
  function recomputeDerived() {
    filteredData = applyFiltersLogic(rawRecords, appliedFilters);
    windowSummary = computeWindowSummary(filteredData, windows);
    classifiedData = classifyObservations(filteredData, windows, windowSummary);
    kpis = computeKPIs(filteredData, windowSummary);
    representatividadTemporal = computeRepresentatividadTemporal(kpis);
    messages = generateMessages(windowSummary, kpis);
    recomputeVisibleWindows();
  }

  /**
   * Recalcula solo qué ventanas se muestran, según el modo de eje X. No
   * requiere volver a filtrar ni a recalcular percentiles -- el resumen por
   * ventana ya contempla siempre todas las ventanas fijas del período
   * analizado; el modo solo decide el recorte de visualización.
   */
  function recomputeVisibleWindows() {
    visibleWindows = selectVisibleWindows(windowSummary, windowMode);
  }

  function getSnapshot() {
    return {
      // capa 1
      windows,
      nTotalDataset: rawRecords.length,
      // capa 2
      draftFilters,
      appliedFilters,
      windowMode,
      // capa 3
      filteredData,
      windowSummary,
      classifiedData,
      visibleWindows,
      kpis,
      representatividadTemporal,
      messages,
    };
  }

  return {
    // -------------------------------------------------------------------
    // Carga inicial
    // -------------------------------------------------------------------
    /**
     * Carga el dataset normalizado (salida de data-loader.js) y calcula el
     * estado derivado inicial (sin ningún filtro activo).
     * @param {object[]} records
     */
    load(records) {
      rawRecords = records;
      appliedFilters = createEmptyFilters();
      draftFilters = createEmptyFilters();
      recomputeDerived();
      notify('dataLoaded');
    },

    // -------------------------------------------------------------------
    // Filtros -- comportamiento "borrador + aplicar" (ajuste Etapa 5)
    // -------------------------------------------------------------------
    /**
     * Modifica el borrador de filtros. NO dispara recálculo del motor.
     * @param {string} fieldKey
     * @param {object|null} condition ej: {type:'in', values:['2024-25']} o null para desactivar
     */
    setDraftFilter(fieldKey, condition) {
      draftFilters = { ...draftFilters, [fieldKey]: condition };
      notify('draftChanged');
    },

    /** Descarta cambios pendientes en el borrador, volviendo a los filtros aplicados. */
    discardDraft() {
      draftFilters = { ...appliedFilters };
      notify('draftChanged');
    },

    /**
     * Confirma el borrador de filtros: lo convierte en los filtros activos y
     * dispara el recálculo completo del motor. Es el único punto de entrada
     * que corresponde al botón "Aplicar filtros" de la interfaz.
     */
    applyFilters() {
      appliedFilters = { ...draftFilters };
      recomputeDerived();
      notify('dataChanged');
    },

    /** Limpia todos los filtros (borrador y aplicados) y recalcula sobre el universo completo. */
    resetFilters() {
      draftFilters = createEmptyFilters();
      appliedFilters = createEmptyFilters();
      recomputeDerived();
      notify('dataChanged');
    },

    // -------------------------------------------------------------------
    // Modo de eje X
    // -------------------------------------------------------------------
    /**
     * Cambia el modo de visualización de ventanas. No requiere reaplicar
     * filtros ni recalcular percentiles -- ver recomputeVisibleWindows().
     * @param {'auto'|'completo'} mode
     */
    setWindowMode(mode) {
      if (mode !== 'auto' && mode !== 'completo') {
        throw new Error(`Modo de ventana inválido: ${mode}. Debe ser 'auto' o 'completo'.`);
      }
      windowMode = mode;
      recomputeVisibleWindows();
      notify('viewChanged');
    },

    // -------------------------------------------------------------------
    // Suscripción (para que la futura interfaz reaccione a cambios)
    // -------------------------------------------------------------------
    /**
     * @param {(eventType: string, snapshot: object) => void} callback
     * @returns {number} id de suscripción, usar con unsubscribe()
     */
    subscribe(callback) {
      const id = nextListenerId();
      listeners.set(id, callback);
      return id;
    },

    unsubscribe(id) {
      listeners.delete(id);
    },

    // -------------------------------------------------------------------
    // Lectura de estado
    // -------------------------------------------------------------------
    getSnapshot,
  };
}
