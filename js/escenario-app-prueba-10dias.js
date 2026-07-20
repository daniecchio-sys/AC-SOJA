// ============================================================================
// escenario-app-prueba-10dias.js
// PRUEBA METODOLÓGICA REVERSIBLE -- copia de escenario-app.js con dos
// diferencias reales de motor/vista: (1) el estado usa buildVentanas10Dias()
// en vez de las 5 días vigentes, (2) el heatmap siempre muestra las 11
// ventanas completas (sin deslizador de rango -- con 21 hacía falta
// recortar la vista por defecto, con 11 entra todo sin scroll). No es la
// fuente de verdad -- ver escenarios-prueba-10dias.html.
//
// Todo lo demás es exactamente escenario-app.js, incluida la reorganización
// de jerarquía visual (título estable, tarjeta única de "resumen del
// ambiente", Indicadores destacados reemplazando "¿Qué muestran estos
// datos?", lotes superados en fila horizontal, orden Constructor → Resumen
// → Heatmap → Ranking → Dispersión → Indicadores complementarios →
// elementos descriptivos). Ningún cálculo, regla ni componente de motor
// cambió -- solo composición y orden visual, igual que en la versión
// vigente.
//
// Reutiliza SIN modificar: renderQuery/abrirBuscadorDeCondiciones
// (query-builder.js), createHistory (history.js).
// ============================================================================

import { loadDataset } from './data-loader.js';
import { createEscenarioState, MIN_OBS_ESCENARIO, CLAVES_VARIABLES_PERMITIDAS } from './escenario-state.js';
import { renderQuery, abrirBuscadorDeCondiciones } from './query-builder.js';
import { renderTarjetaEscenario } from './escenario-tarjeta.js';
import { createHistory } from './history.js';
import { renderHeatmap } from './escenario-heatmap.js';
import { renderRanking, CRITERIO_INICIAL } from './escenario-ranking.js';
import { renderDispersion } from './escenario-dispersion.js';
import { renderIndicadoresDestacados } from './escenario-indicadores-destacados.js';
import { buildVentanas10Dias } from './stats-ventanas-10dias.js';

// Pregunta raíz propia de Escenarios (Sección 3 del documento funcional) --
// ya no se arma como oración dinámica en pantalla: vive fija en el título
// estable. El constructor conversacional sigue usándola como base para su
// propia oración interna, solo que ya no es lo primero ni lo más prominente.
const PREGUNTA_RAIZ_ESCENARIOS = '¿Qué ocurrió históricamente';

const state = createEscenarioState({ windowBuilder: buildVentanas10Dias }); // única diferencia real de motor con escenario-app.js
const historial = createHistory();

const el = {
  historialAtras: document.getElementById('historial-atras'),
  historialAdelante: document.getElementById('historial-adelante'),
  oracion: document.getElementById('escenario-oracion'),
  indicadorPrincipal: document.getElementById('indicador-principal'),
  mensajePiso: document.getElementById('mensaje-piso-minimo'),
  tarjetaAmbiente: document.getElementById('tarjeta-ambiente'),
  tarjetaContenido: document.getElementById('tarjeta-escenario-contenido'),
  areaAnalisis: document.getElementById('area-analisis'),
  bloqueLotesSuperados: document.getElementById('bloque-lotes-superados'),
  lotesSuperadosLista: document.getElementById('lotes-superados-lista'),
  lotesSuperadosBase: document.getElementById('lotes-superados-base'),
  tablaBody: document.getElementById('tabla-escenario-body'),
  toggleCiclosEventuales: document.getElementById('toggle-ciclos-eventuales'),
  bloqueRanking: document.getElementById('bloque-ranking'),
  gridKpisDestacados: document.getElementById('grid-kpis-destacados'),
};

// ---------------------------------------------------------------------------
// Estado de INTERFAZ (no del escenario en sí, no forma parte del historial).
// El rango de fecha visible del heatmap no existe en esta prueba: con 11
// ventanas de 10 días entran todas en pantalla sin scroll, así que
// renderHeatmap() siempre recibe el rango completo (ver render()).
// ---------------------------------------------------------------------------
let mostrarCiclosEventuales = false;
let criterioRanking = CRITERIO_INICIAL;
let rankingExpandido = false;

init();

async function init() {
  const csvText = await fetch('data/ac_soja.csv').then((r) => r.text());
  const { records } = loadDataset(csvText);
  state.load(records);

  // Único push inicial -- representa el primer estado navegable (sin
  // condiciones), igual criterio que Explorar/Comparar.
  historial.push(state.getSerializableSnapshot());

  render();
}

// ---------------------------------------------------------------------------
// Constructor + filtrado AND + historial
// ---------------------------------------------------------------------------

/**
 * Empuja un nuevo estado navegable, salvo que sea idéntico (serializado) al
 * que ya está en la punta del historial -- evita duplicados cuando una
 * acción no cambió nada observable. Mismo criterio ya usado en Comparar.
 */
function registrarEstadoSiCambio() {
  const nuevo = state.getSerializableSnapshot();
  const actual = historial.current();
  if (actual && JSON.stringify(actual) === JSON.stringify(nuevo)) return;
  historial.push(nuevo);
}

function agregarCondicion(key, condition) {
  state.setCondicion(key, condition);
  registrarEstadoSiCambio();
  render();
}

function quitarCondicion(key) {
  state.quitarCondicion(key);
  registrarEstadoSiCambio();
  render();
}

el.historialAtras.addEventListener('click', () => {
  const snap = historial.back();
  if (!snap) return;
  state.restoreFromSnapshot(snap); // restaurar NUNCA empuja al historial
  render();
});
el.historialAdelante.addEventListener('click', () => {
  const snap = historial.forward();
  if (!snap) return;
  state.restoreFromSnapshot(snap);
  render();
});

// ---------------------------------------------------------------------------
// Controles del heatmap -- vista de sensibilidad de manejo. No pasan por
// registrarEstadoSiCambio(): son preferencias de vista, no cambian el
// escenario en sí (ver nota de "estado de interfaz" más arriba).
// ---------------------------------------------------------------------------

el.toggleCiclosEventuales.addEventListener('click', () => {
  mostrarCiclosEventuales = !mostrarCiclosEventuales;
  render();
});

// ---------------------------------------------------------------------------
// Render general
// ---------------------------------------------------------------------------

function render() {
  const snap = state.getSnapshot();

  el.historialAtras.disabled = !historial.canGoBack();
  el.historialAdelante.disabled = !historial.canGoForward();

  // 1. Constructor del escenario
  renderQuery(el.oracion, {
    appliedFilters: snap.condiciones,
    onRemove: quitarCondicion,
    onRequestAdd: (anchorEl) => {
      abrirBuscadorDeCondiciones({
        anchorEl,
        records: snap.filteredData,
        onSelect: agregarCondicion,
        categoriasPermitidas: CLAVES_VARIABLES_PERMITIDAS,
      });
    },
    baseSentence: PREGUNTA_RAIZ_ESCENARIOS,
  });

  // 2. Resumen del ambiente (indicador principal + condiciones, tarjeta
  // única) + Lotes registrados que superaron, en la misma fila.
  renderIndicadorPrincipal(snap);
  renderTarjeta(snap);
  el.bloqueLotesSuperados.style.display = snap.alcanzaMinimo ? '' : 'none';
  if (snap.alcanzaMinimo) renderLotesSuperados(snap);

  el.areaAnalisis.style.display = snap.alcanzaMinimo ? '' : 'none';
  if (!snap.alcanzaMinimo) return;

  // 3. Heatmap -- siempre las 11 ventanas completas, sin recorte
  const idsTodasLasVentanas = snap.windows.map((w) => w.id);
  renderHeatmap('grafico-heatmap', {
    heatmapFilas: snap.heatmapFilas,
    windowIds: idsTodasLasVentanas,
    rangoVisible: { min: idsTodasLasVentanas[0], max: idsTodasLasVentanas[idsTodasLasVentanas.length - 1] },
    mostrarEventuales: mostrarCiclosEventuales,
  });
  el.toggleCiclosEventuales.textContent = mostrarCiclosEventuales
    ? 'Mostrar menos ciclos'
    : `+ mostrar ciclos con uso eventual (${snap.ciclosEventualesPresentes.length})`;
  el.toggleCiclosEventuales.style.display = snap.ciclosEventualesPresentes.length > 0 ? '' : 'none';

  // 4. Indicadores destacados -- inmediatamente sobre el ranking
  renderIndicadoresDestacados(el.gridKpisDestacados, { rankingElegible: snap.rankingElegible });

  // 5. Ranking de combinaciones
  renderRanking(el.bloqueRanking, {
    rankingElegible: snap.rankingElegible,
    criterioActivo: criterioRanking,
    expandido: rankingExpandido,
    onCambiarCriterio: (criterioKey) => { criterioRanking = criterioKey; render(); },
    onToggleExpandir: () => { rankingExpandido = !rankingExpandido; render(); },
  });

  // 6. Relación rendimiento-dispersión
  renderDispersion('grafico-dispersion', {
    rankingElegible: snap.rankingElegible,
    medianaDeMedianas: snap.medianaDeMedianas,
    medianaDeDispersiones: snap.medianaDeDispersiones,
  });

  // Elemento descriptivo final
  renderTablaValoresExactos(snap.visibleWindows);
}

// ---------------------------------------------------------------------------
// Indicador principal, con sus 5 estados
// ---------------------------------------------------------------------------

function renderIndicadorPrincipal(snap) {
  el.indicadorPrincipal.innerHTML = '';

  const titulo = document.createElement('div');
  titulo.className = 'indicador-titulo';
  titulo.textContent = 'Observaciones históricas comparables';
  el.indicadorPrincipal.appendChild(titulo);

  const valor = document.createElement('div');
  valor.className = 'indicador-valor';
  valor.textContent = snap.nEscenario.toLocaleString('es-AR');
  el.indicadorPrincipal.appendChild(valor);

  const subtitulo = document.createElement('div');
  subtitulo.className = 'indicador-subtitulo';
  subtitulo.textContent = snap.campanasIncluidas === 1
    ? `Repartidas en 1 campaña`
    : `Repartidas en ${snap.campanasIncluidas.toLocaleString('es-AR')} campañas`;
  el.indicadorPrincipal.appendChild(subtitulo);

  if (!snap.hayCondiciones) {
    const notaSinCondiciones = document.createElement('div');
    notaSinCondiciones.className = 'escenario-sin-condiciones';
    notaSinCondiciones.textContent = 'Sin condiciones aplicadas — toda la red.';
    el.indicadorPrincipal.appendChild(notaSinCondiciones);
  }

  if (!snap.alcanzaMinimo) {
    el.mensajePiso.style.display = '';
    el.mensajePiso.textContent = `Se requieren al menos ${MIN_OBS_ESCENARIO} observaciones históricas comparables para construir este análisis. Esta combinación de condiciones tiene ${snap.nEscenario.toLocaleString('es-AR')}.`;
  } else {
    el.mensajePiso.style.display = 'none';
    el.mensajePiso.textContent = '';
  }
}

// ---------------------------------------------------------------------------
// Tarjeta de resumen del ambiente
// ---------------------------------------------------------------------------

function renderTarjeta(snap) {
  const debeMostrarse = snap.hayCondiciones && snap.alcanzaMinimo;
  if (!debeMostrarse) {
    el.tarjetaContenido.innerHTML = '';
    return;
  }
  renderTarjetaEscenario(el.tarjetaContenido, {
    condiciones: snap.condiciones,
    nEscenario: snap.nEscenario,
    campanasIncluidas: snap.campanasIncluidas,
  });
}

// ---------------------------------------------------------------------------
// Lotes registrados que superaron determinados rendimientos -- tres
// indicadores horizontales, con la base del cálculo en una nota aparte.
// ---------------------------------------------------------------------------

function renderLotesSuperados(snap) {
  el.lotesSuperadosLista.innerHTML = '';
  snap.lotesSuperados.forEach(({ umbral, pct }) => {
    const item = document.createElement('div');
    item.className = 'lote-superado-item';
    item.innerHTML = `
      <span class="lote-superado-umbral">Más de ${(umbral / 1000).toLocaleString('es-AR')}.000 kg/ha</span>
      <span class="lote-superado-valor">${pct === null ? '—' : `${pct}%`}</span>
    `;
    el.lotesSuperadosLista.appendChild(item);
  });
  const totalEscenario = snap.lotesSuperados[0]?.total ?? 0;
  el.lotesSuperadosBase.textContent = `Calculado sobre los ${totalEscenario.toLocaleString('es-AR')} lotes registrados del escenario.`;
}

// ---------------------------------------------------------------------------
// Tabla de valores exactos -- mismo formato que Explorar (una fila por
// ventana, sin columna de grupo).
// ---------------------------------------------------------------------------

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
