import fs from 'fs';
import { loadDataset } from '../js/data-loader.js';
import { buildFixedWindows, computeWindowSummary, computeKPIs, ventanaConMayorP75, ventanaConMayorP25, MIN_OBS_KPI } from '../js/stats.js';
import { buildVentanas10Dias } from '../js/stats-ventanas-10dias.js';

const csv = fs.readFileSync('data/ac_soja.csv', 'utf8');
const { records } = loadDataset(csv);

function analizar(nombre, windows) {
  const resumen = computeWindowSummary(records, windows);
  const kpis = computeKPIs(records, resumen);
  const conDatos = resumen.filter(w => w.n > 0);
  const menos5 = resumen.filter(w => w.n > 0 && w.n < 5).length;
  const menos10 = resumen.filter(w => w.n > 0 && w.n < 10).length;
  const cero = resumen.filter(w => w.n === 0).length;
  const mas20 = resumen.filter(w => w.n >= MIN_OBS_KPI).length;
  const p75Win = ventanaConMayorP75(resumen);
  const p25Win = ventanaConMayorP25(resumen);

  console.log(`\n=== ${nombre} ===`);
  console.log(`Total de ventanas: ${resumen.length}`);
  console.log(`Ventanas con n=0 (vacías): ${cero}`);
  console.log(`Ventanas con 0<n<5: ${menos5}`);
  console.log(`Ventanas con 0<n<10: ${menos10}`);
  console.log(`Ventanas con n>=${MIN_OBS_KPI} (elegibles para KPI): ${mas20} de ${resumen.length} (${Math.round(mas20/resumen.length*100)}%)`);
  console.log(`n promedio entre ventanas con datos: ${Math.round(conDatos.reduce((a,w)=>a+w.n,0)/conDatos.length)}`);
  console.log(`n mínimo / máximo entre ventanas con datos: ${Math.min(...conDatos.map(w=>w.n))} / ${Math.max(...conDatos.map(w=>w.n))}`);
  console.log(`Mayor potencial observado (P75): ${p75Win ? `${Math.round(p75Win.p75)} kg/ha en ${p75Win.label} (n=${p75Win.n})` : 'sin ventana elegible'}`);
  console.log(`Mayor piso productivo (P25): ${p25Win ? `${Math.round(p25Win.p25)} kg/ha en ${p25Win.label} (n=${p25Win.n})` : 'sin ventana elegible'}`);
  console.log(`Amplitud entre ventanas (kpis.amplitudEntreVentanas): ${kpis.amplitudEntreVentanas}`);
  console.log(`Mediana general del subconjunto: ${kpis.medianaGeneral}`);

  // variabilidad de percentiles entre ventanas consecutivas CON datos (proxy de "estabilidad visual" / continuidad de la banda)
  let saltosP25 = [], saltosMediana = [], saltosP75 = [];
  for (let i = 1; i < resumen.length; i++) {
    const a = resumen[i-1], b = resumen[i];
    if (a.n > 0 && b.n > 0 && a.mediana !== null && b.mediana !== null) {
      saltosP25.push(Math.abs(b.p25 - a.p25));
      saltosMediana.push(Math.abs(b.mediana - a.mediana));
      saltosP75.push(Math.abs(b.p75 - a.p75));
    }
  }
  const prom = (arr) => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : null;
  console.log(`Salto promedio entre ventanas consecutivas (con datos en ambas) -- P25: ${prom(saltosP25)} kg/ha | Mediana: ${prom(saltosMediana)} kg/ha | P75: ${prom(saltosP75)} kg/ha`);
  console.log(`Cantidad de "saltos" (pares de ventanas consecutivas con datos, sobre las que se calculó variabilidad): ${saltosMediana.length}`);

  return { resumen, kpis, cero, menos5, menos10, mas20, saltosMediana: prom(saltosMediana) };
}

const w5 = buildFixedWindows();
const w10 = buildVentanas10Dias();

const r5 = analizar('5 DÍAS (vigente) -- sobre TODA la red, sin filtros', w5);
const r10 = analizar('10 DÍAS (prueba) -- sobre TODA la red, sin filtros', w10);

console.log('\n\n=== CASO DE EVIDENCIA ACOTADA: Zona 4 + Riego=SI (para ver el efecto en un subconjunto realista) ===');
const { applyFilters } = await import('../js/filters.js');
const subset = applyFilters(records, { zona: {type:'in', values:['4']}, riego: {type:'in', values:['SI']} });
console.log(`n del subconjunto: ${subset.length}`);
function analizarSubset(nombre, windows) {
  const resumen = computeWindowSummary(subset, windows);
  const cero = resumen.filter(w=>w.n===0).length;
  const menos5 = resumen.filter(w=>w.n>0&&w.n<5).length;
  const mas20 = resumen.filter(w=>w.n>=MIN_OBS_KPI).length;
  console.log(`${nombre}: total=${resumen.length}, vacías=${cero}, 0<n<5=${menos5}, n>=20=${mas20} (${Math.round(mas20/resumen.length*100)}%)`);
}
analizarSubset('5 días', w5);
analizarSubset('10 días', w10);
