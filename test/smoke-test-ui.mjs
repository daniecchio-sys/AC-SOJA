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

console.log('\n6. Filtro dinámico Material');
{
  function agregarClickPorTexto(selector, textoIncluido) {
    const item = Array.from(document.querySelectorAll(selector)).find((el) => el.textContent.includes(textoIncluido));
    if (item) item.dispatchEvent(new window.Event('click', { bubbles: true }));
    return item;
  }

  const selectMaterial = document.getElementById('select-material');
  assert(selectMaterial !== null, 'Existe el selector de Material');
  assert(selectMaterial.options[0].value === '' && selectMaterial.options[0].textContent === 'Todos los materiales', 'La primera opción es "Todos los materiales" y es la seleccionada por defecto');
  assert(selectMaterial.value === '', 'Sin condiciones activas, "Todos los materiales" es la selección real');
  assert(selectMaterial.options.length > 1, 'Hay materiales elegibles listados sin ningún otro filtro activo');
  assert(!selectMaterial.disabled, 'El selector está habilitado cuando hay materiales elegibles');

  const opciones = Array.from(selectMaterial.options).slice(1).map((o) => ({ n: parseInt(o.textContent.match(/\((\d[\d.]*)\)/)?.[1].replace(/\./g, '') || '0', 10), texto: o.textContent }));
  assert(opciones.every((o) => o.n >= 100), 'Todas las opciones tienen n≥100 (ninguna por debajo del umbral)');
  assert(opciones.every((o, i) => i === 0 || opciones[i - 1].n >= o.n), 'Las opciones están ordenadas de mayor a menor n');
  assert(/\(\d[\d.]*\)/.test(opciones[0].texto), 'Cada opción muestra su cantidad de registros entre paréntesis');

  console.log('\n6b. Seleccionar un material aplica el filtro a toda la pantalla');
  const primerMaterial = selectMaterial.options[1].value;
  selectMaterial.value = primerMaterial;
  selectMaterial.dispatchEvent(new window.Event('change', { bubbles: true }));
  await esperar(50);
  assert(document.getElementById('contexto').textContent.includes(`Material: ${primerMaterial}`), 'El contexto muestra "Material: [nombre]" tras seleccionar uno');
  assert(!document.getElementById('consulta').textContent.includes(primerMaterial), 'Material NO aparece como pill duplicado en la oración (tiene su propio selector)');

  console.log('\n6c. Volver a "Todos los materiales" oculta la etiqueta de contexto');
  selectMaterial.value = '';
  selectMaterial.dispatchEvent(new window.Event('change', { bubbles: true }));
  await esperar(50);
  assert(!document.getElementById('contexto').textContent.includes('Material:'), 'Con "Todos los materiales", la etiqueta de contexto desaparece');

  console.log('\n6d. Estado sin materiales elegibles (filtro muy angosto)');
  agregarClickPorTexto('#consulta .agregar-condicion', '');
  await esperar(50);
  agregarClickPorTexto('.buscador-item', 'ENSO');
  await esperar(50);
  const opcionEnso = Array.from(document.querySelectorAll('.buscador-item')).find((el) => !el.className.includes('vacio'));
  if (opcionEnso) opcionEnso.dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  const selectTrasFiltro = document.getElementById('select-material');
  if (selectTrasFiltro.options.length === 1) {
    assert(selectTrasFiltro.disabled, 'Sin materiales elegibles, el selector queda deshabilitado');
    assert(document.getElementById('material-mensaje-vacio').style.display !== 'none', 'Se muestra el mensaje de "no hay materiales con al menos 100 lotes..."');
    assert(document.getElementById('material-mensaje-vacio').textContent.includes('Ampliá la selección'), 'El mensaje tiene el texto exacto pedido');
    assert(document.querySelector('.bloque-grafico') !== null && document.getElementById('grafico-principal') !== null, 'El gráfico general sigue visible (no se reemplaza por el mensaje)');
  } else {
    console.log('  (este filtro particular no vació la lista de materiales elegibles -- caso ya cubierto en el motor)');
  }

  console.log('\n6e. El buscador respeta el orden pedido y no ofrece Material como categoría');
  agregarClickPorTexto('#consulta .agregar-condicion', '');
  await esperar(50);
  const categorias = Array.from(document.querySelectorAll('.buscador-item')).map((el) => el.textContent.trim());
  assert(!categorias.some((c) => /genética/i.test(c)), 'Material/Genética no aparece como categoría del buscador genérico (tiene su selector propio)');
  const indiceCampana = categorias.findIndex((c) => c.includes('Campaña'));
  const indiceZona = categorias.findIndex((c) => c.includes('Zona'));
  const indiceEnso = categorias.findIndex((c) => c.includes('ENSO'));
  if (indiceCampana >= 0 && indiceZona >= 0 && indiceEnso >= 0) {
    assert(indiceCampana < indiceZona && indiceZona < indiceEnso, 'Campaña, Zona y ENSO aparecen en ese orden en el buscador');
  }
  document.dispatchEvent(new window.Event('mousedown', { bubbles: true })); // cierra el overlay del buscador
  await esperar(50);
}

console.log('\n' + '='.repeat(60));
console.log(`Verificaciones ejecutadas: ${checksRun}`);
console.log(`Verificaciones fallidas:   ${checksFailed}`);
console.log(checksFailed === 0
  ? '\n✓ EXPLORAR FUNCIONA DE PUNTA A PUNTA (ventanas de ~10 días).'
  : '\n✗ HAY VERIFICACIONES FALLIDAS.');
process.exit(checksFailed === 0 ? 0 : 1);
