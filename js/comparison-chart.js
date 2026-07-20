// ============================================================================
// comparison-chart.js
// Única puerta de entrada a Plotly para el módulo COMPARAR -- análogo a
// charts.js (Explorar), pero sin puntos individuales ni paleta ordinal: acá
// cada grupo es una banda P25-P75 + mediana en su propio color categórico.
//
// Ronda de consolidación visual: el gráfico principal y el histograma ya no
// comparten un mismo lienzo de Plotly (antes eran dos filas del mismo
// gráfico, con yaxis/yaxis2) -- ahora son dos gráficos Plotly independientes
// en dos contenedores separados, cada uno con su propia altura fija (fija
// en CSS, no acá) para que ocultar/mostrar bandas en uno nunca mueva al
// otro. La leyenda nativa de Plotly se eliminó por completo: las tarjetas
// de grupo (comparison-query.js) cumplen ese rol.
// ============================================================================

import { diaDeTemporada } from './stats.js';
import { etiquetaDeGrupo } from './comparison-state.js';
import { construirTicksDeMeses, construirSombreadoPorMes } from './chart-x-axis.js';

// Paleta categórica de Comparar -- distinta a propósito de la paleta ordinal
// de Explorar (naranja/gris/verde con sentido de posición). Acá el color NO
// ordena nada, solo identifica un grupo. Colores exactos definitivos: etapa
// de diseño visual (documento funcional, Sección 4, punto 9) -- estos son
// una paleta provisoria suficientemente distinguible para el MVP.
export const PALETA_CATEGORICA = ['#2f5233', '#8a5fbf', '#c9784a', '#3d7ea6'];

const REFERENCIAS_EJE_Y = [3000, 4000]; // idéntico a charts.js

function colorDeGrupo(indice) {
  return PALETA_CATEGORICA[indice % PALETA_CATEGORICA.length];
}

function puntoMedioDeVentana(windowDef) {
  const diaMedio = Math.round((windowDef.diaInicio + windowDef.diaFin) / 2);
  return diaDeTemporada(windowDef.mes, diaMedio);
}

/**
 * Dibuja (o redibuja) el gráfico comparativo dentro de `containerId`. Solo
 * medianas y bandas P25-P75 -- la banda de frecuencia ahora es un gráfico
 * aparte (ver renderHistogramaComparativo).
 * @param {string} containerId
 * @param {object} params
 * @param {Array} params.windows definición de ventanas fijas (capa 1 del estado)
 * @param {Array} params.grupos [{ valor, windowSummary, n }], en el ORDEN ESTABLE
 * @param {Map} params.visibleWindowsPorGrupo valor de grupo -> ventanas visibles recortadas
 * @param {boolean} [params.mostrarBandas] si es false, no se dibujan las bandas P25-P75 (las medianas se conservan)
 * @param {(valorGrupo:string|null)=>void} [params.onHoverGrupo] se llama al pasar el mouse sobre una curva/banda (o null al salir)
 * @returns {Map<string, number[]>} índices de traza por grupo, para sincronizar el resaltado desde afuera (tarjetas de grupo)
 */
export function renderComparisonChart(containerId, { windows, grupos, visibleWindowsPorGrupo, variableAgrupamiento, mostrarBandas = true, onHoverGrupo }) {
  const windowById = new Map(windows.map((w) => [w.id, w]));
  const trazas = [];
  const indicesPorGrupo = new Map();

  grupos.forEach((grupo, indice) => {
    const color = colorDeGrupo(indice);
    const visibles = (visibleWindowsPorGrupo.get(grupo.valor) || []).filter((w) => w.mediana !== null);
    const x = visibles.map((w) => puntoMedioDeVentana(windowById.get(w.windowId)));
    // La visibilidad ES estado (comparison-state.js, desde la conexión del
    // historial) -- Plotly.react se redibuja con visible/legendonly ya
    // resuelto desde acá. Ahora se activa/desactiva desde el clic en la
    // tarjeta de grupo (ya no desde una leyenda de Plotly, eliminada).
    const visiblePlotly = grupo.visible === false ? 'legendonly' : true;
    const indicesDeEsteGrupo = [];

    // Banda P25-P75 del grupo -- jerarquía visual reducida a propósito:
    // relleno tenue para que la mediana sea la protagonista. Si
    // mostrarBandas=false, se omiten por completo -- las medianas no se ven
    // afectadas, ni tampoco la altura del gráfico (fija en CSS).
    if (mostrarBandas) {
      indicesDeEsteGrupo.push(trazas.length);
      trazas.push({
        x,
        y: visibles.map((w) => w.p75),
        mode: 'lines',
        type: 'scatter',
        line: { width: 0 },
        hoverinfo: 'skip',
        showlegend: false,
        legendgroup: grupo.valor,
        visible: visiblePlotly,
      });
      indicesDeEsteGrupo.push(trazas.length);
      trazas.push({
        x,
        y: visibles.map((w) => w.p25),
        mode: 'lines',
        type: 'scatter',
        line: { width: 0 },
        fill: 'tonexty',
        fillcolor: hexConOpacidad(color, 0.10),
        hoverinfo: 'skip',
        showlegend: false,
        legendgroup: grupo.valor,
        visible: visiblePlotly,
      });
    }

    // Mediana del grupo -- única línea con protagonismo.
    indicesDeEsteGrupo.push(trazas.length);
    trazas.push({
      x,
      y: visibles.map((w) => w.mediana),
      mode: 'lines+markers',
      type: 'scatter',
      name: `${etiquetaDeGrupo(grupo.valor, variableAgrupamiento)} · n=${grupo.n.toLocaleString('es-AR')}`,
      line: { color, width: 2.5 },
      marker: { size: 5, color },
      legendgroup: grupo.valor,
      showlegend: false, // la leyenda nativa se eliminó -- las tarjetas de grupo cumplen ese rol
      visible: visiblePlotly,
      hoverinfo: 'skip', // el hover real lo resuelve la traza-ancla unificada, no cada línea
    });

    indicesPorGrupo.set(grupo.valor, indicesDeEsteGrupo);
  });

  // --- traza-ancla invisible para el hover tabular unificado ---
  const todasLasVentanasVisibles = ventanasVisiblesUnion(windows, grupos, visibleWindowsPorGrupo);
  if (todasLasVentanasVisibles.length > 0) {
    const yMedio = calcularYMedio(grupos, visibleWindowsPorGrupo);
    trazas.push({
      x: todasLasVentanasVisibles.map((w) => puntoMedioDeVentana(windowById.get(w.windowId))),
      y: todasLasVentanasVisibles.map(() => yMedio),
      mode: 'markers',
      type: 'scatter',
      marker: { size: 30, opacity: 0 },
      showlegend: false,
      hoverlabel: { font: { family: 'monospace', size: 11 }, align: 'left' },
      hovertemplate: '%{customdata}<extra></extra>',
      customdata: todasLasVentanasVisibles.map((w) => textoHoverVentana(w, grupos, visibleWindowsPorGrupo, variableAgrupamiento)),
    });
  }

  const ticks = construirTicksDeMeses(todasLasVentanasVisibles, windowById);
  const xMax = todasLasVentanasVisibles.length > 0
    ? Math.max(...todasLasVentanasVisibles.map((w) => puntoMedioDeVentana(windowById.get(w.windowId)))) + 3
    : 100;

  const lineasDeReferencia = REFERENCIAS_EJE_Y.map((valor) => ({
    type: 'line',
    xref: 'paper', x0: 0, x1: 1,
    yref: 'y', y0: valor, y1: valor,
    line: { color: '#dedad0', width: 1, dash: 'dot' },
    layer: 'below',
  }));
  const etiquetasDeReferencia = REFERENCIAS_EJE_Y.map((valor) => ({
    xref: 'paper', x: 1, xanchor: 'left',
    yref: 'y', y: valor, yanchor: 'middle',
    text: `${(valor / 1000).toLocaleString('es-AR')}.000`,
    showarrow: false,
    font: { size: 10, color: '#c2c2b8' },
  }));

  // Agrupamiento visual por mes: franjas de fondo muy sutiles, alternadas,
  // para que el cambio de mes se note de un vistazo sin tocar el motor de
  // ventanas -- decoración sobre las mismas ventanas y ticks que ya existían.
  const sombreadoPorMes = construirSombreadoPorMes(ticks, xMax);

  const layout = {
    showlegend: false, // reemplazada por las tarjetas de grupo
    hovermode: 'closest',
    margin: { t: 20, r: 34, b: 32, l: 44 },
    xaxis: {
      tickmode: 'array',
      tickvals: ticks.vals,
      ticktext: ticks.text,
      showgrid: false,
      zeroline: false,
      linecolor: '#ececE6',
      tickfont: { size: 12, color: '#8c8c84' },
    },
    yaxis: {
      title: { text: 'kg/ha', font: { size: 11, color: '#a3a39c' } },
      zeroline: false,
      showgrid: false,
      tickfont: { size: 10, color: '#a3a39c' },
    },
    shapes: [...sombreadoPorMes, ...lineasDeReferencia],
    annotations: etiquetasDeReferencia,
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif', size: 12, color: '#6e6e68' },
  };

  const config = { responsive: true, displayModeBar: false, scrollZoom: false };

  Plotly.react(containerId, trazas, layout, config);

  // Hover sincronizado: pasar el mouse sobre una curva/banda avisa qué
  // grupo es, para que la tarjeta correspondiente se resalte en el DOM.
  const el = document.getElementById(containerId);
  if (typeof el.removeAllListeners === 'function') {
    el.removeAllListeners('plotly_hover');
    el.removeAllListeners('plotly_unhover');
  }
  if (onHoverGrupo && typeof el.on === 'function') {
    el.on('plotly_hover', (eventData) => {
      const traza = eventData?.points?.[0]?.data;
      if (traza && traza.legendgroup) onHoverGrupo(traza.legendgroup);
    });
    el.on('plotly_unhover', () => onHoverGrupo(null));
  }

  return indicesPorGrupo;
}

/**
 * Dibuja el histograma de frecuencia como gráfico independiente -- mismas
 * ventanas y mismos ticks que el gráfico principal, para que el eje X
 * quede alineado entre ambos.
 * @param {string} containerId
 * @param {object} params
 * @param {Array} params.windows
 * @param {Array} params.grupos
 * @param {Map} params.visibleWindowsPorGrupo
 */
export function renderHistogramaComparativo(containerId, { windows, grupos, visibleWindowsPorGrupo }) {
  const windowById = new Map(windows.map((w) => [w.id, w]));
  const todasLasVentanasVisibles = ventanasVisiblesUnion(windows, grupos, visibleWindowsPorGrupo);

  const frecuenciaPorVentana = windows.map((w) => {
    const total = grupos.reduce((acc, g) => {
      const entry = g.windowSummary.find((s) => s.windowId === w.id);
      return acc + (entry ? entry.n : 0);
    }, 0);
    return { windowId: w.id, total };
  }).filter((f) => todasLasVentanasVisibles.some((w) => w.windowId === f.windowId));

  const traza = {
    x: frecuenciaPorVentana.map((f) => puntoMedioDeVentana(windowById.get(f.windowId))),
    y: frecuenciaPorVentana.map((f) => f.total),
    type: 'bar',
    marker: { color: '#d8d4c8' },
    hovertemplate: 'n total=%{y}<extra></extra>',
    showlegend: false,
  };

  const ticks = construirTicksDeMeses(todasLasVentanasVisibles, windowById);
  const xMax = todasLasVentanasVisibles.length > 0
    ? Math.max(...todasLasVentanasVisibles.map((w) => puntoMedioDeVentana(windowById.get(w.windowId)))) + 3
    : 100;
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
      tickfont: { size: 12, color: '#8c8c84' },
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

/**
 * Resalta un grupo dentro de un gráfico ya dibujado (o quita el resaltado si
 * `valorActivo` es null): atenúa la opacidad de las trazas de los demás
 * grupos. Se usa desde afuera (hover sobre una tarjeta de grupo) -- no
 * vuelve a calcular ni a redibujar nada, solo ajusta opacidad con
 * Plotly.restyle sobre las trazas ya existentes.
 * @param {string} containerId
 * @param {Map<string, number[]>} indicesPorGrupo salida de renderComparisonChart()
 * @param {string|null} valorActivo grupo a resaltar, o null para restaurar todos
 */
export function resaltarGrupoEnGrafico(containerId, indicesPorGrupo, valorActivo) {
  const todosLosIndices = [];
  const opacidades = [];
  indicesPorGrupo.forEach((indices, valor) => {
    const opacidad = valorActivo === null || valorActivo === valor ? 1 : 0.2;
    indices.forEach((i) => { todosLosIndices.push(i); opacidades.push(opacidad); });
  });
  if (todosLosIndices.length === 0) return;
  Plotly.restyle(containerId, { opacity: opacidades }, todosLosIndices);
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function hexConOpacidad(hex, opacidad) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacidad})`;
}

function ventanasVisiblesUnion(windows, grupos, visibleWindowsPorGrupo) {
  const idsConDatos = new Set();
  grupos.forEach((g) => {
    (visibleWindowsPorGrupo.get(g.valor) || []).forEach((w) => {
      if (w.n > 0) idsConDatos.add(w.windowId);
    });
  });
  const cualquierGrupo = grupos[0];
  const rangoVisible = cualquierGrupo ? (visibleWindowsPorGrupo.get(cualquierGrupo.valor) || []) : [];
  return rangoVisible.filter((w) => idsConDatos.has(w.windowId));
}

function calcularYMedio(grupos, visibleWindowsPorGrupo) {
  const valores = [];
  grupos.forEach((g) => {
    (visibleWindowsPorGrupo.get(g.valor) || []).forEach((w) => {
      if (w.mediana !== null) valores.push(w.mediana);
    });
  });
  if (valores.length === 0) return 0;
  return valores.reduce((a, b) => a + b, 0) / valores.length;
}

/**
 * Arma el texto de la tabla unificada de hover para una ventana: una fila
 * por grupo activo, columnas n/P25/Mediana/P75/Δ Mediana respecto del
 * primer grupo del orden estable (grupo de referencia).
 * @param {object} ventanaRef
 * @param {Array} grupos
 * @param {Map} visibleWindowsPorGrupo
 * @param {string} variableAgrupamiento
 * @returns {string}
 */
function textoHoverVentana(ventanaRef, grupos, visibleWindowsPorGrupo, variableAgrupamiento) {
  const filas = grupos.map((g) => {
    const entry = (visibleWindowsPorGrupo.get(g.valor) || []).find((w) => w.windowId === ventanaRef.windowId)
      || g.windowSummary.find((w) => w.windowId === ventanaRef.windowId);
    return { grupo: g.valor, entry };
  });

  const grupoReferencia = filas[0];
  const medianaReferencia = grupoReferencia.entry && grupoReferencia.entry.n >= 20 ? grupoReferencia.entry.mediana : null;

  const lineas = [`<b>${ventanaRef.label}</b>`, ''];
  filas.forEach(({ grupo, entry }, i) => {
    const nombre = etiquetaDeGrupo(grupo, variableAgrupamiento);
    if (!entry || entry.n < 5) {
      const nMostrado = entry ? entry.n : 0;
      lineas.push(`${nombre.padEnd(14)} n=${nMostrado} · insuficiente`);
      return;
    }
    const p25 = entry.p25 !== null ? Math.round(entry.p25) : '—';
    const mediana = entry.mediana !== null ? Math.round(entry.mediana) : '—';
    const p75 = entry.p75 !== null ? Math.round(entry.p75) : '—';
    let deltaTxt;
    if (i === 0) {
      deltaTxt = 'Referencia';
    } else if (medianaReferencia === null || entry.mediana === null) {
      deltaTxt = '—';
    } else {
      const delta = Math.round(entry.mediana - medianaReferencia);
      deltaTxt = (delta > 0 ? '+' : '') + delta;
    }
    lineas.push(`${nombre.padEnd(14)} n=${entry.n}  P25=${p25}  Med=${mediana}  P75=${p75}  Δ=${deltaTxt}`);
  });

  return lineas.join('<br>');
}
