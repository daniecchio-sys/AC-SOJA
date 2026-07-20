// ============================================================================
// test/smoke-test-comparar.mjs
// Prueba de humo del módulo COMPARAR -- reorganización visual: título
// estable, tarjeta de universo, tarjetas de grupo (reemplazan pills +
// leyenda duplicada), hover sincronizado, toggle de bandas P25-P75,
// indicadores comparativos como tarjetas. Ningún cálculo cambió.
// Requiere el proyecto servido por HTTP en localhost:8098.
// Se ejecuta con: node test/smoke-test-comparar.mjs
// ============================================================================

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let checksRun = 0;
let checksFailed = 0;
function assert(cond, msg) {
  checksRun++;
  if (!cond) { checksFailed++; console.error(`  ✗ FALLÓ: ${msg}`); }
  else console.log(`  ✓ ${msg}`);
}
function esperar(ms) { return new Promise((res) => setTimeout(res, ms)); }

const plotlyLlamadas = [];
const restyleLlamadas = [];
const plotlyFalso = {
  react(containerId, traces, layout) {
    plotlyLlamadas.push({ containerId, traces, layout });
  },
  restyle(containerId, update, indices) {
    restyleLlamadas.push({ containerId, update, indices });
  },
};

console.log('Preparando DOM (jsdom) y globals de comparar-app.js...');

const htmlPath = path.join(ROOT, 'comparar-prueba-10dias.html');
const html = readFileSync(htmlPath, 'utf-8');
const dom = new JSDOM(html, { url: 'http://localhost:8098/comparar-prueba-10dias.html', pretendToBeVisual: true });
const { window } = dom;

global.window = window;
global.document = window.document;
global.Event = window.Event;
global.HTMLElement = window.HTMLElement;
global.Plotly = plotlyFalso;

// El gráfico real (Plotly de verdad) agrega .on()/.removeAllListeners() al
// div del contenedor. Se simula acá para poder ejercitar el hover
// sincronizado sin un navegador de verdad.
const graficoEl = window.document.getElementById('grafico-comparativo');
graficoEl.on = (evento, cb) => { graficoEl._listeners = graficoEl._listeners || {}; graficoEl._listeners[evento] = cb; };
graficoEl.removeAllListeners = () => {};

process.chdir(ROOT);
const fetchNativo = fetch;
global.fetch = (url, opts) => (typeof url === 'string' && !url.startsWith('http')
  ? fetchNativo(`http://localhost:8098/${url}`, opts)
  : fetchNativo(url, opts));

await import(path.join(ROOT, 'js', 'comparar-app-prueba-10dias.js') + `?t=${Date.now()}`);
await esperar(500);

function ultimoRender() { return plotlyLlamadas[plotlyLlamadas.length - 1]; }
function ultimoRenderGrafico() { return plotlyLlamadas.filter((c) => c.containerId === 'grafico-comparativo').pop(); }
function ultimoRenderHistograma() { return plotlyLlamadas.filter((c) => c.containerId === 'histograma-comparativo').pop(); }
function tarjetasDeGrupo() { return document.querySelectorAll('#fila-grupos .grupo-tarjeta'); }

// ============================================================================
console.log('\n1. Título estable e identidad propia del módulo');
assert(document.querySelector('.comparar-titulo-estable').textContent.trim() === '¿Qué diferencias aparecen entre distintos grupos según la fecha de siembra?', 'El título es fijo, con el texto exacto pedido');
assert(!document.querySelector('.comparar-titulo-estable').textContent.includes('Comparando'), 'El título NO usa la construcción "Comparando X dentro de..."');
assert(document.getElementById('contexto-corto').textContent === 'Contexto: Toda la red', 'Sin condiciones, el resumen de contexto dice "Toda la red"');
assert(document.getElementById('comparando-corto').textContent.startsWith('Comparando por:'), 'El resumen de variable dice "Comparando por: ..."');

// ============================================================================
console.log('\n2. Constructor de comparación');
assert(document.getElementById('contexto-oracion').textContent.length > 0, 'El constructor de contexto se renderizó');
assert(document.getElementById('select-variable').options.length === 7, 'El selector de variable de agrupamiento tiene las 7 opciones permitidas');
assert(document.querySelector('#contexto-oracion .agregar-condicion') !== null, 'El botón "+ agregar condición" está presente (reutilizado tal cual de query-builder.js)');

// ============================================================================
console.log('\n3. Tarjeta resumen del universo');
const tarjetaUniverso = document.getElementById('tarjeta-universo');
assert(tarjetaUniverso.querySelector('.indicador-titulo').textContent === 'Universo analizado', 'La tarjeta de universo tiene el título correcto');
assert(/\d/.test(tarjetaUniverso.querySelector('.indicador-valor').textContent), 'La tarjeta de universo muestra un número de observaciones');
assert(tarjetaUniverso.querySelector('.indicador-subtitulo').textContent.startsWith('Comparando por:'), 'La tarjeta de universo repite la variable activa (no los grupos -- esos van aparte)');

// ============================================================================
console.log('\n4. Tarjetas de grupo (reemplazan el pill de una sola línea)');
const tarjetasIniciales = tarjetasDeGrupo();
assert(tarjetasIniciales.length > 0 && tarjetasIniciales.length <= 4, `Se renderizaron entre 1 y 4 tarjetas de grupo (obtenido: ${tarjetasIniciales.length})`);
assert(tarjetasIniciales[0].querySelector('.grupo-tarjeta-nombre') !== null, 'Cada tarjeta tiene un nombre en su propia línea');
assert(tarjetasIniciales[0].querySelector('.grupo-tarjeta-n').textContent.endsWith(' lotes'), 'Cada tarjeta muestra "X lotes" en una línea separada (no "1 • n=...")');
assert(document.querySelectorAll('.leyenda-n-grupos').length === 0, 'No existe una leyenda redundante aparte de las tarjetas de grupo (Sección 3)');

console.log('\n4b. Gráfico principal');
assert(plotlyLlamadas.length > 0, 'Se llamó a Plotly.react al menos una vez');
const trazasMediana = ultimoRenderGrafico().traces.filter((t) => t.name && t.name.includes('n='));
assert(trazasMediana.length === tarjetasIniciales.length, 'Hay una traza de mediana por cada tarjeta de grupo activa');
assert(ultimoRenderHistograma() !== undefined && ultimoRenderHistograma().traces.some((t) => t.type === 'bar'), 'El histograma independiente incluye la traza de barras');
assert(ultimoRenderGrafico().traces.some((t) => t.hovertemplate === '%{customdata}<extra></extra>'), 'Existe la traza-ancla del hover tabular unificado');
assert(trazasMediana.every((t) => t.line.width === 2.5), 'Las líneas de mediana tienen mayor protagonismo (grosor 2.5, antes 2)');
assert(ultimoRenderGrafico().layout.showlegend === false, 'La leyenda nativa de Plotly está desactivada (las tarjetas la reemplazan)');

// ============================================================================
console.log('\n5. Hover sincronizado (tarjeta de grupo -> gráfico)');
tarjetasDeGrupo()[0].dispatchEvent(new window.Event('mouseenter', { bubbles: true }));
await esperar(20);
assert(restyleLlamadas.length > 0, 'Pasar el mouse sobre una tarjeta de grupo llamó a Plotly.restyle (resaltado)');
if (restyleLlamadas.length > 0) {
  const ultimaRestyle = restyleLlamadas[restyleLlamadas.length - 1];
  assert(ultimaRestyle.update.opacity.some((o) => o < 1), 'El resaltado atenúa la opacidad de al menos una traza (los demás grupos)');
}
assert(tarjetasDeGrupo()[0].classList.contains('grupo-tarjeta-resaltada'), 'La tarjeta bajo el mouse recibe la clase de resaltado');
tarjetasDeGrupo()[0].dispatchEvent(new window.Event('mouseleave', { bubbles: true }));
await esperar(20);
assert(!tarjetasDeGrupo()[0].classList.contains('grupo-tarjeta-resaltada'), 'Al sacar el mouse, se quita el resaltado');

console.log('\n5b. Hover sincronizado (gráfico -> tarjeta de grupo)');
if (graficoEl._listeners && graficoEl._listeners['plotly_hover']) {
  const trazaConLegendgroup = ultimoRenderGrafico().traces.find((t) => t.legendgroup);
  graficoEl._listeners['plotly_hover']({ points: [{ data: trazaConLegendgroup }] });
  await esperar(20);
  assert(document.querySelector('.grupo-tarjeta-resaltada') !== null, 'Pasar el mouse sobre una curva del gráfico resalta la tarjeta de grupo correspondiente');
  graficoEl._listeners['plotly_unhover']();
}

// ============================================================================
console.log('\n6. Toggle "Mostrar bandas P25-P75"');
const toggleBandas = document.getElementById('toggle-bandas');
assert(toggleBandas.checked === true, 'El toggle empieza marcado (bandas visibles por defecto)');
const trazasConBandaAntes = ultimoRenderGrafico().traces.filter((t) => t.fill === 'tonexty').length;
assert(trazasConBandaAntes > 0, 'Con el toggle activado, existen trazas de banda (fill:tonexty)');
toggleBandas.checked = false;
toggleBandas.dispatchEvent(new window.Event('change', { bubbles: true }));
await esperar(20);
const trazasConBandaDespues = ultimoRenderGrafico().traces.filter((t) => t.fill === 'tonexty').length;
assert(trazasConBandaDespues === 0, 'Al desactivar el toggle, no se dibuja ninguna traza de banda');
const trazasMedianaTrasOcultar = ultimoRenderGrafico().traces.filter((t) => t.name && t.name.includes('n='));
assert(trazasMedianaTrasOcultar.length === tarjetasIniciales.length, 'Las medianas se conservan aunque se oculten las bandas');
toggleBandas.checked = true;
toggleBandas.dispatchEvent(new window.Event('change', { bubbles: true }));
await esperar(20);

// ============================================================================
console.log('\n7. Banda de frecuencia: título + tooltip nativo');
const frecuenciaTitulo = document.querySelector('.frecuencia-titulo');
assert(frecuenciaTitulo.textContent === 'Frecuencia de observaciones', 'El título de la banda de frecuencia está presente');
assert(frecuenciaTitulo.getAttribute('title') === 'Cantidad de lotes utilizados para calcular cada ventana.', 'El tooltip nativo tiene el texto exacto pedido');

// ============================================================================
console.log('\n8. Clic en la tarjeta alterna visibilidad (ya no quita el grupo)');
const nGruposAntesDeClic = tarjetasDeGrupo().length;
const primeraNoOculta = Array.from(tarjetasDeGrupo()).find((t) => !t.classList.contains('grupo-tarjeta-oculta'));
primeraNoOculta.dispatchEvent(new window.Event('click', { bubbles: true }));
await esperar(50);
assert(tarjetasDeGrupo().length === nGruposAntesDeClic, 'Clic en el cuerpo de la tarjeta NO quita el grupo (misma cantidad de tarjetas)');
assert(document.querySelector(`.grupo-tarjeta[data-grupo-valor="${primeraNoOculta.getAttribute('data-grupo-valor')}"]`).classList.contains('grupo-tarjeta-oculta'), 'El clic marca la tarjeta como oculta (alterna visibilidad)');
primeraNoOculta.dispatchEvent(new window.Event('click', { bubbles: true })); // la vuelve a mostrar
await esperar(50);

console.log('\n8b. Botón × quita el grupo de la comparación');
const nGruposAntes = tarjetasDeGrupo().length;
tarjetasDeGrupo()[0].querySelector('.grupo-tarjeta-quitar').dispatchEvent(new window.Event('click', { bubbles: true }));
await esperar(50);
const nGruposDespues = tarjetasDeGrupo().length;
assert(nGruposDespues === nGruposAntes - 1, `El botón × quita el grupo (antes=${nGruposAntes}, después=${nGruposDespues})`);
assert(document.querySelector('#fila-grupos .agregar-grupo') !== null, 'Con lugar libre, aparece la acción "+ agregar grupo"');

// ============================================================================
console.log('\n9. Cambiar la variable de agrupamiento reinicia la selección');
const select = document.getElementById('select-variable');
const otraVariable = Array.from(select.options).map((o) => o.value).find((v) => v !== select.value);
select.value = otraVariable;
select.dispatchEvent(new window.Event('change', { bubbles: true }));
await esperar(50);
const tarjetasTrasCambio = tarjetasDeGrupo();
assert(tarjetasTrasCambio.length > 0 && tarjetasTrasCambio.length <= 4, `Cambiar la variable repobló automáticamente los grupos (obtenido: ${tarjetasTrasCambio.length})`);
assert(document.getElementById('comparando-corto').textContent.includes(document.querySelector('#select-variable option:checked').textContent), 'El resumen "Comparando por" refleja la nueva variable');

// ============================================================================
console.log('\n10. Indicadores comparativos, como tarjetas (mismo lenguaje visual que Escenarios)');
const tarjetasKpi = document.querySelectorAll('#grid-indicadores-comparativos .kpi-destacado');
assert(tarjetasKpi.length === 2, `Hay exactamente 2 indicadores comparativos, sin métricas nuevas (obtenido: ${tarjetasKpi.length})`);
const titulosKpi = Array.from(tarjetasKpi).map((c) => c.querySelector('.kpi-destacado-titulo').textContent);
assert(titulosKpi.includes('Mayor diferencia de mediana'), 'Existe el indicador "Mayor diferencia de mediana"');
assert(titulosKpi.includes('Mayor diferencia de piso productivo'), 'Existe el indicador "Mayor diferencia de piso productivo"');
const textoIndicadores = document.getElementById('grid-indicadores-comparativos').textContent;
assert(!/mejor|más conveniente|recomendado|estrategia óptima/i.test(textoIndicadores), 'Los indicadores no usan lenguaje evaluativo prohibido');

console.log('\n10b. Bloque descriptivo reemplazado por aclaraciones metodológicas de menor jerarquía');
const textoAclaraciones = document.querySelector('.aclaraciones-metodologicas').textContent;
assert(textoAclaraciones.includes('n ≥ 20'), 'Las aclaraciones mencionan el umbral n≥20');
assert(textoAclaraciones.includes('No representan recomendaciones ni predicciones'), 'Las aclaraciones incluyen el texto metodológico permanente');
assert(document.querySelector('.bloque-respuesta') === null, 'El párrafo descriptivo antiguo ya no existe como bloque aparte');

// ============================================================================
console.log('\n11. Tabla de valores exactos (ventana × grupo)');
const filasTabla = document.querySelectorAll('#tabla-comparar-body tr');
assert(filasTabla.length > 0, 'La tabla de valores exactos tiene al menos una fila');
if (filasTabla.length > 0) {
  const celdas = filasTabla[0].querySelectorAll('td');
  assert(celdas.length === 6, 'Cada fila tiene 6 columnas: Ventana, Grupo, n, P25, Mediana, P75');
}

console.log('\n12. Eje X: sombreado por mes (Sección 7) presente en gráfico e histograma');
assert(ultimoRenderGrafico().layout.shapes.some((s) => s.type === 'rect'), 'El gráfico principal tiene franjas de sombreado por mes');
assert(ultimoRenderHistograma().layout.shapes.some((s) => s.type === 'rect'), 'El histograma también tiene el mismo sombreado por mes (mismo eje X)');
const ticksGrafico = ultimoRenderGrafico().layout.xaxis.tickvals;
const ticksHistograma = ultimoRenderHistograma().layout.xaxis.tickvals;
assert(JSON.stringify(ticksGrafico) === JSON.stringify(ticksHistograma), 'El gráfico y el histograma comparten exactamente los mismos ticks de mes en el eje X');

console.log('\n13. La interfaz se adapta a 2 grupos, no asume siempre 4 (Sección 11)');
while (tarjetasDeGrupo().length > 2) {
  tarjetasDeGrupo()[0].querySelector('.grupo-tarjeta-quitar').dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(30);
}
assert(tarjetasDeGrupo().length === 2, 'Se pudo bajar a exactamente 2 grupos sin errores');
assert(ultimoRenderGrafico().traces.filter((t) => t.name && t.name.includes('n=')).length === 2, 'Con 2 grupos, el gráfico dibuja exactamente 2 medianas (no asume 4)');
assert(document.getElementById('tarjeta-universo').querySelector('.indicador-subtitulo').textContent.includes('2 grupos'), 'La tarjeta de universo refleja "2 grupos" correctamente');

console.log('\n' + '='.repeat(60));
console.log(`Verificaciones ejecutadas: ${checksRun}`);
console.log(`Verificaciones fallidas:   ${checksFailed}`);
console.log(checksFailed === 0
  ? '\n✓ LA REORGANIZACIÓN VISUAL DE COMPARAR FUNCIONA DE PUNTA A PUNTA.'
  : '\n✗ HAY VERIFICACIONES FALLIDAS.');
process.exit(checksFailed === 0 ? 0 : 1);
