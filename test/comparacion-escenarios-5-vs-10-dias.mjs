// ============================================================================
// test/comparacion-escenarios-5-vs-10-dias.mjs
// Comparación técnica 5 vs 10 días, aplicada al heatmap Fecha de siembra ×
// Ciclo y al ranking de combinaciones de Escenarios. Complementa
// comparacion-ventanas-5-vs-10-dias.mjs (Explorar) -- mismo criterio de
// métricas (total de celdas, n<5, n<10, n>=20), adaptado a la unidad de
// análisis de este módulo (celda = ventana × ciclo, no solo ventana).
// Se ejecuta con: node test/comparacion-escenarios-5-vs-10-dias.mjs
// ============================================================================

import fs from 'fs';
import { loadDataset } from '../js/data-loader.js';
import { buildFixedWindows } from '../js/stats.js';
import { buildVentanas10Dias } from '../js/stats-ventanas-10dias.js';
import { createEscenarioState, MIN_OBS_KPI, MIN_OBS_ESCENARIO } from '../js/escenario-state.js';

const csv = fs.readFileSync('data/ac_soja.csv', 'utf8');
const { records } = loadDataset(csv);

function analizarEscenario(nombre, windowBuilder, condiciones) {
  const es = createEscenarioState({ windowBuilder });
  es.load(records);
  Object.entries(condiciones).forEach(([key, condition]) => es.setCondicion(key, condition));
  const snap = es.getSnapshot();

  const todasLasCeldas = snap.heatmapFilas.flatMap((f) => f.celdas);
  const celdasConDatos = todasLasCeldas.filter((c) => c.n > 0);
  const menos5 = todasLasCeldas.filter((c) => c.n > 0 && c.n < 5).length;
  const menos10 = todasLasCeldas.filter((c) => c.n > 0 && c.n < 10).length;
  const mas20 = todasLasCeldas.filter((c) => c.n >= MIN_OBS_KPI).length;
  const vacias = todasLasCeldas.filter((c) => c.n === 0).length;

  console.log(`\n=== ${nombre} ===`);
  console.log(`n del escenario: ${snap.nEscenario} (${snap.nEscenario >= MIN_OBS_ESCENARIO ? 'alcanza' : 'NO alcanza'} el umbral de ${MIN_OBS_ESCENARIO})`);
  console.log(`Filas del heatmap (ciclos con datos): ${snap.heatmapFilas.filter(f=>f.n>0).length} de ${snap.heatmapFilas.length} totales (4 frecuentes + ${snap.ciclosEventualesPresentes.length} eventuales)`);
  console.log(`Total de celdas (ventana × ciclo): ${todasLasCeldas.length}`);
  console.log(`Celdas vacías (n=0): ${vacias}`);
  console.log(`Celdas con 0<n<5: ${menos5}`);
  console.log(`Celdas con 0<n<10: ${menos10}`);
  console.log(`Celdas con n>=${MIN_OBS_KPI} (elegibles para ranking): ${mas20} de ${todasLasCeldas.length} (${todasLasCeldas.length ? Math.round(mas20/todasLasCeldas.length*100) : 0}%)`);
  console.log(`Combinaciones en el ranking (rankingElegible): ${snap.rankingElegible.length}`);
  console.log(`Mediana de referencia (medianaDeMedianas): ${snap.medianaDeMedianas}`);
  console.log(`Dispersión de referencia (medianaDeDispersiones): ${snap.medianaDeDispersiones}%`);
  if (celdasConDatos.length > 0) {
    console.log(`n mínimo/máximo entre celdas con datos: ${Math.min(...celdasConDatos.map(c=>c.n))} / ${Math.max(...celdasConDatos.map(c=>c.n))}`);
  }
  return { total: todasLasCeldas.length, vacias, menos5, menos10, mas20, ranking: snap.rankingElegible.length };
}

console.log('####################################################');
console.log('# CASO 1: Zona 4 (evidencia amplia, n grande)');
console.log('####################################################');
analizarEscenario('5 días', buildFixedWindows, { zona: { type: 'in', values: ['4'] } });
analizarEscenario('10 días', buildVentanas10Dias, { zona: { type: 'in', values: ['4'] } });

console.log('\n\n####################################################');
console.log('# CASO 2: Zona 4 + Riego=SI (evidencia acotada, el caso real que le importa a Escenarios)');
console.log('####################################################');
analizarEscenario('5 días', buildFixedWindows, { zona: { type: 'in', values: ['4'] }, riego: { type: 'in', values: ['SI'] } });
analizarEscenario('10 días', buildVentanas10Dias, { zona: { type: 'in', values: ['4'] }, riego: { type: 'in', values: ['SI'] } });

console.log('\n\n####################################################');
console.log('# CASO 3: Zona 4 + ENSO=NIÑA + Riego=SI (evidencia muy acotada)');
console.log('####################################################');
analizarEscenario('5 días', buildFixedWindows, { zona: { type: 'in', values: ['4'] }, enso: { type: 'in', values: ['NIÑA'] }, riego: { type: 'in', values: ['SI'] } });
analizarEscenario('10 días', buildVentanas10Dias, { zona: { type: 'in', values: ['4'] }, enso: { type: 'in', values: ['NIÑA'] }, riego: { type: 'in', values: ['SI'] } });
