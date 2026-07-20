// ============================================================================
// escenario-dispersion.js
// "Relación entre rendimiento y dispersión de las estrategias" (Sección 6.3
// del documento funcional v2 de Escenarios). Lectura complementaria del
// heatmap y el ranking -- no los reemplaza, no filtra ni oculta nada que
// esos dos ya muestren. Cada punto es una combinación elegible (n>=20) de
// Fecha de siembra × Ciclo, la misma fuente de datos que ya alimenta el
// ranking (rankingElegible del motor) -- no se calcula nada nuevo acá, solo
// se dibuja.
// ============================================================================

// Paleta cualitativa para Ciclo -- puede haber más categorías activas acá
// que en Comparar (hasta ~8-10 valores reales de ciclo, no los 4 grupos
// máximos de ese módulo), por eso es una paleta propia y más amplia, no una
// reutilización de PALETA_CATEGORICA de comparison-chart.js.
const PALETA_CICLOS = ['#2f5233', '#8a5fbf', '#c9784a', '#3d7ea6', '#a3492f', '#5c8a72', '#7a6a9e', '#b8863b', '#4a7a8c', '#8c4a6a'];

function nombreLegibleCiclo(ciclo) {
  return ciclo === 'S/D' ? 'Sin dato' : ciclo;
}

/**
 * Clave estable de una combinación (Ventana × Ciclo) -- mismo formato que
 * usa escenario-ranking.js para el hover sincronizado entre ambos
 * componentes (ninguno de los dos importa al otro; solo comparten esta
 * convención de texto).
 * @param {object} c una entrada de rankingElegible
 * @returns {string}
 */
export function clave(c) {
  return `${c.windowId}|${c.ciclo}`;
}

function colorPorCiclo(ciclosOrdenados) {
  const mapa = new Map();
  ciclosOrdenados.forEach((ciclo, i) => mapa.set(ciclo, PALETA_CICLOS[i % PALETA_CICLOS.length]));
  return mapa;
}

/**
 * Renderiza el gráfico de dispersión dentro de `containerId`.
 * @param {string} containerId
 * @param {object} params
 * @param {Array} params.rankingElegible snapshot.rankingElegible (motor, ya filtrado a n>=20)
 * @param {number|null} params.medianaDeMedianas referencia vertical
 * @param {number|null} params.medianaDeDispersiones referencia horizontal
 * @param {(clave:string|null)=>void} [params.onHoverPunto] se llama al pasar el mouse sobre un punto (o null al salir) -- para el hover sincronizado con el ranking
 * @returns {Array<{traceIndex:number, claves:string[]}>} contexto por traza, para resaltarPuntoEnDispersion()
 */
export function renderDispersion(containerId, { rankingElegible, medianaDeMedianas, medianaDeDispersiones, onHoverPunto }) {
  if (rankingElegible.length === 0) {
    Plotly.react(containerId, [], { annotations: [{ text: 'Sin combinaciones elegibles para este ambiente.', showarrow: false, xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, font: { size: 12, color: '#a3a39c' } }] }, { displayModeBar: false });
    return [];
  }

  // Ciclos en el orden en que aparecen por primera vez en rankingElegible --
  // sin reordenar por n ni alfabéticamente, mismo criterio de estabilidad ya
  // usado en el resto del producto (el orden de aparición no cambia porque
  // sí entre renders sucesivos del mismo escenario).
  const ciclosOrdenados = [];
  rankingElegible.forEach((c) => { if (!ciclosOrdenados.includes(c.ciclo)) ciclosOrdenados.push(c.ciclo); });
  const colorDeCiclo = colorPorCiclo(ciclosOrdenados);

  // Tamaño del punto: escala lineal simple entre un piso y un techo visual,
  // según n -- no representa una unidad exacta, es una señal relativa de
  // respaldo histórico dentro de este escenario particular.
  const nValues = rankingElegible.map((c) => c.n);
  const nMin = Math.min(...nValues);
  const nMax = Math.max(...nValues);
  function tamanoDelPunto(n) {
    if (nMax === nMin) return 14;
    return 8 + ((n - nMin) / (nMax - nMin)) * 20; // 8-28 px de diámetro aprox. (antes 10-36: las burbujas grandes tapaban demasiado)
  }

  // Una traza por ciclo (no una sola traza con array de colores) para que
  // Plotly arme la leyenda por categoría de forma nativa, igual que el
  // criterio ya usado en comparison-chart.js.
  const contextoPorTraza = [];
  const trazas = ciclosOrdenados.map((ciclo, indiceTraza) => {
    const puntos = rankingElegible.filter((c) => c.ciclo === ciclo);
    const claves = puntos.map(clave);
    contextoPorTraza.push({ traceIndex: indiceTraza, claves });
    return {
      type: 'scatter',
      mode: 'markers',
      name: nombreLegibleCiclo(ciclo),
      cliponaxis: false, // las burbujas cerca del borde del eje no quedan cortadas por el área de trazado
      x: puntos.map((c) => c.mediana),
      y: puntos.map((c) => c.dispersionRelativa),
      marker: {
        size: puntos.map((c) => tamanoDelPunto(c.n)),
        color: colorDeCiclo.get(ciclo),
        opacity: puntos.map(() => 0.75),
        line: { width: 1, color: 'rgba(0,0,0,0.15)' },
      },
      customdata: puntos.map((c) =>
        `<b>${c.windowLabel}</b><br>${nombreLegibleCiclo(c.ciclo)}<br>` +
        `n=${c.n}<br>Mediana: ${Math.round(c.mediana).toLocaleString('es-AR')} kg/ha<br>` +
        `P25: ${Math.round(c.p25).toLocaleString('es-AR')} · P75: ${Math.round(c.p75).toLocaleString('es-AR')}<br>` +
        `Dispersión relativa: ${c.dispersionRelativa}%`
      ),
      hovertemplate: '%{customdata}<extra></extra>',
    };
  });

  const shapes = [];
  const annotations = [];
  if (medianaDeMedianas !== null) {
    shapes.push({ type: 'line', xref: 'x', x0: medianaDeMedianas, x1: medianaDeMedianas, yref: 'paper', y0: 0, y1: 1, line: { color: '#c2c2b8', width: 1, dash: 'dot' } });
  }
  if (medianaDeDispersiones !== null) {
    shapes.push({ type: 'line', yref: 'y', y0: medianaDeDispersiones, y1: medianaDeDispersiones, xref: 'paper', x0: 0, x1: 1, line: { color: '#c2c2b8', width: 1, dash: 'dot' } });
  }

  const layout = {
    showlegend: true,
    legend: { orientation: 'h', y: 1.06, x: 0, font: { size: 11 } }, // más cerca del área de trazado (antes y:1.12)
    margin: { t: 34, r: 24, b: 58, l: 88 }, // margen izquierdo ampliado (antes 64) para que el título del eje Y y sus valores respiren
    xaxis: {
      title: { text: 'Mediana de rendimiento (kg/ha) →', font: { size: 11, color: '#a3a39c' } },
      zeroline: false, showgrid: false, tickfont: { size: 10, color: '#a3a39c' },
    },
    yaxis: {
      title: { text: '← Dispersión relativa (%)', font: { size: 11, color: '#a3a39c' } },
      zeroline: false, showgrid: false, tickfont: { size: 10, color: '#a3a39c' },
    },
    shapes,
    annotations,
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif', size: 12, color: '#6e6e68' },
  };

  Plotly.react(containerId, trazas, layout, { responsive: true, displayModeBar: false });

  // Hover sincronizado con el ranking (mismo mecanismo de comparison-chart.js:
  // aviso hacia afuera, sin cambiar nada de la interacción existente del
  // gráfico -- zoom, hover tabular, etc. siguen igual).
  const el = document.getElementById(containerId);
  if (typeof el.removeAllListeners === 'function') {
    el.removeAllListeners('plotly_hover');
    el.removeAllListeners('plotly_unhover');
  }
  if (onHoverPunto && typeof el.on === 'function') {
    el.on('plotly_hover', (eventData) => {
      const punto = eventData?.points?.[0];
      if (!punto) return;
      const contextoTraza = contextoPorTraza[punto.curveNumber];
      const claveDelPunto = contextoTraza?.claves?.[punto.pointIndex];
      if (claveDelPunto) onHoverPunto(claveDelPunto);
    });
    el.on('plotly_unhover', () => onHoverPunto(null));
  }

  return contextoPorTraza;
}

/**
 * Resalta un punto del gráfico de dispersión (o quita el resaltado si
 * `claveActiva` es null): atenúa la opacidad de los demás puntos, en todas
 * las trazas. Se usa desde afuera (hover sobre una fila del ranking) -- no
 * recalcula nada, solo ajusta `marker.opacity` con Plotly.restyle sobre las
 * trazas ya existentes.
 * @param {string} containerId
 * @param {Array<{traceIndex:number, claves:string[]}>} contextoPorTraza salida de renderDispersion()
 * @param {string|null} claveActiva
 */
export function resaltarPuntoEnDispersion(containerId, contextoPorTraza, claveActiva) {
  if (!contextoPorTraza || contextoPorTraza.length === 0) return;
  const traceIndices = [];
  const opacityUpdate = [];
  contextoPorTraza.forEach(({ traceIndex, claves }) => {
    traceIndices.push(traceIndex);
    opacityUpdate.push(claves.map((k) => (claveActiva === null ? 0.75 : (k === claveActiva ? 1 : 0.12))));
  });
  Plotly.restyle(containerId, { 'marker.opacity': opacityUpdate }, traceIndices);
}
