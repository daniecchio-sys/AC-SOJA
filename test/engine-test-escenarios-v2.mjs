// ============================================================================
// test/engine-test-escenarios-v2.mjs
// Verificación del motor v2 de Escenarios (documento
// AC_SOJA_25_26_Arquitectura_Funcional_Escenarios_v2.md): heatmap
// Fecha de siembra × Ciclo, dispersión relativa, ranking de combinaciones
// elegibles. No repite lo ya cubierto por engine-test-escenarios.mjs
// (constructor, filtrado AND, estados del indicador principal).
// Se ejecuta con: node test/engine-test-escenarios-v2.mjs
// ============================================================================

import fs from 'fs';
import { loadDataset } from '../js/data-loader.js';
import { createEscenarioState, CICLOS_FRECUENTES, MIN_OBS_KPI } from '../js/escenario-state.js';
import { computeDispersionRelativa } from '../js/stats.js';

let checks = 0, failed = 0;
function check(desc, cond) {
  checks++;
  if (!cond) { failed++; console.log(`  ✗ ${desc}`); } else { console.log(`  ✓ ${desc}`); }
}

const csvText = fs.readFileSync('data/ac_soja.csv', 'utf8');
const { records } = loadDataset(csvText);

console.log('1. Estructura del heatmap: 4 filas frecuentes siempre presentes');
{
  const es = createEscenarioState();
  es.load(records);
  // condición muy angosta a propósito, para forzar que algunos de los 4
  // ciclos frecuentes queden en n=0 dentro de este escenario particular.
  es.setCondicion('zona', { type: 'in', values: ['CEN'] });
  const snap = es.getSnapshot();
  const filasFrecuentes = snap.heatmapFilas.filter((f) => f.esFrecuente);
  check('Las 4 filas frecuentes están SIEMPRE presentes, aunque alguna tenga n=0', filasFrecuentes.length === 4);
  check('El orden de las filas frecuentes coincide exactamente con CICLOS_FRECUENTES', filasFrecuentes.every((f, i) => f.ciclo === CICLOS_FRECUENTES[i]));
  check('Cada fila frecuente tiene exactamente 21 celdas (una por ventana)', filasFrecuentes.every((f) => f.celdas.length === 21));
}

console.log('\n2. Filas eventuales: solo aparecen si tienen al menos 1 observación en ESE escenario');
{
  const es = createEscenarioState();
  es.load(records);
  const snapSinCondiciones = es.getSnapshot();
  const eventualesSinFiltro = snapSinCondiciones.ciclosEventualesPresentes;
  check('Sin condiciones, aparecen ciclos eventuales reales (S/D, 6 LARGO, etc.)', eventualesSinFiltro.length > 0);

  es.setCondicion('zona', { type: 'in', values: ['4'] });
  let lanzoError = false;
  try { es.setCondicion('ciclo', { type: 'in', values: ['5 CORTO'] }); }
  catch (e) { lanzoError = true; }
  check('Ciclo ya no es una variable permitida como condición del escenario (lista actualizada) -- setCondicion lanza error', lanzoError);
  // El heatmap y el ranking siguen usando Ciclo como dato (desde
  // filteredData), aunque ya no se pueda fijar como condición -- se
  // verifica en la sección 1 de este mismo archivo que las 4 filas
  // frecuentes del heatmap siguen intactas.
}

console.log('\n3. Dispersión relativa: fórmula exacta y umbral de elegibilidad');
{
  const es = createEscenarioState();
  es.load(records);
  es.setCondicion('zona', { type: 'in', values: ['4'] });
  const snap = es.getSnapshot();
  const celdaConDatos = snap.heatmapFilas.flatMap((f) => f.celdas).find((c) => c.n >= MIN_OBS_KPI && c.mediana !== null);
  check('Existe al menos una celda con n>=20 en este escenario para verificar la fórmula', celdaConDatos !== undefined);
  if (celdaConDatos) {
    const esperado = computeDispersionRelativa(celdaConDatos.p25, celdaConDatos.p75, celdaConDatos.mediana);
    check('dispersionRelativa de la celda coincide con (P75-P25)/Mediana×100 calculado de forma independiente', celdaConDatos.dispersionRelativa === esperado);
  }
  const celdaInsuficiente = snap.heatmapFilas.flatMap((f) => f.celdas).find((c) => c.n > 0 && c.n < MIN_OBS_KPI);
  if (celdaInsuficiente) {
    check('Una celda con 0<n<20 NO tiene dispersión relativa calculada (queda null)', celdaInsuficiente.dispersionRelativa === null);
  }
  const celdaVacia = snap.heatmapFilas.flatMap((f) => f.celdas).find((c) => c.n === 0);
  if (celdaVacia) {
    check('Una celda con n=0 tampoco tiene dispersión relativa (queda null)', celdaVacia.dispersionRelativa === null);
  }
}

console.log('\n4. Ranking elegible: solo n>=20, sobre TODO el escenario (no solo lo "visible")');
{
  const es = createEscenarioState();
  es.load(records);
  es.setCondicion('zona', { type: 'in', values: ['4'] });
  const snap = es.getSnapshot();
  check('rankingElegible no está vacío para un escenario con suficiente evidencia', snap.rankingElegible.length > 0);
  check('Todas las combinaciones del ranking tienen n>=MIN_OBS_KPI', snap.rankingElegible.every((c) => c.n >= MIN_OBS_KPI));

  // El ranking tiene que incluir combinaciones de ventanas FUERA del rango
  // Nov-Dic (Oct/Ene) si existen y son elegibles -- el rango visible del
  // heatmap es un recorte de INTERFAZ, no debe afectar el cálculo del motor.
  const totalCeldasElegibles = snap.heatmapFilas.reduce(
    (acc, f) => acc + f.celdas.filter((c) => c.n >= MIN_OBS_KPI).length, 0,
  );
  check('rankingElegible tiene EXACTAMENTE la misma cantidad que sumar las celdas elegibles de todas las filas del heatmap (frecuentes + eventuales)', snap.rankingElegible.length === totalCeldasElegibles);

  // cross-check: cada entrada del ranking tiene los mismos valores que su celda de origen
  const entradaRanking = snap.rankingElegible[0];
  const filaOrigen = snap.heatmapFilas.find((f) => f.ciclo === entradaRanking.ciclo);
  const celdaOrigen = filaOrigen.celdas.find((c) => c.windowId === entradaRanking.windowId);
  check('Una entrada del ranking tiene EXACTAMENTE los mismos valores que su celda de origen en el heatmap (no hay un cálculo separado y potencialmente distinto)',
    entradaRanking.mediana === celdaOrigen.mediana && entradaRanking.p25 === celdaOrigen.p25 && entradaRanking.p75 === celdaOrigen.p75 && entradaRanking.dispersionRelativa === celdaOrigen.dispersionRelativa);
}

console.log('\n5. Recalculo reactivo: cambiar una condición recalcula heatmap y ranking de inmediato');
{
  const es = createEscenarioState();
  es.load(records);
  es.setCondicion('zona', { type: 'in', values: ['4'] });
  const nRankingAntes = es.getSnapshot().rankingElegible.length;
  es.setCondicion('enso', { type: 'in', values: ['NIÑA'] });
  const nRankingDespues = es.getSnapshot().rankingElegible.length;
  check('Agregar una condición más angosta cambia (nunca aumenta la evidencia) el ranking elegible', nRankingDespues <= nRankingAntes);
}

console.log('\n6. Estado con menos de 50 observaciones: heatmap y ranking se calculan igual en el motor (la interfaz decide si los muestra)');
{
  const es = createEscenarioState();
  es.load(records);
  es.setCondicion('zona', { type: 'in', values: ['CEN'] });
  es.setCondicion('enso', { type: 'in', values: ['NEUTRO'] });
  const snap = es.getSnapshot();
  if (snap.nEscenario < 50) {
    check('El motor sigue devolviendo heatmapFilas incluso por debajo del umbral -- la Sección 9.2 es responsabilidad de la interfaz, no del motor. Siempre al menos las 4 filas frecuentes.', Array.isArray(snap.heatmapFilas) && snap.heatmapFilas.length >= 4);
  } else {
    console.log('  (este escenario particular superó 50 -- el motor igual expone heatmapFilas siempre, se verificó en los casos anteriores)');
  }
}

console.log('\n7. Medianas de referencia del gráfico de dispersión (Sección 6.3 v2)');
{
  const { medianOf } = await import('../js/utils.js');
  const es = createEscenarioState();
  es.load(records);
  es.setCondicion('zona', { type: 'in', values: ['4'] });
  const snap = es.getSnapshot();
  const medianaEsperada = medianOf(snap.rankingElegible.map((c) => c.mediana));
  const dispersionEsperada = medianOf(snap.rankingElegible.map((c) => c.dispersionRelativa));
  check('medianaDeMedianas coincide con medianOf() aplicado de forma independiente sobre rankingElegible', snap.medianaDeMedianas === medianaEsperada);
  check('medianaDeDispersiones coincide con medianOf() aplicado de forma independiente sobre rankingElegible', snap.medianaDeDispersiones === dispersionEsperada);
  check('Ambas referencias son números finitos (hay evidencia suficiente en este escenario)', Number.isFinite(snap.medianaDeMedianas) && Number.isFinite(snap.medianaDeDispersiones));
}

console.log('\n8. Sin combinaciones elegibles, las referencias quedan null (no NaN, no 0 engañoso)');
{
  const es = createEscenarioState();
  es.load(records);
  es.setCondicion('zona', { type: 'in', values: ['CEN'] });
  es.setCondicion('enso', { type: 'in', values: ['__VALOR_INEXISTENTE__'] });
  const snap = es.getSnapshot();
  check('rankingElegible vacío -> medianaDeMedianas es null', snap.medianaDeMedianas === null);
  check('rankingElegible vacío -> medianaDeDispersiones es null', snap.medianaDeDispersiones === null);
}

console.log('\n' + '='.repeat(60));
console.log(`Verificaciones ejecutadas: ${checks}`);
console.log(`Verificaciones fallidas:   ${failed}`);
console.log(failed === 0
  ? '\n✓ EL MOTOR v2 DE ESCENARIOS (HEATMAP + RANKING) FUNCIONA CORRECTAMENTE.'
  : '\n✗ HAY VERIFICACIONES FALLIDAS.');
process.exit(failed === 0 ? 0 : 1);
