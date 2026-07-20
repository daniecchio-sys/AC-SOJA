// ============================================================================
// comparar-app-prueba-10dias.js
// PRUEBA METODOLÓGICA REVERSIBLE -- copia de comparar-app.js con un único
// cambio real de motor: el estado usa buildVentanas10Dias() en vez de las
// 5 días vigentes. No es la fuente de verdad -- ver
// comparar-prueba-10dias.html. Todo lo demás es exactamente comparar-app.js,
// incluida la consolidación visual completa (título estable, tarjeta de
// universo, tarjetas de grupo interactivas con hover sincronizado,
// histograma independiente, sombreado por mes, toggle de bandas,
// indicadores comparativos como tarjetas). Ningún cálculo, regla ni
// componente de motor cambió.
//
// Reutiliza SIN modificar: comparison-state.js (motor, ahora parametrizado
// con windowBuilder igual que state.js/escenario-state.js), query-builder.js,
// history.js.
// ============================================================================

import { loadDataset } from './data-loader.js';
import { createComparisonState, CLAVES_VARIABLE_AGRUPAMIENTO, MIN_OBS_KPI, etiquetaDeGrupo } from './comparison-state.js';
import { buildVentanas10Dias } from './stats-ventanas-10dias.js';
import { createHistory } from './history.js';
import { renderComparisonChart, renderHistogramaComparativo, resaltarGrupoEnGrafico, PALETA_CATEGORICA } from './comparison-chart.js';
import {
  renderContexto,
  abrirBuscadorDeContexto,
  renderFilaDeGrupos,
  abrirBuscadorDeGrupo,
  resumenContextoCorto,
  comparandoPorCorto,
  renderTarjetaUniverso,
} from './comparison-query.js';
import { FILTERABLE_FIELDS } from './filters.js';

const state = createComparisonState({ windowBuilder: buildVentanas10Dias }); // única diferencia real de motor con comparar-app.js
const historial = createHistory();

const el = {
  historialAtras: document.getElementById('historial-atras'),
  historialAdelante: document.getElementById('historial-adelante'),
  contextoCorto: document.getElementById('contexto-corto'),
  comparandoCorto: document.getElementById('comparando-corto'),
  contextoOracion: document.getElementById('contexto-oracion'),
  selectVariable: document.getElementById('select-variable'),
  tarjetaUniverso: document.getElementById('tarjeta-universo'),
  filaGrupos: document.getElementById('fila-grupos'),
  gridIndicadores: document.getElementById('grid-indicadores-comparativos'),
  toggleBandas: document.getElementById('toggle-bandas'),
  tablaBody: document.getElementById('tabla-comparar-body'),
};

// Estado de INTERFAZ (no del motor, no forma parte del historial) -- mismo
// criterio que windowMode en Comparar o mostrarCiclosEventuales en
// Escenarios: es una preferencia de vista, no una condición del análisis.
let mostrarBandas = true;
let indicesPorGrupoActual = new Map(); // salida de renderComparisonChart(), para el hover sincronizado

init();

async function init() {
  const csvText = await fetch('data/ac_soja.csv').then((r) => r.text());
  const { records } = loadDataset(csvText);
  state.load(records);

  poblarSelectorDeVariable();
  // variable inicial: la primera de la lista permitida (Sección 4), dispara
  // la selección automática de hasta 4 grupos por mayor n.
  state.setVariableAgrupamiento(CLAVES_VARIABLE_AGRUPAMIENTO[0]);
  el.selectVariable.value = CLAVES_VARIABLE_AGRUPAMIENTO[0];

  // Único push "inicial": representa el primer estado navegable completo
  // (contexto vacío + variable por defecto + selección automática de
  // grupos), igual que app.js empuja su primer estado tras load() en
  // Explorar.
  historial.push(state.getSerializableSnapshot());

  render();
}

function poblarSelectorDeVariable() {
  el.selectVariable.innerHTML = '';
  CLAVES_VARIABLE_AGRUPAMIENTO.forEach((key) => {
    const field = FILTERABLE_FIELDS.find((f) => f.key === key);
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = field ? field.label : key;
    el.selectVariable.appendChild(opt);
  });
}

el.selectVariable.addEventListener('change', () => {
  // punto 7 del documento funcional: cambiar la variable descarta la
  // selección de grupos anterior y repite la selección automática.
  state.setVariableAgrupamiento(el.selectVariable.value);
  registrarEstadoSiCambio();
  render();
});

el.toggleBandas.addEventListener('change', () => {
  mostrarBandas = el.toggleBandas.checked;
  render(); // preferencia de vista -- no pasa por registrarEstadoSiCambio(), no forma parte del historial
});

// ---------------------------------------------------------------------------
// Historial (atrás / adelante) -- reutiliza history.js sin modificarlo.
// ---------------------------------------------------------------------------

function registrarEstadoSiCambio() {
  const nuevo = state.getSerializableSnapshot();
  const actual = historial.current();
  if (actual && JSON.stringify(actual) === JSON.stringify(nuevo)) return;
  historial.push(nuevo);
}

el.historialAtras.addEventListener('click', () => {
  const snap = historial.back();
  if (!snap) return;
  state.restoreFromSnapshot(snap); // restaurar NUNCA empuja
  render();
});
el.historialAdelante.addEventListener('click', () => {
  const snap = historial.forward();
  if (!snap) return;
  state.restoreFromSnapshot(snap);
  render();
});

// ---------------------------------------------------------------------------
// Constructor de comparación (contexto)
// ---------------------------------------------------------------------------

function agregarCondicionDeContexto(key, condition) {
  const snap = state.getSnapshot();
  const nuevoContexto = { ...snap.contextoFilters, [key]: condition };
  state.setContexto(nuevoContexto);
  registrarEstadoSiCambio();
  render();
}

function quitarCondicionDeContexto(key) {
  const snap = state.getSnapshot();
  const nuevoContexto = { ...snap.contextoFilters };
  delete nuevoContexto[key];
  state.setContexto(nuevoContexto);
  registrarEstadoSiCambio();
  render();
}

// ---------------------------------------------------------------------------
// Gestión de grupos
// ---------------------------------------------------------------------------

function quitarGrupo(valor) {
  state.quitarGrupo(valor);
  registrarEstadoSiCambio();
  render();
}

function solicitarAgregarGrupo(anchorEl) {
  const valoresDisponibles = state.getValoresDisponibles()
    .filter((v) => !state.getSnapshot().gruposOrden.includes(v));
  abrirBuscadorDeGrupo({
    anchorEl,
    valoresDisponibles,
    variableAgrupamiento: state.getSnapshot().variableAgrupamiento,
    onSelect: (valor) => {
      state.agregarGrupo(valor);
      registrarEstadoSiCambio();
      render();
    },
  });
}

/** Toggle de visibilidad desde la leyenda del gráfico -- genera un estado navegable propio. */
function toggleVisibilidadGrupo(valor) {
  const grupoActual = state.getSnapshot().grupos.find((g) => g.valor === valor);
  const visibleActual = grupoActual ? grupoActual.visible !== false : true;
  state.setGrupoVisible(valor, !visibleActual);
  registrarEstadoSiCambio();
  render();
}

/**
 * Hover sincronizado: resalta un grupo en el gráfico ya dibujado y marca su
 * tarjeta con una clase CSS -- no cambia ninguna lógica de selección/click,
 * solo la respuesta visual al pasar el mouse.
 * @param {string|null} valor
 */
function onHoverGrupo(valor) {
  resaltarGrupoEnGrafico('grafico-comparativo', indicesPorGrupoActual, valor);
  document.querySelectorAll('.grupo-tarjeta').forEach((t) => t.classList.remove('grupo-tarjeta-resaltada'));
  if (valor !== null) {
    const tarjeta = document.querySelector(`.grupo-tarjeta[data-grupo-valor="${valor}"]`);
    if (tarjeta) tarjeta.classList.add('grupo-tarjeta-resaltada');
  }
}

// ---------------------------------------------------------------------------
// Render general
// ---------------------------------------------------------------------------

function render() {
  const snap = state.getSnapshot();

  el.historialAtras.disabled = !historial.canGoBack();
  el.historialAdelante.disabled = !historial.canGoForward();

  if (el.selectVariable.value !== snap.variableAgrupamiento) {
    el.selectVariable.value = snap.variableAgrupamiento;
  }

  // 1. Título del módulo -- estable, no depende de nada del estado.
  // Resumen corto de contexto y variable, ambos de solo lectura.
  el.contextoCorto.textContent = `Contexto: ${resumenContextoCorto(snap.contextoFilters)}`;
  el.comparandoCorto.textContent = `Comparando por: ${comparandoPorCorto(snap.variableAgrupamiento)}`;

  // 2. Constructor de comparación
  renderContexto(el.contextoOracion, {
    contextoFilters: snap.contextoFilters,
    onRemove: quitarCondicionDeContexto,
    onRequestAdd: (anchorEl) => {
      abrirBuscadorDeContexto({
        anchorEl,
        records: snap.universoFiltrado.length > 0 ? snap.universoFiltrado : state.getSnapshot().universoFiltrado,
        onSelect: agregarCondicionDeContexto,
      });
    },
  });

  // 3. Tarjeta resumen del universo -- ya no lista los grupos individuales
  // (Sección 1 de esta ronda), solo el total, la variable y CUÁNTOS grupos hay.
  renderTarjetaUniverso(el.tarjetaUniverso, {
    nUniverso: snap.universoFiltrado.length,
    variableAgrupamiento: snap.variableAgrupamiento,
    cantidadGrupos: snap.grupos.length,
  });

  // 4. Tarjetas de grupo -- única identificación permanente en pantalla
  // (Sección 2-3): clic alterna mostrar/ocultar, el botón × quita el grupo.
  renderFilaDeGrupos(el.filaGrupos, {
    grupos: snap.grupos,
    puedeAgregar: state.puedeAgregarGrupo(),
    variableAgrupamiento: snap.variableAgrupamiento,
    onQuitar: quitarGrupo,
    onToggleVisibilidad: toggleVisibilidadGrupo,
    onRequestAgregar: solicitarAgregarGrupo,
    onHoverGrupo,
  });

  // 5. Gráfico principal (solo medianas + bandas)
  if (snap.grupos.length > 0) {
    indicesPorGrupoActual = renderComparisonChart('grafico-comparativo', {
      windows: snap.windows,
      grupos: snap.grupos,
      visibleWindowsPorGrupo: snap.visibleWindowsPorGrupo,
      variableAgrupamiento: snap.variableAgrupamiento,
      mostrarBandas,
      onHoverGrupo,
    });

    // 6. Histograma independiente -- mismo eje X, ya no comparte lienzo
    // con el gráfico principal (Sección 6 de esta ronda).
    renderHistogramaComparativo('histograma-comparativo', {
      windows: snap.windows,
      grupos: snap.grupos,
      visibleWindowsPorGrupo: snap.visibleWindowsPorGrupo,
    });
  }

  // 7. Indicadores comparativos, como tarjetas
  renderIndicadoresComparativos(snap);

  renderTablaValoresExactos(snap);
}

// ---------------------------------------------------------------------------
// Indicadores comparativos -- mismo lenguaje visual que los KPIs de
// Escenarios (.kpi-destacado), mismos dos indicadores de siempre (Δ
// Mediana, Δ Piso), sin agregar métricas nuevas.
// ---------------------------------------------------------------------------

function renderIndicadoresComparativos(snap) {
  el.gridIndicadores.innerHTML = '';
  pintarIndicadorComparativo(el.gridIndicadores, {
    titulo: 'Mayor diferencia de mediana',
    resultado: snap.indicadores.diferenciaMediana,
    variableAgrupamiento: snap.variableAgrupamiento,
  });
  pintarIndicadorComparativo(el.gridIndicadores, {
    titulo: 'Mayor diferencia de piso productivo',
    resultado: snap.indicadores.diferenciaPiso,
    variableAgrupamiento: snap.variableAgrupamiento,
  });
}

function pintarIndicadorComparativo(gridContainer, { titulo, resultado, variableAgrupamiento }) {
  const card = document.createElement('div');
  card.className = 'kpi-destacado';

  if (!resultado) {
    card.innerHTML = `
      <div class="kpi-destacado-titulo">${titulo}</div>
      <div class="kpi-destacado-vacio">No hay suficientes observaciones para calcular este indicador.</div>
    `;
    gridContainer.appendChild(card);
    return;
  }

  // punto 17 (ya vigente): lenguaje explícito de qué grupo supera a cuál,
  // sin calificativos evaluativos ("mejor", "más conveniente").
  const grupoA = etiquetaDeGrupo(resultado.grupoSupera, variableAgrupamiento);
  const grupoB = etiquetaDeGrupo(resultado.grupoSuperado, variableAgrupamiento);
  card.innerHTML = `
    <div class="kpi-destacado-titulo">${titulo}</div>
    <div class="kpi-destacado-valor">${resultado.delta.toLocaleString('es-AR')} kg/ha</div>
    <div class="kpi-destacado-detalle">${grupoA} vs ${grupoB}</div>
    <div class="kpi-destacado-detalle">${resultado.windowLabel}</div>
  `;
  gridContainer.appendChild(card);
}

// ---------------------------------------------------------------------------
// Tabla de valores exactos
// ---------------------------------------------------------------------------

function renderTablaValoresExactos(snap) {
  el.tablaBody.innerHTML = '';
  snap.grupos.forEach((g) => {
    const visibles = snap.visibleWindowsPorGrupo.get(g.valor) || [];
    visibles.forEach((w) => {
      if (w.n === 0) return;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${w.label}</td>
        <td>${etiquetaDeGrupo(g.valor, snap.variableAgrupamiento)}</td>
        <td>${w.n}</td>
        <td>${w.p25 ?? '—'}</td>
        <td>${w.mediana ?? '—'}</td>
        <td>${w.p75 ?? '—'}</td>
      `;
      el.tablaBody.appendChild(tr);
    });
  });
}

// referencia de umbral disponible por si la interfaz necesita mostrarlo en
// algún mensaje adicional más adelante
void MIN_OBS_KPI;
