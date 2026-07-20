// ============================================================================
// comparison-state.js
// Única fuente de verdad del módulo COMPARAR. Análogo a state.js (Explorar),
// pero modela N subconjuntos en paralelo (hasta 4 grupos) en vez de uno solo.
//
// Decisión de arquitectura (aprobada explícitamente, opción A frente a
// instanciar createAppState() una vez por grupo): este módulo es dueño de un
// ORDEN ESTABLE ÚNICO de grupos, que gobierna sin excepciones la oración, la
// leyenda, el z-order del gráfico, las filas del hover y las filas de "Ver
// valores exactos" (Sección 6.1 del documento funcional de Comparar). Ese
// orden solo puede vivir en un único lugar -- de ahí que no alcance con
// reutilizar state.js tal cual.
//
// Reutiliza SIN modificar: applyFilters/getDistinctValues (filters.js),
// buildFixedWindows/computeWindowSummary/confidenceLevel (stats.js). No
// importa state.js -- su modelo (un solo filteredData) no encaja acá.
// ============================================================================

import { applyFilters, getDistinctValues, FILTERABLE_FIELDS } from './filters.js';
import { buildFixedWindows, computeWindowSummary, selectVisibleWindows } from './stats.js';
import { createIdGenerator, round } from './utils.js';
import { tituloLegible } from './query-builder.js';

// Mismo umbral que Explorar (Sección 10, punto 15 del documento funcional de
// Comparar: "la misma constante que en Explorar, no una nueva"). Se repite
// acá porque en Explorar vive en la capa de presentación (app.js), no en
// stats.js -- no hay un lugar compartido del que importarlo sin crear una
// dependencia nueva entre dos capas de presentación distintas.
export const MIN_OBS_KPI = 20;

export const MAX_GRUPOS = 4;

// Variables de agrupamiento permitidas (Sección 4 del documento funcional).
// Subconjunto de FILTERABLE_FIELDS -- se valida en tiempo de carga que todas
// existan en el motor, para detectar temprano un typo o un campo renombrado.
const CLAVES_VARIABLE_AGRUPAMIENTO = [
  'zona', 'ciclo', 'enso', 'riego', 'fertilizacion', 'ocupacion', 'antecesor',
];
CLAVES_VARIABLE_AGRUPAMIENTO.forEach((key) => {
  if (!FILTERABLE_FIELDS.some((f) => f.key === key)) {
    throw new Error(`comparison-state.js: la variable de agrupamiento "${key}" no existe en FILTERABLE_FIELDS (filters.js).`);
  }
});
export { CLAVES_VARIABLE_AGRUPAMIENTO };

/**
 * Mapeo de código interno -> terminología de producto, EXCLUSIVO de los
 * valores que un campo toma cuando se usa como variable de agrupamiento en
 * Comparar. Deliberadamente distinto de FRASE_POR_CAMPO (query-builder.js):
 * aquel redacta FRAGMENTOS DE ORACIÓN para el contexto ("con riego", "en
 * secano"); acá se necesita la forma NOMBRE de cada valor, para mostrarlo
 * como etiqueta de un grupo (pill, leyenda, hover, tabla, KPI) -- un
 * sustantivo, no una frase.
 *
 * Ronda de corrección de terminología (detectado: Riego mostraba "SI"/"NO"
 * en vez de "Riego"/"Secano" cuando se usaba como variable de
 * agrupamiento, mientras que en el contexto de Explorar/Paso 1 ya se leía
 * correcto por pasar por FRASE_POR_CAMPO). Solo se resuelve acá el caso
 * confirmado (riego). Se detectaron dos casos adicionales con el mismo
 * patrón -- códigos crudos en vez de terminología de producto cuando se
 * usan como grupo -- pero NO se resuelven en esta ronda hasta
 * confirmación:
 *   - ocupacion: valores '1°'/'2°'/'3°' se mostrarían tal cual (el
 *     contexto ya los traduce a "en siembra de primera/segunda/tercera"
 *     vía FRASE_POR_CAMPO; como grupo mostrarían el código crudo).
 *   - fertilizacion: valores 'CON FERTILIZACIÓN'/'SIN FERTILIZACIÓN'/'S/D'
 *     se mostrarían en mayúsculas tal cual, en vez de una forma más
 *     legible ("Con fertilización"/"Sin fertilización"/"Sin dato
 *     registrado").
 * Ver el aviso que acompaña esta entrega para más detalle de cada caso.
 */
const ETIQUETAS_DE_VALOR_POR_VARIABLE = {
  riego: { SI: 'Riego', NO: 'Secano' },
  ocupacion: { '1°': 'Primera', '2°': 'Segunda', '3°': 'Tercera' }, // pendiente de rondas anteriores -- confirmado ahora por el ejemplo "Primera" del pedido de reorganización de Comparar
};

/**
 * Etiqueta de producto para un valor de grupo, en función de la variable de
 * agrupamiento activa. Si la variable no tiene mapeo explícito (todavía no
 * lo necesita, o es un caso pendiente de confirmar -- ver comentario de
 * ETIQUETAS_DE_VALOR_POR_VARIABLE), se usa tituloLegible() de
 * query-builder.js -- la misma función que ya gobierna el resto del
 * producto para Title Case -- en vez de la capitalización ingenua anterior
 * (que solo ponía en mayúscula la primera letra de todo el string, y
 * fallaba con valores de más de una palabra).
 * @param {string} valor código interno tal como viene normalizado del motor
 * @param {string|null} variableAgrupamiento key de la variable de agrupamiento activa (ej. 'riego')
 * @returns {string}
 */
export function etiquetaDeGrupo(valor, variableAgrupamiento) {
  const mapa = ETIQUETAS_DE_VALOR_POR_VARIABLE[variableAgrupamiento];
  if (mapa && Object.prototype.hasOwnProperty.call(mapa, valor)) return mapa[valor];
  return tituloLegible(valor);
}

const nextListenerId = createIdGenerator();

/**
 * Crea una instancia independiente del estado de Comparar.
 * @returns {object} API del estado
 */
/**
 * Crea una instancia independiente del estado.
 * @param {object} [opciones]
 * @param {() => Array} [opciones.windowBuilder] función que construye las
 *   ventanas fijas -- por defecto buildFixedWindows() (5 días, la fuente de
 *   verdad vigente). Mismo parámetro, mismo motivo y mismo criterio ya
 *   agregado a state.js y escenario-state.js: permitir la prueba
 *   metodológica reversible de ventanas de ~10 días sin bifurcar este
 *   archivo. Sin este parámetro, Comparar queda exactamente igual.
 * @returns {object} API del estado
 */
export function createComparisonState({ windowBuilder = buildFixedWindows } = {}) {
  // ---- capa 1: datos base ----
  let rawRecords = [];
  const windows = windowBuilder(); // 21 ventanas de 5 días por defecto; parametrizable para pruebas

  // ---- capa 2: estado de interacción ----
  let contextoFilters = {}; // filtros del Paso 1 (universo de análisis), forma idéntica a appliedFilters de Explorar
  let variableAgrupamiento = null; // key de FILTERABLE_FIELDS, ej. 'zona'
  let gruposOrden = []; // array de valores de categoría, en ORDEN ESTABLE (orden de selección) -- única fuente de verdad del orden
  let gruposVisibles = new Map(); // valor de grupo -> boolean, visibilidad EN EL GRÁFICO (ver nota más abajo)
  let windowMode = 'auto'; // 'auto' | 'completo', mismo significado que en Explorar

  // ---- capa 3: estado derivado (se recalcula, nunca se edita a mano) ----
  let universoFiltrado = []; // contexto aplicado sobre rawRecords, sin la condición de grupo
  let grupos = []; // [{ valor, condition, filteredData, windowSummary, n }], mismo orden que gruposOrden
  let visibleWindowsPorGrupo = new Map(); // valor de grupo -> ventanas visibles recortadas
  let indicadores = { diferenciaMediana: null, diferenciaPiso: null };

  const listeners = new Map();
  function notify(eventType) {
    listeners.forEach((callback) => callback(eventType, getSnapshot()));
  }

  // -------------------------------------------------------------------
  // Recálculo
  // -------------------------------------------------------------------

  /**
   * Recalcula TODA la capa derivada. Único punto donde se encadena el
   * pipeline: contexto -> universo -> por cada grupo (condición de grupo
   * AND contexto) -> ventanas visibles -> indicadores comparativos.
   */
  function recomputeDerived() {
    universoFiltrado = applyFilters(rawRecords, contextoFilters);

    grupos = gruposOrden.map((valor) => {
      const condition = { type: 'in', values: [valor] };
      // AND acumulativo: reutiliza applyFilters tal cual, pasándole el
      // contexto + la condición del grupo como un filtro más -- ningún
      // comportamiento nuevo en filters.js, solo una combinación distinta
      // de las condiciones que ya entiende.
      const filtrosDelGrupo = { ...contextoFilters, [variableAgrupamiento]: condition };
      const filteredData = applyFilters(rawRecords, filtrosDelGrupo);
      const windowSummary = computeWindowSummary(filteredData, windows);
      const visible = gruposVisibles.has(valor) ? gruposVisibles.get(valor) : true;
      return { valor, condition, filteredData, windowSummary, n: filteredData.length, visible };
    });

    recomputeVisibleWindows();
    recomputeIndicadores();
  }

  /**
   * Recorta a ventanas visibles, por grupo. A diferencia de Explorar (un
   * único recorte), acá el recorte de bordes se calcula sobre la UNIÓN de
   * observaciones de todos los grupos activos -- si se recortara por grupo
   * de forma independiente, dos grupos podrían mostrar rangos de eje X
   * distintos, y el documento funcional exige "eje X e Y compartidos entre
   * todos los grupos" (Sección 5, punto 10).
   */
  function recomputeVisibleWindows() {
    visibleWindowsPorGrupo = new Map();
    if (windowMode === 'completo') {
      grupos.forEach((g) => visibleWindowsPorGrupo.set(g.valor, g.windowSummary));
      return;
    }
    // modo 'auto': un único recorte de bordes, común a todos los grupos,
    // basado en qué ventanas tienen datos en AL MENOS un grupo activo.
    const totalVentanas = windows.length;
    let primerIdx = null;
    let ultimoIdx = null;
    for (let idx = 0; idx < totalVentanas; idx++) {
      const algunGrupoConDatos = grupos.some((g) => g.windowSummary[idx].n > 0);
      if (algunGrupoConDatos) {
        if (primerIdx === null) primerIdx = idx;
        ultimoIdx = idx;
      }
    }
    grupos.forEach((g) => {
      const recorte = primerIdx === null ? [] : g.windowSummary.slice(primerIdx, ultimoIdx + 1);
      visibleWindowsPorGrupo.set(g.valor, recorte);
    });
  }

  /**
   * Indicadores comparativos (Sección 8-9 del documento funcional): mayor
   * diferencia de mediana y mayor diferencia de piso productivo (P25) entre
   * grupos, calculados solo sobre ventanas donde TODOS los grupos activos
   * alcanzan MIN_OBS_KPI simultáneamente (punto 16). Capa de presentación,
   * igual que "Mayor potencial observado" en Explorar -- no es un cálculo
   * nuevo de stats.js.
   */
  function recomputeIndicadores() {
    indicadores = { diferenciaMediana: null, diferenciaPiso: null };
    if (grupos.length < 2) return; // una diferencia necesita al menos 2 grupos

    const totalVentanas = windows.length;
    let mejorDeltaMediana = null;
    let mejorDeltaPiso = null;

    for (let idx = 0; idx < totalVentanas; idx++) {
      const resumenPorGrupo = grupos.map((g) => g.windowSummary[idx]);
      const todosElegibles = resumenPorGrupo.every((w) => w.n >= MIN_OBS_KPI && w.mediana !== null);
      if (!todosElegibles) continue; // punto 16: elegibilidad simultánea, no parcial

      const medianas = resumenPorGrupo.map((w) => w.mediana);
      const pisos = resumenPorGrupo.map((w) => w.p25);
      const deltaMediana = round(Math.max(...medianas) - Math.min(...medianas));
      const deltaPiso = round(Math.max(...pisos) - Math.min(...pisos));

      const iMaxMed = medianas.indexOf(Math.max(...medianas));
      const iMinMed = medianas.indexOf(Math.min(...medianas));
      const iMaxPiso = pisos.indexOf(Math.max(...pisos));
      const iMinPiso = pisos.indexOf(Math.min(...pisos));

      if (!mejorDeltaMediana || deltaMediana > mejorDeltaMediana.delta) {
        mejorDeltaMediana = {
          delta: deltaMediana,
          windowLabel: resumenPorGrupo[0].label,
          grupoSupera: grupos[iMaxMed].valor,
          grupoSuperado: grupos[iMinMed].valor,
        };
      }
      if (!mejorDeltaPiso || deltaPiso > mejorDeltaPiso.delta) {
        mejorDeltaPiso = {
          delta: deltaPiso,
          windowLabel: resumenPorGrupo[0].label,
          grupoSupera: grupos[iMaxPiso].valor,
          grupoSuperado: grupos[iMinPiso].valor,
        };
      }
    }

    indicadores = { diferenciaMediana: mejorDeltaMediana, diferenciaPiso: mejorDeltaPiso };
  }

  /**
   * Serializa el estado DEFINIDO POR EL USUARIO (nunca lo derivado) a la
   * forma exacta que espera el historial. Deliberadamente NO incluye
   * filteredData, windowSummary, percentiles, KPIs ni nada calculado -- eso
   * se reconstruye siempre con recomputeDerived() al restaurar, nunca se
   * guarda ni se compara.
   * @returns {{contextConditions: object, comparisonVariable: string|null, groups: Array<{key:string,label:string,visible:boolean}>}}
   */
  function getSerializableSnapshot() {
    return {
      contextConditions: JSON.parse(JSON.stringify(contextoFilters)),
      comparisonVariable: variableAgrupamiento,
      groups: gruposOrden.map((valor) => ({
        key: valor,
        label: etiquetaDeGrupo(valor, variableAgrupamiento),
        visible: gruposVisibles.has(valor) ? gruposVisibles.get(valor) : true,
      })),
    };
  }

  /**
   * Restaura el estado de interacción a partir de un snapshot serializado
   * (salida de getSerializableSnapshot) y recalcula TODA la capa derivada
   * con las mismas funciones que cualquier otro cambio de estado -- no hay
   * un camino especial de "restaurar" para los datos calculados, solo para
   * cuáles son los tres campos de interacción vigentes.
   * No dispara ninguna lógica de historial (push/pop) -- eso es
   * responsabilidad exclusiva de quien llama (el orquestador de la
   * interfaz), tal como history.js ya espera.
   * @param {object} snapshot
   */
  function restoreFromSnapshot(snapshot) {
    contextoFilters = JSON.parse(JSON.stringify(snapshot.contextConditions || {}));
    variableAgrupamiento = snapshot.comparisonVariable;
    gruposOrden = (snapshot.groups || []).map((g) => g.key);
    gruposVisibles = new Map((snapshot.groups || []).map((g) => [g.key, g.visible !== false]));
    recomputeDerived();
    notify('snapshotRestored');
  }

  function getSnapshot() {
    return {
      windows,
      nTotalDataset: rawRecords.length,
      contextoFilters,
      variableAgrupamiento,
      gruposOrden,
      gruposVisibles,
      windowMode,
      universoFiltrado,
      grupos,
      visibleWindowsPorGrupo,
      indicadores,
    };
  }

  return {
    // -------------------------------------------------------------------
    // Carga inicial
    // -------------------------------------------------------------------
    load(records) {
      rawRecords = records;
      recomputeDerived();
      notify('dataLoaded');
    },

    // -------------------------------------------------------------------
    // Paso 1: contexto (idéntico en forma a los filtros de Explorar)
    // -------------------------------------------------------------------
    setContexto(nuevoContexto) {
      contextoFilters = { ...nuevoContexto };
      recomputeDerived();
      notify('contextoChanged');
    },

    // -------------------------------------------------------------------
    // Variable de agrupamiento + selección automática de grupos
    // -------------------------------------------------------------------
    /**
     * Cambia la variable de agrupamiento. Descarta la selección de grupos
     * anterior y selecciona automáticamente hasta MAX_GRUPOS categorías por
     * mayor n en el contexto actual (punto 3-4 del documento funcional).
     * @param {string} fieldKey
     */
    setVariableAgrupamiento(fieldKey) {
      if (!CLAVES_VARIABLE_AGRUPAMIENTO.includes(fieldKey)) {
        throw new Error(`Variable de agrupamiento no permitida: ${fieldKey}`);
      }
      variableAgrupamiento = fieldKey;

      const universoActual = applyFilters(rawRecords, contextoFilters);
      const valoresDisponibles = getDistinctValues(universoActual, fieldKey);
      const conteos = valoresDisponibles.map((valor) => ({
        valor,
        n: universoActual.filter((r) => r[fieldKey] === valor).length,
      }));
      conteos.sort((a, b) => b.n - a.n);
      gruposOrden = conteos.slice(0, MAX_GRUPOS).map((c) => c.valor);
      gruposVisibles = new Map(gruposOrden.map((valor) => [valor, true]));

      recomputeDerived();
      notify('variableAgrupamientoChanged');
    },

    // -------------------------------------------------------------------
    // Gestión de grupos (agregar / quitar), respetando el orden estable
    // -------------------------------------------------------------------
    /**
     * Agrega un grupo al final del orden estable. No hace nada si ya está
     * en MAX_GRUPOS (punto 10.3: el buscador simplemente no ofrece la
     * acción; esta función es la salvaguarda del motor).
     * @param {string} valor
     */
    agregarGrupo(valor) {
      if (gruposOrden.includes(valor)) return;
      if (gruposOrden.length >= MAX_GRUPOS) return;
      gruposOrden = [...gruposOrden, valor];
      gruposVisibles.set(valor, true); // un grupo recién agregado siempre entra visible
      recomputeDerived();
      notify('gruposChanged');
    },

    /**
     * Quita un grupo del orden estable. Es la única acción que realmente
     * saca un grupo de la comparación (distinto de ocultarlo desde la
     * leyenda -- ver setGrupoVisible: ocultar SÍ vive en este estado desde
     * la conexión del historial, porque un estado navegable necesita poder
     * reconstruir exactamente qué estaba oculto, pero sigue sin afectar
     * `filteredData`, KPIs, indicadores ni la tabla de valores exactos --
     * punto 8, "ocultar no es lo mismo que quitar" solo cambia qué se
     * DIBUJA, no qué se CUENTA).
     * @param {string} valor
     */
    quitarGrupo(valor) {
      gruposOrden = gruposOrden.filter((v) => v !== valor);
      gruposVisibles.delete(valor);
      recomputeDerived();
      notify('gruposChanged');
    },

    /**
     * Cambia la visibilidad de un grupo en el gráfico (leyenda interactiva,
     * punto 8). No recalcula ningún dato derivado -- filteredData,
     * windowSummary, kpis e indicadores no dependen de la visibilidad, solo
     * de gruposOrden. Genera un cambio de estado navegable (el orquestador
     * decide si lo empuja al historial).
     * @param {string} valor
     * @param {boolean} visible
     */
    setGrupoVisible(valor, visible) {
      if (!gruposOrden.includes(valor)) return;
      gruposVisibles.set(valor, visible);
      grupos = grupos.map((g) => (g.valor === valor ? { ...g, visible } : g));
      notify('visibilidadChanged');
    },

    /** Valores disponibles para la variable de agrupamiento activa, para re-agregar un grupo (punto 6). */
    getValoresDisponibles() {
      if (!variableAgrupamiento) return [];
      return getDistinctValues(universoFiltrado, variableAgrupamiento);
    },

    puedeAgregarGrupo() {
      return gruposOrden.length < MAX_GRUPOS;
    },

    // -------------------------------------------------------------------
    // Modo de eje X (mismo significado que en Explorar)
    // -------------------------------------------------------------------
    setWindowMode(mode) {
      if (mode !== 'auto' && mode !== 'completo') {
        throw new Error(`Modo de ventana inválido: ${mode}. Debe ser 'auto' o 'completo'.`);
      }
      windowMode = mode;
      recomputeVisibleWindows();
      notify('viewChanged');
    },

    // -------------------------------------------------------------------
    // Historial: serialización / restauración (solo estado definido por el
    // usuario -- ver comentarios de cada función más arriba)
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
