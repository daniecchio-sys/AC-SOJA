// ============================================================================
// charts.js
// Toda la interacción con Plotly vive acá adentro -- ningún otro módulo
// llama a Plotly.* directamente. Dibuja el gráfico principal (dispersión +
// líneas de percentil) y traduce la selección del mouse sobre el gráfico en
// un rango de "día de temporada" que el resto de la aplicación puede
// convertir en una condición más de la consulta.
//
// La banda de frecuencia ya NO comparte lienzo con el gráfico principal --
// mismo criterio aplicado a Comparar: dos gráficos Plotly independientes en
// dos contenedores separados, cada uno con su propia altura fija (en CSS),
// para que nada del gráfico principal pueda invadir el espacio de lo que
// sigue debajo. Ver renderHistogramaPrincipal().
// ============================================================================

import { diaDeTemporada, fechaDesdeDiaDeTemporada } from './stats.js';
import { construirTicksDeMeses, construirSombreadoPorMes } from './chart-x-axis.js';

// Paleta del gráfico — Iteración 2 de comunicación visual.
//
// Los puntos se agrupan en 3 lecturas (no 4): la clasificación del motor
// sigue siendo INFERIOR_A_P25 / ENTRE_P25_MEDIANA / ENTRE_MEDIANA_P75 /
// SUPERIOR_A_P75 (no se tocó), pero acá las dos categorías intermedias
// comparten el mismo color -- el "corredor de comportamiento observado"
// (P25 a P75) no distingue mediana con datos de lotes de producción; solo
// importa si una observación cae DENTRO, POR DEBAJO o POR ENCIMA del
// corredor. Naranja suave y verde institucional, nunca rojo: el objetivo es
// diferenciar comportamientos, no calificarlos de negativos.
const COLOR_POR_POSICION = {
  INFERIOR_A_P25: '#d18a4d',
  ENTRE_P25_MEDIANA: '#aaaa9e',
  ENTRE_MEDIANA_P75: '#aaaa9e',
  SUPERIOR_A_P75: '#2f5233',
  SIN_CLASIFICAR: '#e8e8e1',
};

// Etiquetas de lectura visual (distintas de CLASSIFICATION_LABELS del motor,
// que siguen siendo las 4 categorías canónicas para cualquier otro uso). Acá
// solo importa la lectura de 3 grupos que ve el usuario en el gráfico.
const NOMBRE_VISUAL_POSICION = {
  INFERIOR_A_P25: 'Por debajo del rango observado (P25–P75)',
  ENTRE_P25_MEDIANA: 'Dentro del rango observado (P25–P75)',
  ENTRE_MEDIANA_P75: 'Dentro del rango observado (P25–P75)',
  SUPERIOR_A_P75: 'Por encima del rango observado (P25–P75)',
  SIN_CLASIFICAR: 'Sin percentiles calculados en su ventana',
};

// Referencias horizontales fijas del eje Y -- únicamente estas dos, para
// facilitar la comparación visual sin sobrecargar el gráfico con grillas.
const REFERENCIAS_EJE_Y = [3000, 4000];

function colorDe(posicionRelativa) {
  return COLOR_POR_POSICION[posicionRelativa] || COLOR_POR_POSICION.SIN_CLASIFICAR;
}

function puntoMedioDeVentana(windowDef) {
  const diaMedio = Math.round((windowDef.diaInicio + windowDef.diaFin) / 2);
  return diaDeTemporada(windowDef.mes, diaMedio);
}

/**
 * Dibuja (o redibuja) el gráfico principal + banda de frecuencia dentro de
 * `containerId`. Usa Plotly.react, no Plotly.newPlot, para que las
 * actualizaciones sucesivas (cada vez que cambia la consulta) sean
 * eficientes y no recreen el DOM del gráfico desde cero.
 * @param {string} containerId
 * @param {object} params
 * @param {object[]} params.classifiedData salida de classifyObservations()
 * @param {Array} params.windows definición de ventanas (capa 1 del snapshot de estado)
 * @param {Array} params.visibleWindows resumen por ventana ya recortado según el modo de eje (capa 3, visibleWindows)
 * @param {(rango:{startDia:number, endDia:number, etiqueta:string})=>void} params.onRegionSelected
 */
export function renderMainChart(containerId, { classifiedData, windows, visibleWindows, onRegionSelected }) {
  const windowById = new Map(windows.map((w) => [w.id, w]));

  // --- puntos individuales ---
  const porPosicion = { INFERIOR_A_P25: [], ENTRE_P25_MEDIANA: [], ENTRE_MEDIANA_P75: [], SUPERIOR_A_P75: [], SIN_CLASIFICAR: [] };
  classifiedData.forEach((r) => {
    if (r.windowId === null) return; // fuera del período analizado: no se dibuja en este eje
    const dia = diaDeTemporada(r.fechaSiembraMes, r.fechaSiembraDia);
    const clave = r.posicionRelativa || 'SIN_CLASIFICAR';
    porPosicion[clave].push({ x: dia, y: r.rendimiento });
  });

  const trazasPuntos = Object.entries(porPosicion)
    .filter(([, pts]) => pts.length > 0)
    .map(([clave, pts]) => ({
      x: pts.map((p) => p.x),
      y: pts.map((p) => p.y),
      mode: 'markers',
      type: 'scattergl',
      name: NOMBRE_VISUAL_POSICION[clave] || 'Sin clasificar',
      marker: { size: 5, color: colorDe(clave), opacity: 0.75 },
      xaxis: 'x',
      yaxis: 'y',
      hovertemplate: `%{y:.0f} kg/ha<br>${NOMBRE_VISUAL_POSICION[clave] || ''}<extra></extra>`,
    }));

  // --- líneas guía de percentiles (solo ventanas con percentiles calculados) ---
  const conPercentiles = visibleWindows.filter((w) => w.mediana !== null);
  const xMediana = conPercentiles.map((w) => puntoMedioDeVentana(windowById.get(w.windowId)));

  // --- corredor de comportamiento observado (banda P25-P75) ---
  // No son "tres líneas con igual jerarquía": el objetivo no es exponer
  // estadísticas sino comunicar de un vistazo el rango de comportamiento
  // observado en datos de lotes de producción (no de un ensayo controlado).
  // Se dibuja como una banda continua, sin borde, en un color neutro y con
  // opacidad baja -- la mediana es la única línea de referencia que queda
  // con protagonismo dentro de ese corredor.
  //
  // Técnica Plotly: dos trazas de línea con line.width=0 (invisibles), la
  // segunda con fill:'tonexty', rellenan el área entre P75 (borde superior,
  // debe ir ANTES en el array de trazas) y P25 (borde inferior). Ninguna de
  // las dos expone tooltip propio -- el hover de la banda distraería del
  // propósito de "corredor", no de estadística puntual.
  const bordeSuperiorCorredor = {
    x: xMediana,
    y: conPercentiles.map((w) => w.p75),
    mode: 'lines',
    type: 'scatter',
    line: { width: 0 },
    hoverinfo: 'skip',
    showlegend: false,
    xaxis: 'x',
    yaxis: 'y',
  };
  const corredorObservado = {
    x: xMediana,
    y: conPercentiles.map((w) => w.p25),
    mode: 'lines',
    type: 'scatter',
    line: { width: 0 },
    fill: 'tonexty',
    fillcolor: 'rgba(140,140,128,0.13)',
    hoverinfo: 'skip',
    showlegend: false,
    xaxis: 'x',
    yaxis: 'y',
  };

  const lineaMediana = {
    x: xMediana,
    y: conPercentiles.map((w) => w.mediana),
    mode: 'lines+markers',
    type: 'scatter',
    name: 'Mediana',
    line: { color: '#1a1a18', width: 1.5 },
    marker: { size: 4, color: '#1a1a18' },
    xaxis: 'x',
    yaxis: 'y',
    hovertemplate: 'Mediana: %{y:.0f} kg/ha<extra></extra>',
  };

  const ticks = construirTicksDeMeses(visibleWindows, windowById);

  // Dos únicas referencias horizontales destacadas -- nada de grilla extra,
  // para facilitar la comparación visual sin sobrecargar el gráfico.
  const lineasDeReferencia = REFERENCIAS_EJE_Y.map((valor) => ({
    type: 'line',
    xref: 'paper', x0: 0, x1: 1,
    yref: 'y', y0: valor, y1: valor,
    line: { color: '#c2c2b8', width: 1, dash: 'dot' },
    layer: 'below',
  }));
  const etiquetasDeReferencia = REFERENCIAS_EJE_Y.map((valor) => ({
    xref: 'paper', x: 1, xanchor: 'left',
    yref: 'y', y: valor, yanchor: 'middle',
    text: `${(valor / 1000).toLocaleString('es-AR')}.000`,
    showarrow: false,
    font: { size: 10, color: '#a3a39c' },
  }));

  // Agrupamiento visual por mes: franjas de fondo muy sutiles, alternadas,
  // para que el cambio de mes se note de un vistazo -- mismo criterio ya
  // aplicado en Comparar, decoración pura sobre las mismas ventanas y ticks
  // que ya existían.
  const xMax = xMediana.length > 0 ? Math.max(...xMediana) + 3 : 100;
  const sombreadoPorMes = construirSombreadoPorMes(ticks, xMax);

  const layout = {
    dragmode: 'select',
    selectdirection: 'h',
    showlegend: false,
    margin: { t: 10, r: 34, b: 32, l: 44 },
    xaxis: {
      tickmode: 'array',
      tickvals: ticks.vals,
      ticktext: ticks.text,
      showgrid: false,
      zeroline: false,
      linecolor: '#ececE6',
      tickfont: { size: 11, color: '#a3a39c' },
    },
    // El corredor P25-P75 y la mediana ocupan ahora todo el dominio vertical
    // -- la banda de frecuencia se fue a su propio gráfico independiente
    // (renderHistogramaPrincipal), ya no hace falta reservarle espacio acá.
    yaxis: {
      title: { text: 'kg/ha', font: { size: 11, color: '#a3a39c' } },
      zeroline: false,
      showgrid: false,
      tickfont: { size: 10, color: '#a3a39c' },
    },
    shapes: [...sombreadoPorMes, ...lineasDeReferencia],
    annotations: etiquetasDeReferencia, // el título "Frecuencia de observaciones" ahora vive en HTML (con tooltip nativo), no como anotación de Plotly
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif', size: 12, color: '#6e6e68' },
  };

  const config = { responsive: true, displayModeBar: false, scrollZoom: false };

  Plotly.react(
    containerId,
    [...trazasPuntos, bordeSuperiorCorredor, corredorObservado, lineaMediana],
    layout,
    config
  );

  const el = document.getElementById(containerId);
  el.removeAllListeners?.('plotly_selected');
  el.on('plotly_selected', (eventData) => {
    if (!eventData || !eventData.range || !eventData.range.x) return;
    const [x0, x1] = eventData.range.x;
    const startDia = Math.max(0, Math.round(Math.min(x0, x1)));
    const endDia = Math.round(Math.max(x0, x1));
    const inicio = fechaDesdeDiaDeTemporada(startDia);
    const fin = fechaDesdeDiaDeTemporada(endDia);
    if (!inicio || !fin) return;
    onRegionSelected({
      startDia,
      endDia,
      etiqueta: `entre el ${inicio.label} y el ${fin.label}`,
    });
  });
  el.on('plotly_deselect', () => onRegionSelected(null));
}

/**
 * Dibuja el histograma de frecuencia como gráfico independiente -- mismas
 * ventanas y mismos ticks que el gráfico principal, para que el eje X quede
 * alineado entre ambos. Mismo patrón que renderHistogramaComparativo() en
 * comparison-chart.js.
 * @param {string} containerId
 * @param {object} params
 * @param {Array} params.windows
 * @param {Array} params.visibleWindows
 */
export function renderHistogramaPrincipal(containerId, { windows, visibleWindows }) {
  const windowById = new Map(windows.map((w) => [w.id, w]));
  const xFrecuencia = visibleWindows.map((w) => puntoMedioDeVentana(windowById.get(w.windowId)));

  const traza = {
    x: xFrecuencia,
    y: visibleWindows.map((w) => w.n),
    type: 'bar',
    marker: { color: '#e4e4dc' },
    hovertemplate: 'n=%{y}<extra></extra>',
    showlegend: false,
  };

  const ticks = construirTicksDeMeses(visibleWindows, windowById);
  const xMax = xFrecuencia.length > 0 ? Math.max(...xFrecuencia) + 3 : 100;
  const sombreadoPorMes = construirSombreadoPorMes(ticks, xMax);

  const layout = {
    margin: { t: 6, r: 34, b: 32, l: 44 },
    xaxis: {
      tickmode: 'array',
      tickvals: ticks.vals,
      ticktext: ticks.text,
      showgrid: false,
      zeroline: false,
      linecolor: '#ececE6',
      tickfont: { size: 11, color: '#a3a39c' },
    },
    yaxis: {
      title: { text: 'Frecuencia de lotes', font: { size: 10, color: '#a3a39c' } },
      showgrid: false,
      zeroline: false,
      tickfont: { size: 9, color: '#c2c2b8' },
    },
    shapes: sombreadoPorMes,
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif', size: 12, color: '#6e6e68' },
  };

  Plotly.react(containerId, [traza], layout, { responsive: true, displayModeBar: false, scrollZoom: false });
}
