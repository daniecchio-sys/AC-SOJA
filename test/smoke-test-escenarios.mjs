// ============================================================================
// test/smoke-test-escenarios.mjs
// Prueba integral del módulo ESCENARIOS -- arquitectura v2
// (AC_SOJA_25_26_Arquitectura_Funcional_Escenarios_v2.md). Reemplaza la
// versión anterior (gráfico de serie temporal + KPIs clásicos, ya
// eliminados). Cubre: estados de n, heatmap, ranking, lotes superados,
// mensajes, historial, navegación.
// Requiere el proyecto servido por HTTP en localhost:8098.
// Se ejecuta con: node test/smoke-test-escenarios.mjs
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
const plotlyFalso = { react(containerId, traces, layout) { plotlyLlamadas.push({ containerId, traces, layout }); } };

console.log('Preparando DOM (jsdom) y globals de escenario-app.js...');
const html = readFileSync(path.join(ROOT, 'escenarios.html'), 'utf-8');
const dom = new JSDOM(html, { url: 'http://localhost:8098/escenarios.html', pretendToBeVisual: true });
const { window } = dom;

global.window = window;
global.document = window.document;
global.Event = window.Event;
global.HTMLElement = window.HTMLElement;
global.Plotly = plotlyFalso;

process.chdir(ROOT);
const fetchNativo = fetch;
global.fetch = (url, opts) => (typeof url === 'string' && !url.startsWith('http')
  ? fetchNativo(`http://localhost:8098/${url}`, opts)
  : fetchNativo(url, opts));

await import(path.join(ROOT, 'js', 'escenario-app.js') + `?t=${Date.now()}`);
await esperar(500);

function textoOracion() { return document.getElementById('escenario-oracion').textContent; }
function agregarClickPorTexto(selector, textoIncluido) {
  const item = Array.from(document.querySelectorAll(selector)).find((el) => el.textContent.includes(textoIncluido));
  if (item) item.dispatchEvent(new window.Event('click', { bubbles: true }));
  return item;
}

// ============================================================================
console.log('\n1. Estados de n -- "sin escenario" (sin condiciones)');
assert(textoOracion().startsWith('¿Qué ocurrió históricamente'), 'La oración usa la pregunta raíz propia de Escenarios');
assert(document.querySelector('.escenario-sin-condiciones') !== null, 'Nota "Sin condiciones aplicadas — toda la red." visible');
assert(document.getElementById('area-analisis').style.display !== 'none', 'Con el universo completo (miles de obs.), el área de análisis está visible');
assert(document.getElementById('tarjeta-escenario-contenido').innerHTML.trim() === '', 'Sin condiciones, la tarjeta de ambiente NO muestra contenido');

console.log('\n1b. El buscador de categorías solo ofrece las 7 variables permitidas (Sección 4)');
document.querySelector('#escenario-oracion .agregar-condicion').dispatchEvent(new window.Event('click', { bubbles: true }));
await esperar(50);
const categoriasOfrecidas = Array.from(document.querySelectorAll('.buscador-item')).map((li) => li.textContent);
assert(categoriasOfrecidas.length === 7, `El buscador muestra exactamente 7 categorías (obtenido: ${categoriasOfrecidas.length}: ${categoriasOfrecidas.join(', ')})`);
assert(categoriasOfrecidas.some((t) => /Departamento/i.test(t)), 'Departamento está entre las categorías ofrecidas (lista actualizada)');
assert(!categoriasOfrecidas.some((t) => /^Ciclo$/i.test(t.trim())), 'Ciclo ya NO aparece como categoría del buscador (lista actualizada)');
assert(!categoriasOfrecidas.some((t) => /Localidad|Genética|Superficie/i.test(t)), 'No aparecen Localidad, Genética ni Superficie (variables explícitamente excluidas)');
document.dispatchEvent(new window.Event('mousedown', { bubbles: true })); // cierra el overlay del buscador
await esperar(50);

console.log('\n1c. Título estable (Sección 1/2) -- ya no depende de las condiciones activas');
assert(document.querySelector('.escenarios-titulo-estable').textContent.trim() === '¿Qué estrategias de fecha de siembra y ciclo mostraron distintos comportamientos bajo este ambiente?', 'El título es fijo, con el texto exacto pedido');
assert(document.querySelector('.escenarios-titulo-aclaracion').textContent.includes('Una estrategia corresponde a una combinación de fecha de siembra y ciclo'), 'La aclaración de "estrategia" está presente');
const tituloAntesDeCondicion = document.querySelector('.escenarios-titulo-estable').textContent.trim();

console.log('\n2. Agregar condición real (Zona 4) -- tarjeta, heatmap, ranking, lotes superados aparecen');
document.querySelector('#escenario-oracion .agregar-condicion').dispatchEvent(new window.Event('click', { bubbles: true }));
await esperar(50);
agregarClickPorTexto('.buscador-item', 'Zona');
await esperar(50);
agregarClickPorTexto('.buscador-item', '4');
await esperar(50);

assert(textoOracion().includes('en Zona 4'), 'La oración incorpora "en Zona 4"');
assert(document.getElementById('tarjeta-escenario-contenido').innerHTML.trim() !== '', 'La tarjeta de ambiente muestra contenido (Zona 4 sola supera el umbral)');
assert(document.querySelector('.tarjeta-item').textContent.includes('Zona:'), 'La tarjeta muestra "Zona:"');
assert(document.querySelector('.escenarios-titulo-estable').textContent.trim() === tituloAntesDeCondicion, 'El título estable no cambió al agregar una condición');
assert(!document.querySelector('.escenarios-titulo-estable').textContent.includes('Zona'), 'El título nunca menciona las condiciones activas (viven en la tarjeta, Sección 2)');

console.log('\n3. Heatmap muestra siempre las 11 ventanas completas (sin deslizador, sin recorte)');
assert(plotlyLlamadas.length >= 2, 'Se llamó a Plotly.react para el heatmap (traza de alerta + traza principal)');
const ultimaLlamadaHeatmap = plotlyLlamadas.filter((c) => c.containerId === 'grafico-heatmap').pop();
assert(ultimaLlamadaHeatmap !== undefined, 'Existe al menos una llamada dirigida al contenedor del heatmap');
if (ultimaLlamadaHeatmap) {
  const trazaPrincipal = ultimaLlamadaHeatmap.traces[1];
  assert(trazaPrincipal.type === 'heatmap', 'La traza principal es de tipo heatmap');
  assert(trazaPrincipal.y.length === 4, 'Por defecto se muestran las 4 filas de ciclos frecuentes (sin expandir eventuales)');
  assert(trazaPrincipal.x.length === 11, `El heatmap muestra las 11 ventanas completas, sin recorte (obtenido: ${trazaPrincipal.x.length})`);
}
assert(document.getElementById('rango-fecha-desde') === null, 'El control deslizable de rango de fecha no existe en esta variante');

console.log('\n4. Expandir ciclos eventuales cambia el heatmap');
const nFilasAntes = plotlyLlamadas.filter((c) => c.containerId === 'grafico-heatmap').pop().traces[1].y.length;
document.getElementById('toggle-ciclos-eventuales').dispatchEvent(new window.Event('click', { bubbles: true }));
await esperar(50);
const nFilasDespues = plotlyLlamadas.filter((c) => c.containerId === 'grafico-heatmap').pop().traces[1].y.length;
assert(nFilasDespues > nFilasAntes, `Expandir ciclos eventuales agrega filas al heatmap (antes=${nFilasAntes}, después=${nFilasDespues})`);
assert(document.getElementById('toggle-ciclos-eventuales').textContent === 'Mostrar menos ciclos', 'El botón cambia a "Mostrar menos ciclos" al expandir');
document.getElementById('toggle-ciclos-eventuales').dispatchEvent(new window.Event('click', { bubbles: true }));
await esperar(50);

console.log('\n6. Ranking de combinaciones');
const filasRanking = document.querySelectorAll('.tabla-ranking tbody tr');
assert(filasRanking.length > 0, 'El ranking tiene al menos una fila');
assert(filasRanking.length <= 10, 'El ranking muestra como máximo 10 filas por defecto');
assert(document.getElementById('ranking-priorizar-select') !== null, 'El selector "Priorizar según" está presente');
assert(document.getElementById('ranking-priorizar-select').value === 'mediana', 'El criterio inicial es Mediana');
assert(document.querySelector('.ranking-mensaje-dinamico').textContent === 'Las combinaciones con mayor mediana aparecen primero.', 'El mensaje dinámico corresponde al criterio Mediana');

console.log('\n6b. Gráfico de dispersión (mediana × dispersión relativa)');
const llamadaDispersion = plotlyLlamadas.filter((c) => c.containerId === 'grafico-dispersion').pop();
assert(llamadaDispersion !== undefined, 'Se llamó a Plotly.react para el gráfico de dispersión');
if (llamadaDispersion) {
  const totalPuntos = llamadaDispersion.traces.reduce((acc, t) => acc + t.x.length, 0);
  assert(totalPuntos === filasRanking.length || totalPuntos === document.querySelectorAll('.tabla-ranking tbody tr').length || totalPuntos > 0, `El gráfico tiene puntos (obtenido: ${totalPuntos})`);
  assert(llamadaDispersion.traces.every((t) => t.type === 'scatter' && t.mode === 'markers'), 'Todas las trazas son scatter de puntos (sin líneas)');
  assert(llamadaDispersion.traces.every((t) => Array.isArray(t.marker.size)), 'El tamaño de los puntos varía (viene de un array, no de un valor fijo)');
  const nombresDeTraza = llamadaDispersion.traces.map((t) => t.name);
  assert(new Set(nombresDeTraza).size === nombresDeTraza.length, 'Hay una traza por cada ciclo distinto (nombres únicos, una por categoría)');
  assert(llamadaDispersion.layout.shapes.length === 2, 'Se dibujan las 2 líneas de referencia (mediana de medianas + mediana de dispersiones)');
  assert(llamadaDispersion.layout.xaxis.title.text.includes('Mediana de rendimiento'), 'El eje X está etiquetado como mediana de rendimiento');
  assert(llamadaDispersion.layout.yaxis.title.text.includes('Dispersión relativa'), 'El eje Y está etiquetado como dispersión relativa');
}
const textoCaption = document.querySelector('.dispersion-caption').textContent;
const textoCaptionSecundaria = document.querySelector('.dispersion-caption-secundaria').textContent;
assert(!/mejor estrategia|zona óptima|estrategia óptima|estrategia recomendada/i.test(textoCaption + textoCaptionSecundaria), 'El texto explicativo no usa lenguaje evaluativo prohibido (mejor estrategia / zona óptima / estrategia recomendada)');
assert(textoCaptionSecundaria.includes('no representan umbrales agronómicos'), 'La aclaración secundaria deja explícito que las líneas no son umbrales');
if (llamadaDispersion) {
  const tamañosTodos = llamadaDispersion.traces.flatMap((t) => t.marker.size);
  assert(Math.max(...tamañosTodos) <= 28 && Math.min(...tamañosTodos) >= 8, `El rango de tamaños de burbuja quedó entre 8 y 28px (obtenido: ${Math.min(...tamañosTodos).toFixed(1)}-${Math.max(...tamañosTodos).toFixed(1)})`);
  assert(llamadaDispersion.traces.every((t) => t.cliponaxis === false), 'Las burbujas no se recortan en el borde del área de trazado (cliponaxis:false)');
  assert(llamadaDispersion.layout.margin.l === 88, 'El margen izquierdo se amplió para que el título del eje Y respire');
}

console.log('\n7. Cambiar criterio de priorización reordena el ranking');
const primeraFilaAntes = filasRanking[0]?.textContent;
const select = document.getElementById('ranking-priorizar-select');
select.value = 'dispersionRelativa';
select.dispatchEvent(new window.Event('change', { bubbles: true }));
await esperar(50);
assert(document.querySelector('.ranking-mensaje-dinamico').textContent === 'Las combinaciones con menor dispersión relativa aparecen primero.', 'El mensaje dinámico cambia con el criterio');
const primeraFilaDespues = document.querySelector('.tabla-ranking tbody tr')?.textContent;
console.log(`  (primera fila antes/después del cambio de criterio: ${primeraFilaAntes === primeraFilaDespues ? 'igual (esperable con pocas combinaciones)' : 'cambió'})`);
select.value = 'mediana';
select.dispatchEvent(new window.Event('change', { bubbles: true }));
await esperar(50);

console.log('\n8. Expandir/contraer el ranking completo');
const botonExpandir = document.querySelector('.ranking-expandir');
if (botonExpandir) {
  const totalEnBoton = botonExpandir.textContent.match(/\((\d+)\)/)?.[1];
  botonExpandir.dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  const filasExpandidas = document.querySelectorAll('.tabla-ranking tbody tr').length;
  assert(String(filasExpandidas) === totalEnBoton, `Expandir muestra exactamente las ${totalEnBoton} combinaciones elegibles (obtenido: ${filasExpandidas})`);
  assert(document.querySelector('.ranking-expandir').textContent === 'Mostrar menos', 'El botón cambia a "Mostrar menos"');
  document.querySelector('.ranking-expandir').dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  assert(document.querySelectorAll('.tabla-ranking tbody tr').length <= 10, 'Contraer vuelve a mostrar como máximo 10 filas');
} else {
  console.log('  (este escenario tiene 10 o menos combinaciones elegibles -- no hay botón de expandir, comportamiento correcto)');
}

console.log('\n9. Lotes registrados que superaron -- ahora en fila horizontal');
const filasLotes = document.querySelectorAll('.lote-superado-item');
assert(filasLotes.length === 3, 'Se muestran los 3 umbrales (3.000/4.000/5.000)');
assert(filasLotes[0].textContent.includes('Más de'), 'La etiqueta usa "Más de X.000 kg/ha" (Sección 7)');
assert(document.getElementById('lotes-superados-base').textContent.includes('lotes registrados del escenario'), 'Se muestra la base utilizada para calcular los porcentajes, en una nota separada');

console.log('\n10. Indicadores destacados (reemplaza "¿Qué muestran estos datos?" como elemento principal)');
assert(document.getElementById('respuesta-toggle') === null, 'El bloque "¿Qué muestran estos datos?" ya no existe como elemento principal');
assert(document.getElementById('mensaje-metodologico') === null, 'El mensaje metodológico standalone ya no existe (se fusionó en las aclaraciones)');
const tarjetasKpi = document.querySelectorAll('.kpi-destacado');
assert(tarjetasKpi.length === 5, `Hay 5 indicadores destacados (4 del mínimo pedido + potencial P75, obtenido: ${tarjetasKpi.length})`);
const titulosKpi = Array.from(tarjetasKpi).map((c) => c.querySelector('.kpi-destacado-titulo').textContent);
['Mayor mediana observada', 'Mayor piso productivo (P25)', 'Mayor potencial observado (P75)', 'Menor dispersión relativa', 'Mayor respaldo histórico (n)'].forEach((esperado) => {
  assert(titulosKpi.includes(esperado), `Existe el indicador "${esperado}"`);
});
assert(Array.from(tarjetasKpi).every((c) => c.querySelector('.kpi-destacado-valor') !== null || c.querySelector('.kpi-destacado-vacio') !== null), 'Cada indicador muestra un valor o el mensaje de evidencia insuficiente, nunca ninguno de los dos');
const detalleKpi = tarjetasKpi[0].querySelector('.kpi-destacado-detalle');
if (detalleKpi) assert(/\d/.test(detalleKpi.textContent) && detalleKpi.textContent.includes('·'), 'El detalle del indicador muestra fecha de siembra y ciclo juntos');
const textoAclaraciones = document.querySelector('.aclaraciones-metodologicas').textContent;
assert(textoAclaraciones.includes('n ≥ 20') || textoAclaraciones.includes('n\u00A0≥\u00A020'), 'Las aclaraciones mencionan el umbral n≥20');
assert(textoAclaraciones.includes('No constituyen una predicción'), 'Las aclaraciones incluyen el texto metodológico permanente');
assert(!/mejor estrategia|estrategia óptima|mejor rendimiento|\btop\b/i.test(titulosKpi.join(' ') + textoAclaraciones), 'No aparece lenguaje evaluativo prohibido en los indicadores ni en las aclaraciones');

console.log('\n10b. Orden y agrupación (esta ronda de reorganización)');
{
  const kpisSection = document.querySelector('.bloque-kpis-destacados');
  const rankingSection = document.getElementById('bloque-ranking');
  const posicionKpis = Array.from(document.querySelectorAll('#area-analisis > *')).indexOf(kpisSection);
  const posicionRanking = Array.from(document.querySelectorAll('#area-analisis > *')).indexOf(rankingSection);
  assert(posicionKpis >= 0 && posicionRanking >= 0 && posicionKpis < posicionRanking, 'Indicadores destacados aparece inmediatamente antes del bloque de ranking');
  assert(document.getElementById('tarjeta-ambiente').parentElement === document.getElementById('bloque-lotes-superados').parentElement, 'La tarjeta de ambiente y lotes registrados que superaron comparten el mismo contenedor (misma fila)');
  assert(document.getElementById('tarjeta-ambiente').parentElement.className === 'fila-resumen-y-lotes', 'El contenedor compartido es la fila de resumen y lotes');
}

// ============================================================================
console.log('\n11. Estado "menos de 50" bloquea toda el área (heatmap, ranking, lotes, tarjeta)');
{
  document.querySelector('#escenario-oracion .agregar-condicion').dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  agregarClickPorTexto('.buscador-item', 'Departamento');
  await esperar(50);
  const itemsDepartamento = document.querySelectorAll('.buscador-item');
  if (itemsDepartamento.length > 0 && !itemsDepartamento[0].className.includes('vacio')) {
    itemsDepartamento[itemsDepartamento.length - 1].dispatchEvent(new window.Event('click', { bubbles: true }));
    await esperar(50);
  }
  const valorActual = document.getElementById('indicador-principal').querySelector('.indicador-valor').textContent;
  const n = parseInt(valorActual.replace(/\./g, ''), 10);
  if (n < 50) {
    assert(document.getElementById('area-analisis').style.display === 'none', 'Por debajo de 50, el área de análisis completa se oculta');
    assert(document.getElementById('bloque-lotes-superados').style.display === 'none', 'Por debajo de 50, el bloque de lotes registrados también se oculta (ya no hereda de #area-analisis)');
    assert(document.getElementById('tarjeta-escenario-contenido').innerHTML.trim() === '', 'Por debajo de 50, la tarjeta de ambiente también queda sin contenido');
    assert(document.getElementById('mensaje-piso-minimo').style.display !== 'none', 'El mensaje de piso mínimo se muestra');
  } else {
    console.log(`  (esta combinación particular dio n=${n}, no bajó de 50 -- caso ya cubierto en engine-test-escenarios.mjs con búsqueda garantizada)`);
  }
}

// ============================================================================
console.log('\n12. Historial: atrás/adelante y navegación entre módulos');
{
  const historialAtras = document.getElementById('historial-atras');
  assert(!historialAtras.disabled, 'Después de varias condiciones agregadas, "atrás" está habilitado');
  let pasos = 0;
  while (!historialAtras.disabled && pasos < 20) {
    historialAtras.dispatchEvent(new window.Event('click', { bubbles: true }));
    await esperar(30);
    pasos++;
  }
  assert(document.querySelector('.escenario-sin-condiciones') !== null, 'Al ir atrás hasta el principio, se vuelve al estado sin condiciones');

  const historialAdelante = document.getElementById('historial-adelante');
  let pasosAdelante = 0;
  while (!historialAdelante.disabled && pasosAdelante < 20) {
    historialAdelante.dispatchEvent(new window.Event('click', { bubbles: true }));
    await esperar(30);
    pasosAdelante++;
  }
  assert(pasosAdelante === pasos, `La cantidad de pasos adelante (${pasosAdelante}) coincide con los pasos atrás (${pasos}) -- ninguna restauración generó una entrada nueva`);

  assert(document.querySelector('nav.historial-nav a[href="explorar.html"]') !== null, 'Existe el enlace de navegación a Explorar');
  assert(document.querySelector('nav.historial-nav a[href="comparar.html"]') !== null, 'Existe el enlace de navegación a Comparar');
}

console.log('\n' + '='.repeat(60));
console.log(`Verificaciones ejecutadas: ${checksRun}`);
console.log(`Verificaciones fallidas:   ${checksFailed}`);
console.log(checksFailed === 0
  ? '\n✓ EL MVP FUNCIONAL COMPLETO DE ESCENARIOS (v2) FUNCIONA DE PUNTA A PUNTA.'
  : '\n✗ HAY VERIFICACIONES FALLIDAS.');
process.exit(checksFailed === 0 ? 0 : 1);
