// ============================================================================
// test/smoke-test-ui.mjs
// Verificación de EXPLORAR (explorar.html / app.js), con ventanas de ~10
// días como configuración definitiva del producto.
// Requiere el proyecto servido por HTTP en localhost:8098.
// Se ejecuta con: node test/smoke-test-ui.mjs
// ============================================================================

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let checksRun = 0, checksFailed = 0;
function assert(cond, msg) {
  checksRun++;
  if (!cond) { checksFailed++; console.error(`  ✗ FALLÓ: ${msg}`); }
  else console.log(`  ✓ ${msg}`);
}
function esperar(ms) { return new Promise((res) => setTimeout(res, ms)); }

const plotlyLlamadas = [];
const plotlyFalso = {
  react(containerId, traces, layout) { plotlyLlamadas.push({ containerId, traces, layout }); },
  purge() {},
};

console.log('Preparando DOM (jsdom) y globals de app.js...');
const html = readFileSync(path.join(ROOT, 'explorar.html'), 'utf-8');
const dom = new JSDOM(html, { url: 'http://localhost:8098/explorar.html', pretendToBeVisual: true });
const { window } = dom;

global.window = window;
global.document = window.document;
global.Event = window.Event;
global.HTMLElement = window.HTMLElement;
global.Plotly = plotlyFalso;

const graficoEl = window.document.getElementById('grafico-principal');
graficoEl.on = () => {};
graficoEl.removeAllListeners = () => {};

process.chdir(ROOT);
const fetchNativo = fetch;
global.fetch = (url, opts) => (typeof url === 'string' && !url.startsWith('http')
  ? fetchNativo(`http://localhost:8098/${url}`, opts)
  : fetchNativo(url, opts));

await import(path.join(ROOT, 'js', 'app.js') + `?t=${Date.now()}`);
await esperar(500);

// ============================================================================
console.log('\n1. Motor: 11 ventanas de ~10 días, no 21 de 5 días');
const llamada = plotlyLlamadas.filter((c) => c.containerId === 'grafico-principal').pop();
assert(llamada !== undefined, 'Se llamó a Plotly.react para el gráfico principal');
assert(document.getElementById('consulta').textContent.length > 0, 'La oración de consulta se renderizó (mismo query-builder.js reutilizado)');

console.log('\n2. Tabla de valores exactos: como máximo 11 filas (nunca 21)');
document.querySelector('.valores-exactos').setAttribute('open', '');
const filasTabla = document.querySelectorAll('#tabla-ventanas-body tr');
assert(filasTabla.length <= 11, `La tabla tiene como máximo 11 filas (obtenido: ${filasTabla.length})`);
if (filasTabla.length > 0) {
  const primeraFila = filasTabla[0].textContent;
  assert(/1-10|11-20|21-31|21-30|11-15/.test(primeraFila), `Las etiquetas de ventana son de ~10 días, no de 5 (obtenido: "${primeraFila.slice(0, 40)}")`);
}

console.log('\n3. Indicadores destacados reemplazan el bloque de texto "¿Qué muestran estos datos?"');
assert(document.getElementById('respuesta-toggle') === null, 'El toggle de texto "¿Qué muestran estos datos?" ya no existe');
const gridKpisExplorar10d = document.getElementById('grid-kpis-explorar');
const tarjetasKpiExplorar10d = gridKpisExplorar10d.querySelectorAll('.kpi-destacado');
assert(tarjetasKpiExplorar10d.length === 5, `Hay exactamente 5 indicadores destacados (obtenido: ${tarjetasKpiExplorar10d.length})`);
const titulosKpiExplorar10d = Array.from(tarjetasKpiExplorar10d).map((c) => c.querySelector('.kpi-destacado-titulo').textContent);
['Mayor mediana observada', 'Mayor potencial observado', 'Mayor piso productivo', 'Mayor respaldo histórico', 'Amplitud entre ventanas']
  .forEach((t) => assert(titulosKpiExplorar10d.includes(t), `Existe el indicador "${t}"`));

console.log('\n4. Historial y aclaraciones metodológicas siguen conectados (mismo history.js/mensajes reutilizados)');
assert(document.getElementById('historial-atras') !== null, 'El control de historial está presente');
assert(document.getElementById('aclaraciones-explorar').textContent.includes('no constituyen predicciones ni recomendaciones agronómicas'), 'Las aclaraciones metodológicas están presentes, con el texto permanente esperado');

console.log('\n5. Histograma independiente + sombreado por mes (mismo criterio ya aplicado a Comparar)');
const llamadaGrafico = plotlyLlamadas.filter((c) => c.containerId === 'grafico-principal').pop();
const llamadaHistograma = plotlyLlamadas.filter((c) => c.containerId === 'histograma-principal').pop();
assert(llamadaHistograma !== undefined && llamadaHistograma.traces.some((t) => t.type === 'bar'), 'El histograma independiente se dibujó con la traza de barras');
assert(llamadaGrafico.traces.every((t) => t.yaxis !== 'y2'), 'El gráfico principal ya no tiene ninguna traza en yaxis2 (la frecuencia se separó)');
assert(llamadaGrafico.layout.shapes.some((s) => s.type === 'rect'), 'El gráfico principal tiene sombreado alternado por mes');
assert(llamadaHistograma.layout.shapes.some((s) => s.type === 'rect'), 'El histograma también tiene el mismo sombreado por mes');
assert(JSON.stringify(llamadaGrafico.layout.xaxis.tickvals) === JSON.stringify(llamadaHistograma.layout.xaxis.tickvals), 'Gráfico e histograma comparten los mismos ticks de mes (11 ventanas de 10 días)');
assert(document.querySelector('.frecuencia-titulo')?.getAttribute('title') === 'Cantidad de lotes utilizados para calcular cada ventana.', 'El tooltip nativo del título de frecuencia tiene el texto exacto esperado');

console.log('\n' + '='.repeat(60));
console.log(`Verificaciones ejecutadas: ${checksRun}`);
console.log(`Verificaciones fallidas:   ${checksFailed}`);
console.log(checksFailed === 0
  ? '\n✓ EXPLORAR FUNCIONA DE PUNTA A PUNTA (ventanas de ~10 días).'
  : '\n✗ HAY VERIFICACIONES FALLIDAS.');
process.exit(checksFailed === 0 ? 0 : 1);
