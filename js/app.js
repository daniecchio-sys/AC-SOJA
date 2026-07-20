// ============================================================================
// app.js
// Punto de entrada de EXPLORAR. Conecta el motor (filters.js/stats.js vía
// state.js) con la capa de interfaz: consulta, contexto, gráfico,
// indicadores destacados, comparación e historial.
//
// Ventanas de fecha de siembra: ~10 días (buildVentanas10Dias(),
// stats-ventanas-10dias.js), adoptadas como configuración definitiva tras
// la comparación reversible contra las 5 días originales (ver
// test/comparacion-ventanas-5-vs-10-dias.mjs). state.js sigue
// parametrizado con windowBuilder (por defecto buildFixedWindows, 5 días)
// para no perder esa flexibilidad -- acá se pasa explícitamente
// buildVentanas10Dias como la fuente de verdad vigente del producto.
// ============================================================================

import { loadDataset } from './data-loader.js';
import { createAppState } from './state.js';
import { renderQuery, abrirBuscadorDeCondiciones, construirOracion, fraseDeCondicion } from './query-builder.js';
import { createHistory } from './history.js';
import { createComparison, diferenciasEntreConsultas } from './comparison.js';
import { renderMainChart, renderHistogramaPrincipal } from './charts.js';
import { fechaDesdeDiaDeTemporada, ventanaConMayorP75, ventanaConMayorP25, ventanaConMayorN } from './stats.js';
import { buildVentanas10Dias } from './stats-ventanas-10dias.js';

const state = createAppState({ windowBuilder: buildVentanas10Dias });
const historial = createHistory();
const comparacion = createComparison();

let seleccionPendiente = null; // rango elegido sobre el gráfico, a la espera de confirmación

const el = {
  historialAtras: document.getElementById('historial-atras'),
  historialAdelante: document.getElementById('historial-adelante'),
  consulta: document.getElementById('consulta'),
  contexto: document.getElementById('contexto'),
  contextoDetalle: document.getElementById('contexto-detalle'),
  compararBtn: document.getElementById('comparar-btn'),
  bloqueComparacion: document.getElementById('bloque-comparacion'),
  seleccionAfordancia: document.getElementById('seleccion-afordancia'),
  tablaBody: document.getElementById('tabla-ventanas-body'),
  gridKpis: document.getElementById('grid-kpis-explorar'),
  aclaraciones: document.getElementById('aclaraciones-explorar'),
};

init();

async function init() {
  const csvText = await fetch('data/ac_soja.csv').then((r) => r.text());
  const { records } = loadDataset(csvText);
  state.load(records);
  historial.push(snapshotDeFiltros(state.getSnapshot().appliedFilters));
  render();
}

// ---------------------------------------------------------------------------
// Aplicación de filtros: cada cambio se aplica de inmediato (no hay botón
// "aplicar" en este prototipo -- cada condición agregada o quitada ES una
// nueva consulta, al estilo de navegar entre páginas) y queda registrado en
// el historial liviano tipo navegador.
// ---------------------------------------------------------------------------

function aplicarNuevosFiltros(nuevosFiltros) {
  state.resetFilters();
  Object.entries(nuevosFiltros).forEach(([key, condition]) => state.setDraftFilter(key, condition));
  state.applyFilters();
  historial.push(snapshotDeFiltros(nuevosFiltros));
  actualizarComparacionSiCorresponde();
  render();
}

function agregarCondicion(key, condition) {
  const actuales = { ...state.getSnapshot().appliedFilters, [key]: condition };
  aplicarNuevosFiltros(actuales);
}

function quitarCondicion(key) {
  const actuales = { ...state.getSnapshot().appliedFilters };
  delete actuales[key];
  aplicarNuevosFiltros(actuales);
}

function snapshotDeFiltros(filtros) {
  return JSON.parse(JSON.stringify(filtros, dateReplacer));
}
function dateReplacer(_key, value) { return value; }

// ---------------------------------------------------------------------------
// Historial (atrás / adelante)
// ---------------------------------------------------------------------------

el.historialAtras.addEventListener('click', () => {
  const snap = historial.back();
  if (!snap) return;
  restaurarSnapshot(snap);
});
el.historialAdelante.addEventListener('click', () => {
  const snap = historial.forward();
  if (!snap) return;
  restaurarSnapshot(snap);
});

function restaurarSnapshot(filtros) {
  state.resetFilters();
  Object.entries(filtros).forEach(([key, condition]) => state.setDraftFilter(key, condition));
  state.applyFilters();
  render();
}

// ---------------------------------------------------------------------------
// Comparación de consultas completas
// ---------------------------------------------------------------------------

el.compararBtn.addEventListener('click', () => {
  if (comparacion.hayReferencia()) {
    comparacion.limpiar();
    el.bloqueComparacion.classList.remove('visible');
    el.compararBtn.classList.remove('activo');
    el.compararBtn.textContent = '+ comparar';
    return;
  }
  const snap = state.getSnapshot();
  const { texto } = construirOracion(snap.appliedFilters);
  comparacion.fijar(snap.appliedFilters, texto, snap);
  el.compararBtn.classList.add('activo');
  el.compararBtn.textContent = 'Referencia fijada · ajustá la consulta';
});

function actualizarComparacionSiCorresponde() {
  if (!comparacion.hayReferencia()) return;
  const ref = comparacion.obtenerReferencia();
  const snapActual = state.getSnapshot();
  const oracionActual = construirOracion(snapActual.appliedFilters).texto;

  if (oracionActual === ref.sentence) {
    el.bloqueComparacion.classList.remove('visible');
    return;
  }

  const diffs = diferenciasEntreConsultas(ref.filters, snapActual.appliedFilters);
  el.bloqueComparacion.innerHTML = '';
  el.bloqueComparacion.classList.add('visible');

  el.bloqueComparacion.appendChild(
    filaComparacion('Referencia', ref.sentence, ref.snapshot.kpis)
  );
  el.bloqueComparacion.appendChild(
    filaComparacion('Actual', oracionActual, snapActual.kpis)
  );

  const difDiv = document.createElement('div');
  difDiv.className = 'comparacion-diferencias';
  const titulo = document.createElement('div');
  titulo.className = 'comparacion-etiqueta';
  titulo.textContent = 'Qué cambió';
  difDiv.appendChild(titulo);
  if (diffs.length === 0) {
    const p = document.createElement('div');
    p.textContent = 'Sin diferencias en las condiciones (mismo resultado).';
    difDiv.appendChild(p);
  } else {
    diffs.forEach((d) => {
      const linea = document.createElement('div');
      linea.className = `dif-item dif-${d.tipo}`;
      const prefijo = d.tipo === 'agregada' ? '+ ' : d.tipo === 'quitada' ? '− ' : '~ ';
      linea.textContent = prefijo + d.texto;
      difDiv.appendChild(linea);
    });
  }
  el.bloqueComparacion.appendChild(difDiv);
}

function filaComparacion(etiqueta, oracion, kpis) {
  const fila = document.createElement('div');
  fila.className = 'comparacion-fila';
  const lbl = document.createElement('div');
  lbl.className = 'comparacion-etiqueta';
  lbl.textContent = etiqueta;
  const txt = document.createElement('div');
  txt.className = 'comparacion-oracion';
  txt.textContent = oracion;
  const meta = document.createElement('div');
  meta.className = 'comparacion-etiqueta';
  meta.style.marginTop = '2px';
  meta.textContent = kpis.medianaGeneral !== null
    ? `Mediana general: ${kpis.medianaGeneral} kg/ha · n=${kpis.nTotal}`
    : `n=${kpis.nTotal}`;
  fila.append(lbl, txt, meta);
  return fila;
}

// ---------------------------------------------------------------------------
// Render general
// ---------------------------------------------------------------------------

function render() {
  const snap = state.getSnapshot();

  el.historialAtras.disabled = !historial.canGoBack();
  el.historialAdelante.disabled = !historial.canGoForward();

  renderQuery(el.consulta, {
    appliedFilters: snap.appliedFilters,
    onRemove: quitarCondicion,
    onRequestAdd: (anchorEl) => {
      abrirBuscadorDeCondiciones({
        anchorEl,
        records: snap.filteredData.length > 0 ? snap.filteredData : state.getSnapshot().filteredData,
        onSelect: (key, condition) => agregarCondicion(key, condition),
      });
    },
  });

  renderContexto(snap);

  renderMainChart('grafico-principal', {
    classifiedData: snap.classifiedData,
    windows: snap.windows,
    visibleWindows: snap.visibleWindows,
    onRegionSelected: (rango) => mostrarAfordanciaDeSeleccion(rango),
  });

  renderHistogramaPrincipal('histograma-principal', {
    windows: snap.windows,
    visibleWindows: snap.visibleWindows,
  });

  renderIndicadoresDestacados(snap);
  renderTablaValoresExactos(snap.visibleWindows);
  actualizarComparacionSiCorresponde();
}

function renderContexto(snap) {
  const rep = snap.representatividadTemporal;
  const claseNivel = `rep-${rep.nivel.toLowerCase()}`;

  el.contexto.innerHTML = '';
  const nSpan = document.createElement('span');
  nSpan.textContent = `${snap.kpis.nTotal.toLocaleString('es-AR')} observaciones`;

  const repSpan = document.createElement('span');
  repSpan.className = 'contexto-representatividad';
  // Un punto de texto simple (no emoji): un emoji trae su propio color fijo
  // y no puede recolorearse con CSS, lo que dejaría sin efecto las clases
  // .rep-alta / .rep-media / .rep-baja definidas en global.css.
  repSpan.innerHTML = `<span class="rep-punto ${claseNivel}">●</span> Representatividad temporal: ${capitalizar(rep.nivel)}`;
  repSpan.addEventListener('click', () => {
    el.contextoDetalle.classList.toggle('abierto');
  });

  // comparar-btn ya vive en su lugar definitivo en el HTML (hermano de
  // #contexto dentro de .fila-contexto) -- no se reubica en cada render,
  // solo se actualiza el contenido de #contexto.
  el.contexto.append(nSpan, repSpan);

  const d = snap.kpis.desgloseConfiabilidad;
  el.contextoDetalle.textContent =
    `${snap.kpis.totalVentanas} ventanas del período analizado · ${d.alta} con n≥10 · ${d.reducida} con n entre 5 y 9 · ${d.insuficiente} con n<5 · ${d.vacia} vacías` +
    (snap.kpis.observacionesFueraDeRango > 0 ? ` · ${snap.kpis.observacionesFueraDeRango} fuera del período (antes del 1/oct o después del 15/ene)` : '');
}

// ---------------------------------------------------------------------------
// Indicadores destacados -- mismo criterio ya aplicado en Explorar vigente:
// reemplaza el panel lateral y el bloque de texto "¿Qué muestran estos
// datos?" por 5 tarjetas KPI + aclaraciones dinámicas. Ningún cálculo
// nuevo -- ver el comentario equivalente en js/app.js para el detalle.
// ---------------------------------------------------------------------------

const FRAGMENTOS_YA_MOSTRADOS_COMO_KPI = [
  'presentó la mediana más alta',
  'concentra la mayor cantidad de observaciones',
  'diferencia entre la ventana de mayor y menor mediana',
];

function renderIndicadoresDestacados(snap) {
  el.gridKpis.innerHTML = '';

  const mejor = snap.kpis.mejorVentana;
  pintarKpiDestacado(el.gridKpis, {
    titulo: 'Mayor mediana observada',
    valor: mejor ? `${mejor.mediana.toLocaleString('es-AR')} kg/ha` : null,
    detalle: mejor ? `${mejor.label} · n=${mejor.n}` : null,
  });

  const p75 = ventanaConMayorP75(snap.visibleWindows);
  pintarKpiDestacado(el.gridKpis, {
    titulo: 'Mayor potencial observado',
    valor: p75 ? `${Math.round(p75.p75).toLocaleString('es-AR')} kg/ha` : null,
    detalle: p75 ? `${p75.label} · n=${p75.n}` : null,
  });

  const p25 = ventanaConMayorP25(snap.visibleWindows);
  pintarKpiDestacado(el.gridKpis, {
    titulo: 'Mayor piso productivo',
    valor: p25 ? `${Math.round(p25.p25).toLocaleString('es-AR')} kg/ha` : null,
    detalle: p25 ? `${p25.label} · n=${p25.n}` : null,
  });

  const masPoblada = ventanaConMayorN(snap.windowSummary);
  pintarKpiDestacado(el.gridKpis, {
    titulo: 'Mayor respaldo histórico',
    valor: masPoblada ? `${masPoblada.n.toLocaleString('es-AR')} observaciones` : null,
    detalle: masPoblada ? masPoblada.label : null,
  });

  const amplitud = snap.kpis.amplitudEntreVentanas;
  pintarKpiDestacado(el.gridKpis, {
    titulo: 'Amplitud entre ventanas',
    valor: amplitud !== null ? `${amplitud.toLocaleString('es-AR')} kg/ha` : null,
    detalle: amplitud !== null
      ? `${snap.kpis.ventanaMaxima.label} (n=${snap.kpis.ventanaMaxima.n}) vs ${snap.kpis.ventanaMinima.label} (n=${snap.kpis.ventanaMinima.n})`
      : null,
  });

  el.aclaraciones.innerHTML = '<p>Los resultados describen comportamientos observados y no constituyen predicciones ni recomendaciones agronómicas.</p>';
  snap.messages
    .filter((m) => !FRAGMENTOS_YA_MOSTRADOS_COMO_KPI.some((frag) => m.includes(frag)))
    .forEach((m) => {
      const p = document.createElement('p');
      p.textContent = m;
      el.aclaraciones.appendChild(p);
    });
}

function pintarKpiDestacado(container, { titulo, valor, detalle }) {
  const card = document.createElement('div');
  card.className = 'kpi-destacado';
  if (valor === null) {
    card.innerHTML = `
      <div class="kpi-destacado-titulo">${titulo}</div>
      <div class="kpi-destacado-vacio">No hay suficientes observaciones para calcular este indicador.</div>
    `;
  } else {
    card.innerHTML = `
      <div class="kpi-destacado-titulo">${titulo}</div>
      <div class="kpi-destacado-valor">${valor}</div>
      <div class="kpi-destacado-detalle">${detalle}</div>
    `;
  }
  container.appendChild(card);
}

function renderTablaValoresExactos(visibleWindows) {
  el.tablaBody.innerHTML = '';
  visibleWindows.forEach((w) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${w.label}</td>
      <td>${w.n}</td>
      <td>${w.min ?? '—'}</td>
      <td>${w.p25 ?? '—'}</td>
      <td>${w.mediana ?? '—'}</td>
      <td>${w.p75 ?? '—'}</td>
      <td>${w.max ?? '—'}</td>
    `;
    el.tablaBody.appendChild(tr);
  });
}

function capitalizar(s) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Selección directa sobre el gráfico
// ---------------------------------------------------------------------------

function mostrarAfordanciaDeSeleccion(rango) {
  if (!rango) {
    el.seleccionAfordancia.classList.remove('visible');
    seleccionPendiente = null;
    return;
  }
  seleccionPendiente = rango;
  el.seleccionAfordancia.classList.add('visible');
  el.seleccionAfordancia.querySelector('.seleccion-texto').textContent =
    `¿Consultar solo el tramo ${rango.etiqueta}?`;
}

document.getElementById('seleccion-confirmar').addEventListener('click', () => {
  if (!seleccionPendiente) return;
  const inicio = fechaDesdeDiaDeTemporada(seleccionPendiente.startDia);
  const fin = fechaDesdeDiaDeTemporada(seleccionPendiente.endDia);
  agregarCondicion('temporada', {
    type: 'daterange',
    startDia: seleccionPendiente.startDia,
    endDia: seleccionPendiente.endDia,
    etiquetaLegible: `entre el ${inicio.label} y el ${fin.label}`,
  });
  el.seleccionAfordancia.classList.remove('visible');
});
