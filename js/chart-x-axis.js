// ============================================================================
// chart-x-axis.js
// Utilidades PURAS y compartidas del eje X temporal (ticks de mes + franjas
// de sombreado alternado por mes), usadas por charts.js (Explorar) y
// comparison-chart.js (Comparar). Antes cada archivo tenía su propia copia
// idéntica de estas dos funciones -- se centralizan acá para no seguir
// duplicando lógica, sin cambiar ningún resultado (mismo cálculo, ahora en
// un solo lugar).
// ============================================================================

import { diaDeTemporada } from './stats.js';

const NOMBRE_MES = { 10: 'Oct', 11: 'Nov', 12: 'Dic', 1: 'Ene' };

/**
 * Un tick por cada mes presente en las ventanas visibles, en el primer día
 * de ese mes -- mismo criterio ya usado en todo el producto.
 * @param {Array} visibleWindows
 * @param {Map} windowById
 * @returns {{vals:number[], text:string[]}}
 */
export function construirTicksDeMeses(visibleWindows, windowById) {
  const vistos = new Set();
  const vals = [];
  const text = [];
  visibleWindows.forEach((w) => {
    const def = windowById.get(w.windowId);
    if (!def || vistos.has(def.mes)) return;
    vistos.add(def.mes);
    vals.push(diaDeTemporada(def.mes, 1));
    text.push(NOMBRE_MES[def.mes]);
  });
  return { vals, text };
}

/**
 * Franjas de fondo muy sutiles, alternadas por mes, para agrupar
 * visualmente Octubre/Noviembre/Diciembre/Enero -- decoración pura sobre
 * `layout.shapes`, no toca el motor de ventanas ni ningún cálculo.
 * @param {{vals:number[], text:string[]}} ticks
 * @param {number} xMax límite derecho del último tramo (el mayor punto x con datos, + margen)
 * @returns {Array} shapes de Plotly
 */
export function construirSombreadoPorMes(ticks, xMax) {
  return ticks.vals.map((xInicio, i) => {
    const xFin = i < ticks.vals.length - 1 ? ticks.vals[i + 1] : xMax;
    return {
      type: 'rect',
      xref: 'x', yref: 'paper',
      x0: xInicio, x1: xFin, y0: 0, y1: 1,
      fillcolor: i % 2 === 0 ? 'rgba(0,0,0,0.018)' : 'rgba(0,0,0,0.038)',
      line: { width: 0 },
      layer: 'below',
    };
  });
}
