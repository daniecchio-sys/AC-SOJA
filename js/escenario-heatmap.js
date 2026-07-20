// ============================================================================
// escenario-heatmap.js
// Heatmap Fecha de siembra × Ciclo (Sección 6.2 del documento funcional v2
// de Escenarios). Componente nuevo -- no reutiliza charts.js (esa función
// dibuja series temporales de puntos, esto es una grilla categórica), pero
// SÍ reutiliza Plotly como única librería de gráficos de todo el producto,
// y el patrón general (Plotly.react + hover con customdata) ya establecido
// en comparison-chart.js.
//
// MVP funcional: colores y tipografía provisorios, sin identidad CREA
// (pendiente para la etapa visual, fuera de alcance acá).
// ============================================================================

import { MIN_OBS_KPI } from './stats.js';

const RANGO_POR_DEFECTO = { min: 6, max: 17 }; // windowId 6-17 = Nov-Dic (ver buildFixedWindows)

function nombreLegibleCiclo(ciclo) {
  return ciclo === 'S/D' ? 'Sin dato' : ciclo;
}

/**
 * Renderiza el heatmap dentro de `containerId`.
 * @param {string} containerId
 * @param {object} params
 * @param {Array} params.heatmapFilas snapshot.heatmapFilas (motor)
 * @param {number[]} params.windowIds ids 0-20, en orden, de las 21 ventanas
 * @param {{min:number,max:number}} params.rangoVisible índices de windowId visibles (inclusive)
 * @param {boolean} params.mostrarEventuales
 */
export function renderHeatmap(containerId, { heatmapFilas, windowIds, rangoVisible, mostrarEventuales }) {
  const filasVisibles = heatmapFilas.filter((f) => f.esFrecuente || mostrarEventuales);
  const idsVisibles = windowIds.filter((id) => id >= rangoVisible.min && id <= rangoVisible.max);

  // Plotly heatmap: y de abajo hacia arriba por defecto -- se invierte el
  // orden de filas para que la primera fila frecuente quede arriba, lectura
  // más natural (mismo criterio de lectura de arriba-abajo que una tabla).
  const filasParaDibujar = [...filasVisibles].reverse();

  const yLabels = filasParaDibujar.map((f) => nombreLegibleCiclo(f.ciclo));
  const xLabels = idsVisibles.map((id) => {
    const fila = heatmapFilas[0].celdas.find((c) => c.windowId === id);
    return fila ? fila.label : String(id);
  });

  const z = [];
  const text = [];
  const customdata = [];

  filasParaDibujar.forEach((fila) => {
    const zFila = [];
    const textFila = [];
    const customdataFila = [];
    idsVisibles.forEach((id) => {
      const celda = fila.celdas.find((c) => c.windowId === id);
      if (!celda || celda.n === 0) {
        zFila.push(null);
        textFila.push('');
        customdataFila.push(`<b>${nombreLegibleCiclo(fila.ciclo)}</b><br>${celda ? celda.label : ''}<br>Sin observaciones`);
      } else if (celda.n < MIN_OBS_KPI) {
        zFila.push(null); // sin color pleno -- evidencia insuficiente (Sección 6.2 v2)
        textFila.push(`n=${celda.n}`);
        customdataFila.push(`<b>${nombreLegibleCiclo(fila.ciclo)}</b><br>${celda.label}<br>n=${celda.n} (insuficiente, mínimo ${MIN_OBS_KPI})`);
      } else {
        zFila.push(celda.mediana);
        textFila.push(`${Math.round(celda.mediana).toLocaleString('es-AR')}`);
        const disp = celda.dispersionRelativa !== null ? `${celda.dispersionRelativa}%` : '—';
        customdataFila.push(
          `<b>${nombreLegibleCiclo(fila.ciclo)}</b><br>${celda.label}<br>` +
          `n=${celda.n}<br>Mediana: ${Math.round(celda.mediana).toLocaleString('es-AR')} kg/ha<br>` +
          `P25: ${Math.round(celda.p25).toLocaleString('es-AR')} · P75: ${Math.round(celda.p75).toLocaleString('es-AR')}<br>` +
          `Dispersión relativa: ${disp}`
        );
      }
    });
    z.push(zFila);
    text.push(textFila);
    customdata.push(customdataFila);
  });

  const trazaPrincipal = {
    type: 'heatmap',
    x: xLabels,
    y: yLabels,
    z,
    text,
    texttemplate: '%{text}',
    textfont: { size: 10, color: '#2f2f2a' },
    customdata,
    hovertemplate: '%{customdata}<extra></extra>',
    colorscale: [[0, '#f4ede1'], [0.5, '#c9a76a'], [1, '#5b7a4f']], // provisorio, sin identidad CREA (etapa visual pendiente)
    showscale: true,
    colorbar: { title: { text: 'Mediana kg/ha', font: { size: 10 } }, thickness: 12 },
    xgap: 2,
    ygap: 2,
  };

  // Marca visual mínima (celda gris clara) para las celdas insuficientes --
  // reutiliza el mismo z=null que deja "en blanco" a las vacías, así que se
  // agrega una segunda traza, invisible salvo donde hay texto "n=X", para
  // diferenciarlas de las verdaderamente vacías sin necesitar sombreado
  // real (fuera de alcance visual de este MVP).
  const zAlerta = filasParaDibujar.map((fila) => idsVisibles.map((id) => {
    const celda = fila.celdas.find((c) => c.windowId === id);
    return celda && celda.n > 0 && celda.n < MIN_OBS_KPI ? 1 : null;
  }));
  const trazaAlerta = {
    type: 'heatmap',
    x: xLabels,
    y: yLabels,
    z: zAlerta,
    zmin: 0,
    zmax: 1,
    colorscale: [[0, '#e4e0d4'], [1, '#e4e0d4']],
    showscale: false,
    hoverinfo: 'skip',
    xgap: 2,
    ygap: 2,
  };

  const layout = {
    margin: { t: 20, r: 90, b: 60, l: 110 },
    xaxis: { side: 'bottom', tickfont: { size: 10 }, tickangle: -45 },
    yaxis: { tickfont: { size: 11 }, automargin: true },
    shapes: construirSombreadoPorMes(xLabels),
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif', size: 12, color: '#6e6e68' },
  };

  Plotly.react(containerId, [trazaAlerta, trazaPrincipal], layout, { responsive: true, displayModeBar: false });
}

/**
 * Franjas de fondo muy sutiles, alternadas por mes, para agrupar
 * visualmente Octubre/Noviembre/Diciembre/Enero -- mismo criterio ya usado
 * en el gráfico y el histograma de Comparar (comparison-chart.js), acá
 * adaptado a un eje X CATEGÓRICO (las etiquetas de ventana, "16-20
 * Noviembre", no un día numérico): Plotly resuelve x0/x1 de un `shape` a la
 * posición de esas categorías directamente. Decoración pura, no toca el
 * motor de ventanas ni ningún cálculo.
 * @param {string[]} xLabels etiquetas de ventana en el orden del eje X (ej. "16-20 Noviembre")
 * @returns {Array} shapes de Plotly
 */
function construirSombreadoPorMes(xLabels) {
  if (xLabels.length === 0) return [];
  const mesDeEtiqueta = (label) => label.split(' ').pop(); // último token: el nombre del mes

  const grupos = [];
  xLabels.forEach((label, i) => {
    const mes = mesDeEtiqueta(label);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.mes === mes) {
      ultimo.fin = i;
    } else {
      grupos.push({ mes, inicio: i, fin: i });
    }
  });

  return grupos.map((g, i) => ({
    type: 'rect',
    xref: 'x', yref: 'paper',
    x0: xLabels[g.inicio], x1: xLabels[g.fin],
    y0: 0, y1: 1,
    fillcolor: i % 2 === 0 ? 'rgba(0,0,0,0.018)' : 'rgba(0,0,0,0.038)',
    line: { width: 0 },
    layer: 'below',
  }));
}

export { RANGO_POR_DEFECTO };
