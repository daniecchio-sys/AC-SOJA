// ============================================================================
// test/engine-test.js
// Valida el motor completo (carga -> normalización -> estado -> filtros ->
// ventanas -> percentiles -> KPIs -> representatividad temporal -> mensajes) sin ninguna
// interfaz gráfica, tal como pide la Etapa 5. Se ejecuta con:
//
//   node test/engine-test.js
//
// No es un framework de testing formal (no hace falta todavía para esta
// etapa) -- son verificaciones explícitas con asserts que cortan la
// ejecución con un mensaje claro si algo no se comporta como debería.
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadDataset, printAuditReport } from '../js/data-loader.js';
import { createAppState } from '../js/state.js';
import {
  THRESHOLDS,
  CLASSIFICATION_LABELS,
  buildFixedWindows,
  estaDentroDelPeriodoAnalizado,
  PERIODO_ANALIZADO,
  computeWindowSummary,
  classifyObservations,
  assignWindowId,
  selectVisibleWindows,
  computeKPIs,
} from '../js/stats.js';
import { parseFlexibleNumber } from '../js/utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '..', 'data', 'ac_soja.csv');

// Total de ventanas del período analizado, calculado UNA sola vez acá y
// reutilizado en todo el archivo -- nunca se repite "21" como número mágico
// en las verificaciones de más abajo (excepto en la Sección 6.1, donde
// verificar que da exactamente 21 es justamente el propósito de la prueba).
const TOTAL_VENTANAS = buildFixedWindows().length;

let checksRun = 0;
let checksFailed = 0;

function assert(condition, message) {
  checksRun++;
  if (!condition) {
    checksFailed++;
    console.error(`  ✗ FALLÓ: ${message}`);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

function section(title) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

// ============================================================================
// 1. Carga y auditoría del CSV
// ============================================================================
section('1. CARGA Y VALIDACIÓN DEL CSV');

const csvText = readFileSync(CSV_PATH, 'utf-8');
const { records, audit } = loadDataset(csvText);
printAuditReport(audit);

assert(records.length > 0, 'El dataset cargado tiene al menos un registro');
assert(
  records.length === audit.filasValidas,
  'La cantidad de registros cargados coincide con el conteo de filas válidas del reporte de auditoría'
);
assert(
  records.every((r) => r.fechaSiembra instanceof Date),
  'Todos los registros tienen una fecha de siembra parseada como objeto Date'
);
assert(
  records.every((r) => typeof r.rendimiento === 'number' && Number.isFinite(r.rendimiento)),
  'Todos los registros tienen un rendimiento numérico válido'
);

// ============================================================================
// 2. Estado inicial (sin filtros)
// ============================================================================
section('2. ESTADO INICIAL (SIN FILTROS)');

const state = createAppState();
state.load(records);
const snapshotInicial = state.getSnapshot();

console.log(`Registros totales en el dataset: ${snapshotInicial.nTotalDataset}`);
console.log(`Registros en el subconjunto filtrado (sin filtros activos): ${snapshotInicial.filteredData.length}`);
console.log(`Ventanas visibles en modo actual (${snapshotInicial.windowMode}): ${snapshotInicial.visibleWindows.length}`);

assert(
  snapshotInicial.filteredData.length === snapshotInicial.nTotalDataset,
  'Sin filtros activos, el subconjunto filtrado es igual al dataset completo'
);
assert(
  snapshotInicial.windowSummary.length === TOTAL_VENTANAS,
  `El resumen por ventana siempre contiene las ${TOTAL_VENTANAS} ventanas fijas del período analizado, sin importar el modo de visualización`
);

const sumaNPorVentana = snapshotInicial.windowSummary.reduce((acc, w) => acc + w.n, 0);
const fueraDeRango = snapshotInicial.filteredData.filter((r) => r.fechaFueraDeRangoAnalizado).length;
assert(
  sumaNPorVentana + fueraDeRango === snapshotInicial.filteredData.length,
  `La suma de n de las ${TOTAL_VENTANAS} ventanas más las observaciones fuera del período analizado (antes del 1/oct o después del 15/ene) es igual al total del subconjunto filtrado`
);

console.log('\nMuestra del resumen por ventana (primeras 5 con al menos 1 observación):');
snapshotInicial.windowSummary
  .filter((w) => w.n > 0)
  .slice(0, 5)
  .forEach((w) => {
    console.log(
      `  ${w.label.padEnd(16)} n=${String(w.n).padEnd(5)} confianza=${w.confianza.padEnd(12)} ` +
      `min=${w.min ?? '—'} P25=${w.p25 ?? '—'} mediana=${w.mediana ?? '—'} P75=${w.p75 ?? '—'} max=${w.max ?? '—'}`
    );
  });

console.log('\nKPIs (sin filtros):');
console.log(`  Mediana general: ${snapshotInicial.kpis.medianaGeneral} kg/ha`);
console.log(`  Mejor ventana: ${JSON.stringify(snapshotInicial.kpis.mejorVentana)}`);
console.log(`  Amplitud entre ventanas de alta confianza: ${snapshotInicial.kpis.amplitudEntreVentanas} kg/ha`);
console.log(`  Desglose de confiabilidad: ${JSON.stringify(snapshotInicial.kpis.desgloseConfiabilidad)}`);

console.log(`\nRepresentatividad temporal del subconjunto: ${snapshotInicial.representatividadTemporal.nivel}`);
console.log(`  Motivo: ${snapshotInicial.representatividadTemporal.motivo}`);

console.log('\nMensajes de interpretación automática:');
snapshotInicial.messages.forEach((m) => console.log(`  - ${m}`));

assert(
  snapshotInicial.representatividadTemporal.nivel === 'ALTA',
  'Con el dataset completo (miles de observaciones) la representatividad temporal debería ser ALTA'
);
assert(
  !snapshotInicial.messages.some((m) => /mejora|conviene|aumenta el rendimiento/i.test(m)),
  'Ningún mensaje automático usa lenguaje causal (mejora / conviene / aumenta el rendimiento)'
);

// ============================================================================
// 3. Comportamiento "borrador + aplicar" de los filtros
// ============================================================================
section('3. FILTROS: BORRADOR NO RECALCULA, APLICAR SÍ');

const campanasDisponibles = Array.from(new Set(records.map((r) => r.campana))).sort();
const campanaElegida = campanasDisponibles[campanasDisponibles.length - 1]; // la más reciente
console.log(`Campaña elegida para el filtro de prueba: ${campanaElegida}`);

state.setDraftFilter('campana', { type: 'in', values: [campanaElegida] });
const snapshotTrasDraft = state.getSnapshot();

assert(
  snapshotTrasDraft.filteredData.length === snapshotInicial.filteredData.length,
  'Modificar el borrador de filtros NO recalcula el subconjunto filtrado (debe seguir igual que antes)'
);
assert(
  JSON.stringify(snapshotTrasDraft.draftFilters) !== JSON.stringify(snapshotTrasDraft.appliedFilters),
  'El borrador de filtros difiere de los filtros aplicados mientras no se confirme'
);

state.applyFilters();
const snapshotTrasAplicar = state.getSnapshot();
const esperado = records.filter((r) => r.campana === campanaElegida).length;

assert(
  snapshotTrasAplicar.filteredData.length === esperado,
  `Tras aplicar el filtro, el subconjunto filtrado tiene exactamente los registros de la campaña ${campanaElegida} (esperado=${esperado}, obtenido=${snapshotTrasAplicar.filteredData.length})`
);
assert(
  snapshotTrasAplicar.filteredData.length < snapshotInicial.filteredData.length,
  'El subconjunto filtrado por una sola campaña es más chico que el dataset completo'
);
assert(
  JSON.stringify(snapshotTrasAplicar.draftFilters) === JSON.stringify(snapshotTrasAplicar.appliedFilters),
  'Tras aplicar, el borrador y los filtros aplicados quedan sincronizados'
);

console.log(`Subconjunto tras aplicar filtro de campaña: ${snapshotTrasAplicar.filteredData.length} observaciones`);
console.log(`Representatividad temporal tras filtrar por una sola campaña: ${snapshotTrasAplicar.representatividadTemporal.nivel}`);

// ---- filtros acumulativos: agregar un segundo filtro sobre el ya aplicado ----
const genDisponibles = Array.from(
  new Set(snapshotTrasAplicar.filteredData.map((r) => r.genetica).filter(Boolean))
);
if (genDisponibles.length > 0) {
  const genFrecuente = genDisponibles
    .map((g) => ({ g, n: snapshotTrasAplicar.filteredData.filter((r) => r.genetica === g).length }))
    .sort((a, b) => b.n - a.n)[0];

  console.log(`\nGenética elegida para el segundo filtro (acumulativo): ${genFrecuente.g}`);
  state.setDraftFilter('genetica', { type: 'in', values: [genFrecuente.g] });
  state.applyFilters();
  const snapshotDosFiltros = state.getSnapshot();

  const esperadoDosFiltros = records.filter(
    (r) => r.campana === campanaElegida && r.genetica === genFrecuente.g
  ).length;

  assert(
    snapshotDosFiltros.filteredData.length === esperadoDosFiltros,
    `Los filtros son acumulativos: campaña=${campanaElegida} AND genética=${genFrecuente.g} da ${esperadoDosFiltros} registros (obtenido=${snapshotDosFiltros.filteredData.length})`
  );
  assert(
    snapshotDosFiltros.filteredData.length <= snapshotTrasAplicar.filteredData.length,
    'Agregar un segundo filtro nunca puede aumentar el tamaño del subconjunto'
  );
}

// ---- reset ----
state.resetFilters();
const snapshotReset = state.getSnapshot();
assert(
  snapshotReset.filteredData.length === snapshotInicial.filteredData.length,
  'resetFilters() vuelve exactamente al tamaño del dataset completo'
);

// ============================================================================
// 4. Modo de ventana: automático vs. calendario completo
// ============================================================================
section('4. MODO DE VENTANA: AUTOMÁTICO VS. CALENDARIO COMPLETO');

// Filtramos a un subconjunto angosto para que el recorte de modo automático sea evidente
const fechasOrdenadas = records.map((r) => r.fechaSiembra).sort((a, b) => a - b);
state.setDraftFilter('campana', { type: 'in', values: [campanaElegida] });
state.applyFilters();

state.setWindowMode('completo');
const snapshotCompleto = state.getSnapshot();
assert(
  snapshotCompleto.visibleWindows.length === TOTAL_VENTANAS,
  `En modo "completo" siempre se muestran las ${TOTAL_VENTANAS} ventanas, tengan o no observaciones`
);

state.setWindowMode('auto');
const snapshotAuto = state.getSnapshot();
assert(
  snapshotAuto.visibleWindows.length <= TOTAL_VENTANAS,
  `En modo "auto" la cantidad de ventanas visibles nunca supera ${TOTAL_VENTANAS}`
);
assert(
  snapshotAuto.visibleWindows.length === 0 || snapshotAuto.visibleWindows[0].n > 0,
  'En modo "auto", la primera ventana visible tiene al menos 1 observación (se recortó el borde vacío)'
);
assert(
  snapshotAuto.visibleWindows.length === 0 ||
  snapshotAuto.visibleWindows[snapshotAuto.visibleWindows.length - 1].n > 0,
  'En modo "auto", la última ventana visible tiene al menos 1 observación (se recortó el borde vacío)'
);
assert(
  snapshotAuto.visibleWindows.every((w) => typeof w.n === 'number' && 'mediana' in w),
  'visibleWindows expone directamente n y percentiles (la interfaz no necesita unir por id con otra estructura)'
);
assert(
  JSON.stringify(snapshotAuto.windowSummary) === JSON.stringify(snapshotCompleto.windowSummary),
  'Cambiar el modo de ventana NO altera el resumen estadístico por ventana, solo qué parte se muestra'
);

console.log(`Ventanas visibles en modo completo: ${snapshotCompleto.visibleWindows.length}`);
console.log(`Ventanas visibles en modo automático: ${snapshotAuto.visibleWindows.length}`);
if (snapshotAuto.visibleWindows.length > 0) {
  console.log(
    `  Rango automático: "${snapshotAuto.visibleWindows[0].label}" a ` +
    `"${snapshotAuto.visibleWindows[snapshotAuto.visibleWindows.length - 1].label}"`
  );
}

state.resetFilters();
state.setWindowMode('auto');

// ============================================================================
// 5. Clasificación de observaciones contra los percentiles de su ventana
// ============================================================================
section('5. CLASIFICACIÓN DE OBSERVACIONES POR VENTANA');

const snapshotClasif = state.getSnapshot();
const clasificadas = snapshotClasif.classifiedData;

assert(
  clasificadas.length === snapshotClasif.filteredData.length,
  'Se clasifica exactamente una vez cada observación del subconjunto filtrado'
);

const conClasificacion = clasificadas.filter((r) => r.posicionRelativa !== null);
const sinClasificacion = clasificadas.filter((r) => r.posicionRelativa === null);
console.log(`Observaciones clasificadas (ventana con percentiles calculados): ${conClasificacion.length}`);
console.log(`Observaciones sin clasificar (ventana vacía, insuficiente o fuera de rango): ${sinClasificacion.length}`);

// Verificación cruzada: tomar una observación "SUPERIOR_A_P75" y confirmar que
// su rendimiento realmente supera el P75 de SU ventana (no el de otra).
const ejemploP75 = conClasificacion.find((r) => r.posicionRelativa === 'SUPERIOR_A_P75');
if (ejemploP75) {
  const resumenDeEsaVentana = snapshotClasif.windowSummary.find((w) => w.windowId === ejemploP75.windowId);
  assert(
    ejemploP75.rendimiento > resumenDeEsaVentana.p75,
    `Una observación clasificada como SUPERIOR_A_P75 (${ejemploP75.rendimiento} kg/ha) realmente supera el P75 de su propia ventana (${resumenDeEsaVentana.p75} kg/ha, ventana "${resumenDeEsaVentana.label}")`
  );
}

const ejemploMenorP25 = conClasificacion.find((r) => r.posicionRelativa === 'INFERIOR_A_P25');
if (ejemploMenorP25) {
  const resumenDeEsaVentana = snapshotClasif.windowSummary.find((w) => w.windowId === ejemploMenorP25.windowId);
  assert(
    ejemploMenorP25.rendimiento < resumenDeEsaVentana.p25,
    `Una observación clasificada como INFERIOR_A_P25 (${ejemploMenorP25.rendimiento} kg/ha) realmente está por debajo del P25 de su propia ventana (${resumenDeEsaVentana.p25} kg/ha, ventana "${resumenDeEsaVentana.label}")`
  );
}

assert(
  sinClasificacion.every((r) => {
    if (r.windowId === null) return true; // fuera de rango, correcto que no se clasifique
    const resumen = snapshotClasif.windowSummary.find((w) => w.windowId === r.windowId);
    return resumen.confianza === 'VACIA' || resumen.confianza === 'INSUFICIENTE';
  }),
  'Toda observación sin clasificar pertenece a una ventana vacía, insuficiente, o está fuera del rango analizado -- nunca queda sin clasificar por error'
);

// ============================================================================
// 6. Reglas de baja n (umbral configurado en THRESHOLDS)
// ============================================================================
section('6. REGLAS DE BAJA CANTIDAD DE DATOS');

console.log(`Umbral de alta confianza: n >= ${THRESHOLDS.N_ALTA_CONFIANZA}`);
console.log(`Umbral mínimo para calcular percentiles: n >= ${THRESHOLDS.N_MINIMO_PARA_PERCENTILES}`);

snapshotClasif.windowSummary.forEach((w) => {
  if (w.confianza === 'VACIA') {
    assert(w.n === 0 && w.mediana === null, `Ventana "${w.label}" vacía: n=0 y sin percentiles`);
  } else if (w.confianza === 'INSUFICIENTE') {
    assert(
      w.n > 0 && w.n < THRESHOLDS.N_MINIMO_PARA_PERCENTILES && w.mediana === null && w.min !== null,
      `Ventana "${w.label}" insuficiente (n=${w.n}): tiene mín/máx pero NO tiene percentiles`
    );
  } else {
    assert(
      w.n >= THRESHOLDS.N_MINIMO_PARA_PERCENTILES && w.mediana !== null,
      `Ventana "${w.label}" (n=${w.n}, ${w.confianza}) tiene percentiles calculados`
    );
  }
});

// ============================================================================
// 7. Caso límite: filtro tan restrictivo que casi no deja datos
// ============================================================================
section('7. CASO LÍMITE: SUBCONJUNTO MUY CHICO');

const localidadesPocoFrecuentes = Array.from(new Set(records.map((r) => r.localidad)))
  .map((loc) => ({ loc, n: records.filter((r) => r.localidad === loc).length }))
  .filter((x) => x.n > 0 && x.n < 5)
  .sort((a, b) => a.n - b.n);

if (localidadesPocoFrecuentes.length > 0) {
  const caso = localidadesPocoFrecuentes[0];
  console.log(`Localidad elegida a propósito por tener pocos registros: ${caso.loc} (n=${caso.n})`);

  state.resetFilters();
  state.setDraftFilter('localidad', { type: 'in', values: [caso.loc] });
  state.applyFilters();
  const snapshotChico = state.getSnapshot();

  console.log(`Representatividad temporal: ${snapshotChico.representatividadTemporal.nivel}`);
  console.log(`Motivo: ${snapshotChico.representatividadTemporal.motivo}`);
  console.log('Mensajes:');
  snapshotChico.messages.forEach((m) => console.log(`  - ${m}`));

  assert(
    snapshotChico.representatividadTemporal.nivel === 'INSUFICIENTE' || snapshotChico.representatividadTemporal.nivel === 'BAJA',
    'Un subconjunto de muy pocas observaciones nunca queda con representatividad temporal ALTA o MEDIA'
  );
}

// ---- filtro que no matchea ningún registro ----
state.resetFilters();
state.setDraftFilter('campana', { type: 'in', values: ['CAMPAÑA-INEXISTENTE'] });
state.applyFilters();
const snapshotVacio = state.getSnapshot();

assert(snapshotVacio.filteredData.length === 0, 'Un filtro sin coincidencias deja el subconjunto en 0 observaciones');
assert(
  snapshotVacio.windowSummary.every((w) => w.n === 0),
  `Con 0 observaciones, las ${TOTAL_VENTANAS} ventanas quedan vacías (no se "inventan" datos)`
);
assert(
  snapshotVacio.kpis.medianaGeneral === null,
  'Con 0 observaciones, la mediana general es null (no 0, no NaN, no un valor fabricado)'
);
assert(
  snapshotVacio.representatividadTemporal.nivel === 'INSUFICIENTE',
  'Con 0 observaciones, la representatividad temporal es INSUFICIENTE'
);
assert(
  snapshotVacio.messages.length === 1 && /no hay observaciones/i.test(snapshotVacio.messages[0]),
  'Con 0 observaciones, el único mensaje automático es el de subconjunto vacío, sugiriendo relajar filtros'
);

state.resetFilters();

// ============================================================================
// 8. VALIDACIÓN DE LOS CUATRO AJUSTES POST-QA
// ============================================================================
section('8. VALIDACIÓN DE LOS CUATRO AJUSTES ACORDADOS TRAS EL QA');

// --- 8.1: bug de parseFlexibleNumber corregido ---
console.log('\n8.1 — parseFlexibleNumber: separador de miles + decimal combinados');
assert(parseFlexibleNumber('3.600,50') === 3600.5, '"3.600,50" (formato es-AR) se interpreta correctamente como 3600.5');
assert(parseFlexibleNumber('3,600.50') === 3600.5, '"3,600.50" (formato en-US) se interpreta correctamente como 3600.5');
assert(parseFlexibleNumber('4085,56') === 4085.56, 'El formato ya usado en la base real ("4085,56") se sigue interpretando igual que antes (sin regresión)');
assert(parseFlexibleNumber('1.234.567') === 1234567, '"1.234.567" (varios puntos, sin coma) se interpreta como separador de miles puro, no como decimal inválido');
assert(parseFlexibleNumber('5,5,5') === null, 'Un formato no interpretable ("5,5,5") se sigue rechazando con null, nunca con un valor inventado');

// --- 8.2: conteo dinámico de observaciones fuera de rango ---
console.log('\n8.2 — Conteo dinámico de observaciones fuera del rango octubre-enero');
const registrosFueraDeRango = records.filter((r) => r.fechaFueraDeRangoAnalizado);
console.log(`Observaciones fuera de rango en el dataset completo: ${registrosFueraDeRango.length}`);

state.resetFilters();
const snapshotSinFiltro = state.getSnapshot();
assert(
  'observacionesFueraDeRango' in snapshotSinFiltro.kpis,
  'El KPI observacionesFueraDeRango existe en el estado derivado'
);
assert(
  snapshotSinFiltro.kpis.observacionesFueraDeRango === registrosFueraDeRango.length,
  `Sin filtros, observacionesFueraDeRango coincide con el conteo real del dataset completo (${registrosFueraDeRango.length})`
);

// caso concreto que la QA había señalado como engañoso: subconjunto 100% fuera de rango
const soloSeptiembreState = createAppState();
const treintaFueraDeRango = records.slice(0, 30).map((r) => ({
  ...r, fechaSiembraMes: 9, fechaSiembraDia: 15, fechaFueraDeRangoAnalizado: true,
}));
soloSeptiembreState.load(treintaFueraDeRango);
const snapshotSeptiembre = soloSeptiembreState.getSnapshot();
assert(
  snapshotSeptiembre.kpis.observacionesFueraDeRango === 30,
  'Con un subconjunto 100% fuera de rango, el KPI refleja las 30 observaciones (no queda en 0)'
);
assert(
  snapshotSeptiembre.messages.some((m) => /fuera del período analizado/i.test(m) && m.includes('30')),
  'El mensaje automático ahora aclara explícitamente que hay 30 observaciones fuera del período analizado (corrige el mensaje engañoso detectado en la QA)'
);
console.log('Mensajes para el caso "30 observaciones fuera de rango":');
snapshotSeptiembre.messages.forEach((m) => console.log('  -', m));

// --- 8.3: convención de clasificación en los límites, documentada y verificada ---
console.log('\n8.3 — Convención de clasificación en los límites exactos');
assert(
  CLASSIFICATION_LABELS.INFERIOR_A_P25 === 'Inferior al P25' &&
  CLASSIFICATION_LABELS.ENTRE_P25_MEDIANA === 'Entre P25 y Mediana' &&
  CLASSIFICATION_LABELS.ENTRE_MEDIANA_P75 === 'Entre Mediana y P75' &&
  CLASSIFICATION_LABELS.SUPERIOR_A_P75 === 'Superior al P75',
  'Las 4 etiquetas de clasificación están documentadas con el texto exacto acordado'
);

// set diseñado para que P25/mediana/P75 caigan en valores reales exactos
const setLimite = [100, 200, 300, 400, 500];
const windowsAux = buildFixedWindows();
const registrosLimite = setLimite.map((v) => ({
  rendimiento: v, fechaSiembraMes: 11, fechaSiembraDia: 3, fechaFueraDeRangoAnalizado: false,
}));
const resumenLimite = computeWindowSummary(registrosLimite, windowsAux);
const clasificadosLimite = classifyObservations(registrosLimite, windowsAux, resumenLimite);
const wLimite = resumenLimite.find((w) => w.n === 5);
console.log(`Set [100,200,300,400,500] -> P25=${wLimite.p25} mediana=${wLimite.mediana} P75=${wLimite.p75}`);
clasificadosLimite.forEach((r) => console.log(`  rendimiento=${r.rendimiento} -> ${r.posicionRelativa}`));

const p25Exacto = clasificadosLimite.find((r) => r.rendimiento === wLimite.p25);
const medianaExacta = clasificadosLimite.find((r) => r.rendimiento === wLimite.mediana);
const p75Exacto = clasificadosLimite.find((r) => r.rendimiento === wLimite.p75);
assert(p25Exacto.posicionRelativa === 'ENTRE_P25_MEDIANA', 'Un valor EXACTAMENTE igual a P25 cae en "Entre P25 y Mediana" (P25 incluido en el grupo que empieza en él)');
assert(medianaExacta.posicionRelativa === 'ENTRE_MEDIANA_P75', 'Un valor EXACTAMENTE igual a la Mediana cae en "Entre Mediana y P75" (Mediana incluida en el grupo que empieza en ella)');
assert(p75Exacto.posicionRelativa === 'ENTRE_MEDIANA_P75', 'Un valor EXACTAMENTE igual a P75 cae en "Entre Mediana y P75", NO en "Superior al P75" (P75 queda incluido en el grupo inferior, según la convención ahora documentada)');

// --- 8.4: renombrado del indicador de calidad a representatividad temporal ---
console.log('\n8.4 — Renombrado a "Representatividad temporal"');
assert(
  snapshotSinFiltro.representatividadTemporal !== undefined,
  'El campo representatividadTemporal existe en el snapshot del estado'
);
assert(
  snapshotSinFiltro.qualityIndicator === undefined,
  'El campo antiguo qualityIndicator ya no existe en el snapshot (renombrado limpio, sin dejar el alias viejo)'
);
assert(
  typeof snapshotSinFiltro.representatividadTemporal.descripcion === 'string' &&
  /no es una medida de la calidad estadística/i.test(snapshotSinFiltro.representatividadTemporal.descripcion),
  'La descripción aclara explícitamente que esto NO mide calidad estadística intrínseca de los datos'
);
console.log('Descripción del indicador:', snapshotSinFiltro.representatividadTemporal.descripcion);
console.log('Nivel actual (sin filtros):', snapshotSinFiltro.representatividadTemporal.nivel);
console.log('Motivo:', snapshotSinFiltro.representatividadTemporal.motivo);

state.resetFilters();

// ============================================================================
// 9. CORRECCIÓN DE ALCANCE: PERÍODO DEFINITIVO 01/OCT AL 15/ENE
// ============================================================================
section('9. PERÍODO DEFINITIVO (01/OCT AL 15/ENE) — 10 VALIDACIONES PEDIDAS');

// --- 1. Exactamente 21 ventanas ---
console.log('\n9.1 — Cantidad total de ventanas');
assert(TOTAL_VENTANAS === 21, `El período definitivo (01/oct-15/ene) genera exactamente 21 ventanas (obtenido: ${TOTAL_VENTANAS})`);

// --- 2. El 15 de enero pertenece a la última ventana ---
console.log('\n9.2 — El 15 de enero pertenece a la última ventana');
const windowsDefinitivas = buildFixedWindows();
const ultimaVentana = windowsDefinitivas[windowsDefinitivas.length - 1];
console.log(`Última ventana: "${ultimaVentana.label}" (id=${ultimaVentana.id})`);
assert(
  ultimaVentana.mes === 1 && ultimaVentana.diaInicio === 11 && ultimaVentana.diaFin === 15,
  'La última ventana es exactamente "11-15 Enero"'
);
assert(
  estaDentroDelPeriodoAnalizado(1, 15) === true,
  'El 15 de enero está DENTRO del período analizado (límite inclusive)'
);
const registro15Ene = { fechaSiembraMes: 1, fechaSiembraDia: 15, fechaFueraDeRangoAnalizado: false };
assert(
  assignWindowId(registro15Ene, windowsDefinitivas) === ultimaVentana.id,
  'El 15 de enero se asigna exactamente a la última ventana (id de la ventana "11-15 Enero")'
);

// --- 3. El 16 de enero queda fuera del rango ---
console.log('\n9.3 — El 16 de enero queda fuera del rango');
assert(estaDentroDelPeriodoAnalizado(1, 16) === false, 'El 16 de enero está FUERA del período analizado');
const registro16Ene = { fechaSiembraMes: 1, fechaSiembraDia: 16, fechaFueraDeRangoAnalizado: true };
assert(assignWindowId(registro16Ene, windowsDefinitivas) === null, 'El 16 de enero no se asigna a ninguna ventana');

// --- 4. El 31 de enero queda fuera del rango ---
console.log('\n9.4 — El 31 de enero queda fuera del rango');
assert(estaDentroDelPeriodoAnalizado(1, 31) === false, 'El 31 de enero está FUERA del período analizado');
const registro31Ene = { fechaSiembraMes: 1, fechaSiembraDia: 31, fechaFueraDeRangoAnalizado: true };
assert(assignWindowId(registro31Ene, windowsDefinitivas) === null, 'El 31 de enero no se asigna a ninguna ventana');

// --- 5. Orden correcto: octubre, noviembre, diciembre, enero ---
console.log('\n9.5 — Orden cronológico octubre -> noviembre -> diciembre -> enero');
const secuenciaMeses = windowsDefinitivas.map((w) => w.mes);
const secuenciaEsperadaDeCambios = [10, 11, 12, 1]; // orden en que deben aparecer los bloques de mes
const cambios = [secuenciaMeses[0]];
secuenciaMeses.forEach((m) => { if (cambios[cambios.length - 1] !== m) cambios.push(m); });
assert(
  JSON.stringify(cambios) === JSON.stringify(secuenciaEsperadaDeCambios),
  `Los bloques de mes aparecen en el orden octubre, noviembre, diciembre, enero (obtenido: ${cambios.join(' -> ')})`
);
assert(
  windowsDefinitivas.filter((w) => w.mes === 10).length === 6 &&
  windowsDefinitivas.filter((w) => w.mes === 11).length === 6 &&
  windowsDefinitivas.filter((w) => w.mes === 12).length === 6 &&
  windowsDefinitivas.filter((w) => w.mes === 1).length === 3,
  'Octubre, noviembre y diciembre tienen 6 ventanas cada uno; enero tiene exactamente 3 (01-05, 06-10, 11-15)'
);

// --- 6. Modo calendario completo muestra las 21 ventanas ---
console.log('\n9.6 — Modo "completo" muestra todas las ventanas definitivas');
const resumenVacio = computeWindowSummary([], windowsDefinitivas);
const visibleCompletoVacio = selectVisibleWindows(resumenVacio, 'completo');
assert(
  visibleCompletoVacio.length === TOTAL_VENTANAS,
  `Modo "completo" muestra las ${TOTAL_VENTANAS} ventanas incluso con el subconjunto vacío`
);

// --- 7. Modo automático recorta solo los bordes vacíos ---
console.log('\n9.7 — Modo "auto" recorta únicamente los bordes vacíos');
const datosAcotados = [
  ...Array(8).fill(0).map(() => ({ rendimiento: 3000, fechaSiembraMes: 11, fechaSiembraDia: 3, fechaFueraDeRangoAnalizado: false })), // ventana "1-5 Nov"
  ...Array(8).fill(0).map(() => ({ rendimiento: 3200, fechaSiembraMes: 12, fechaSiembraDia: 3, fechaFueraDeRangoAnalizado: false })), // ventana "1-5 Dic", con huecos internos entre nov y dic
];
const resumenAcotado = computeWindowSummary(datosAcotados, windowsDefinitivas);
const visibleAutoAcotado = selectVisibleWindows(resumenAcotado, 'auto');
assert(
  visibleAutoAcotado[0].n > 0 && visibleAutoAcotado[visibleAutoAcotado.length - 1].n > 0,
  'En modo "auto", el primer y el último elemento visible tienen observaciones (bordes recortados)'
);
assert(
  visibleAutoAcotado.some((w) => w.n === 0),
  'En modo "auto", los huecos INTERNOS (entre la ventana de noviembre y la de diciembre) se preservan visibles'
);
assert(
  visibleAutoAcotado.length < TOTAL_VENTANAS,
  'En modo "auto", con datos acotados a solo 2 ventanas pobladas, se muestran menos ventanas que el total del período'
);

// --- 8. Observaciones posteriores al 15/ene incrementan observacionesFueraDeRango ---
console.log('\n9.8 — Observaciones posteriores al 15/ene incrementan observacionesFueraDeRango');
const conFechasTardias = [
  ...records.slice(0, 20),
  ...Array(5).fill(0).map(() => ({ rendimiento: 3000, fechaSiembraMes: 1, fechaSiembraDia: 20, fechaFueraDeRangoAnalizado: true })), // 20/ene, fuera de rango
];
const resumenTardio = computeWindowSummary(conFechasTardias, windowsDefinitivas);
const kpisTardios = computeKPIs(conFechasTardias, resumenTardio);
assert(
  kpisTardios.observacionesFueraDeRango >= 5,
  `Las 5 observaciones del 20 de enero se contabilizan en observacionesFueraDeRango (obtenido: ${kpisTardios.observacionesFueraDeRango})`
);

// --- 9. Suma de observaciones dentro de ventanas + fuera de rango = total filtrado ---
console.log('\n9.9 — Conservación del total: dentro de ventanas + fuera de rango = total filtrado');
const sumaDentroDeVentanas = resumenTardio.reduce((acc, w) => acc + w.n, 0);
assert(
  sumaDentroDeVentanas + kpisTardios.observacionesFueraDeRango === conFechasTardias.length,
  `${sumaDentroDeVentanas} (dentro de ventanas) + ${kpisTardios.observacionesFueraDeRango} (fuera de rango) = ${conFechasTardias.length} (total filtrado)`
);

// --- 10. Ningún cálculo o mensaje conserva referencias rígidas a 24 ventanas ---
console.log('\n9.10 — Ningún mensaje ni cálculo conserva referencias rígidas al total anterior (24)');
state.resetFilters();
const snapshotFinalPeriodo = state.getSnapshot();
assert(
  snapshotFinalPeriodo.kpis.totalVentanas === TOTAL_VENTANAS,
  `kpis.totalVentanas refleja el total real y dinámico (${TOTAL_VENTANAS}), no un valor fijo`
);
const todosLosMensajes = snapshotFinalPeriodo.messages.join(' | ');
assert(
  !todosLosMensajes.includes('24'),
  'Ningún mensaje generado contiene el número "24" (el total anterior, ya no vigente)'
);
assert(
  snapshotFinalPeriodo.windowSummary.length === TOTAL_VENTANAS,
  `windowSummary tiene exactamente ${TOTAL_VENTANAS} entradas con el dataset real completo`
);
console.log('Mensajes actuales (dataset completo, sin filtros):');
snapshotFinalPeriodo.messages.forEach((m) => console.log('  -', m));

state.resetFilters();

section('RESULTADO FINAL');
console.log(`Verificaciones ejecutadas: ${checksRun}`);
console.log(`Verificaciones fallidas:   ${checksFailed}`);

if (checksFailed > 0) {
  console.log('\n✗ EL MOTOR TIENE VERIFICACIONES FALLIDAS. Revisar los mensajes marcados con "FALLÓ" arriba.');
  process.exit(1);
} else {
  console.log('\n✓ TODAS LAS VERIFICACIONES PASARON. El motor está listo para alimentar la interfaz.');
  process.exit(0);
}
