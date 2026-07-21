// ============================================================================
// test/smoke-test-home.mjs
// Verificación de la Home (index.html / home-app.js): la ficha descriptiva
// se calcula en vivo desde la base real (nunca cifras hardcodeadas), los
// enlaces a los tres módulos son correctos (Explorar vive en explorar.html,
// ya que index.html pasó a ser la Home), y no aparece lenguaje prescriptivo.
// Requiere el proyecto servido por HTTP en localhost:8098.
// Se ejecuta con: node test/smoke-test-home.mjs
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

console.log('Preparando DOM (jsdom) y globals de home-app.js...');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
const dom = new JSDOM(html, { url: 'http://localhost:8098/index.html', pretendToBeVisual: true });
const { window } = dom;

global.window = window;
global.document = window.document;

process.chdir(ROOT);
const fetchNativo = fetch;
global.fetch = (url, opts) => (typeof url === 'string' && !url.startsWith('http')
  ? fetchNativo(`http://localhost:8098/${url}`, opts)
  : fetchNativo(url, opts));

await import(path.join(ROOT, 'js', 'home-app.js') + `?t=${Date.now()}`);
await esperar(500);

// ============================================================================
console.log('\n1. Header institucional');
assert(document.querySelector('.header-marca-nombre').textContent === 'CREA COR', 'El header muestra "CREA COR"');
assert(document.querySelector('.header-marca-bajada').textContent === 'Agricultura basada en evidencia', 'La bajada institucional es la exacta pedida');
assert(document.querySelector('.header-producto').textContent === 'AC SOJA 25–26', 'El nombre del producto aparece a la derecha del header');
assert(document.querySelector('.home-header img') !== null, 'El logo de CREA está presente');

console.log('\n2. Hero');
assert(document.querySelector('.hero-titulo').textContent.trim() === 'AC SOJA', 'El título del hero es "AC SOJA"');
assert(document.querySelector('.hero-subtitulo').textContent.trim() === 'Análisis histórico del cultivo de soja', 'El subtítulo del hero es el exacto pedido');
assert(document.querySelector('.hero-aclaracion').textContent.includes('no constituyen predicciones ni recomendaciones agronómicas'), 'La aclaración metodológica del hero está presente');
assert(document.querySelector('.hero-grafico') !== null, 'Existe la composición gráfica abstracta (SVG, no fotografía)');
assert(document.querySelector('.hero-grafico image') === null, 'La composición del hero no incluye ninguna imagen rasterizada (solo SVG)');

console.log('\n3. Bloque "¿Qué querés analizar?" -- tres tarjetas');
const tarjetas = document.querySelectorAll('.tarjeta-modulo');
assert(tarjetas.length === 3, `Hay exactamente 3 tarjetas de módulo (obtenido: ${tarjetas.length})`);
const hrefs = Array.from(tarjetas).map((t) => t.getAttribute('href'));
assert(hrefs.includes('explorar.html'), 'La tarjeta de Explorar apunta a explorar.html (no a index.html, que ahora es la Home)');
assert(hrefs.includes('comparar.html'), 'La tarjeta de Comparar apunta a comparar.html');
assert(hrefs.includes('escenarios.html'), 'La tarjeta de Escenarios apunta a escenarios.html');
const titulosTarjeta = Array.from(tarjetas).map((t) => t.querySelector('.tarjeta-modulo-titulo').textContent);
assert(titulosTarjeta.includes('¿Cómo se comportó históricamente el cultivo?'), 'El título de Explorar es la pregunta exacta pedida');
assert(titulosTarjeta.includes('¿Qué diferencias se observaron entre distintas alternativas?'), 'El título de Comparar es la pregunta exacta pedida');
assert(titulosTarjeta.includes('¿Cómo se comportaron distintas estrategias de manejo?'), 'El título de Escenarios es la pregunta exacta pedida');
assert(titulosTarjeta.every((t) => t.trim().endsWith('?')), 'Los 3 títulos son preguntas (terminan en "?"), no nombres de módulo');

const etiquetasTarjeta = Array.from(tarjetas).map((t) => t.querySelector('.tarjeta-modulo-etiqueta')?.textContent.trim());
assert(etiquetasTarjeta.includes('🔍 Explorar'), 'La etiqueta pequeña de Explorar está presente');
assert(etiquetasTarjeta.includes('⚖️ Comparar'), 'La etiqueta pequeña de Comparar está presente');
assert(etiquetasTarjeta.includes('🧭 Escenarios'), 'La etiqueta pequeña de Escenarios está presente');
assert(Array.from(tarjetas).every((t) => t.querySelector('.tarjeta-modulo-icono') === null), 'Las tarjetas ya NO tienen el ícono superior (eliminado a pedido)');
const colores = Array.from(tarjetas).map((t) => t.style.getPropertyValue('--color-modulo'));
assert(new Set(colores).size === 3, 'Las 3 tarjetas usan colores de acento distintos entre sí');

console.log('\n4. Ficha descriptiva de la base -- calculada en vivo, no hardcodeada');
const camposFicha = ['campanas', 'registros', 'localidades', 'ambientes', 'ciclos'];
camposFicha.forEach((campo) => {
  const el = document.querySelector(`.ficha-valor[data-campo="${campo}"]`);
  assert(el !== null, `Existe el campo de ficha "${campo}"`);
  assert(el && !el.classList.contains('ficha-cargando'), `El campo "${campo}" terminó de cargar (ya no muestra el placeholder)`);
  assert(el && /^[\d.]+$/.test(el.textContent.trim()), `El campo "${campo}" muestra un número real (obtenido: "${el?.textContent}")`);
});
assert(document.querySelector('.ficha-valor[data-campo="registros"]').textContent.trim() === '7.213', 'El total de registros coincide exactamente con el dataset real (7.213)');
assert(document.getElementById('ficha-nota').style.display === 'none', 'Sin error de carga, la nota de fallback permanece oculta');

console.log('\n5. Cómo utilizar la herramienta -- 3 pasos');
const pasos = document.querySelectorAll('.grid-pasos .paso-titulo');
assert(pasos.length === 3, 'Hay exactamente 3 pasos');
const textosPaso = Array.from(pasos).map((p) => p.textContent);
assert(textosPaso.includes('Seleccioná el módulo'), 'Paso 1 correcto');
assert(textosPaso.includes('Definí el contexto'), 'Paso 2 correcto');
assert(textosPaso.includes('Interpretá la evidencia'), 'Paso 3 correcto');

console.log('\n6. Bloque de recursos');
const recursos = document.querySelectorAll('.recurso-item');
assert(recursos.length === 6, `Hay exactamente 6 recursos listados (obtenido: ${recursos.length})`);
const textoRecursos = document.querySelector('.grid-recursos').textContent;
['Metodología', 'Variables disponibles', 'Cobertura de la información', 'Definiciones y glosario', 'Alcances y limitaciones', 'Acerca del proyecto']
  .forEach((r) => assert(textoRecursos.includes(r), `El recurso "${r}" está listado`));

console.log('\n7. Footer institucional');
assert(document.querySelector('.home-footer') !== null, 'El footer institucional está presente');
assert(document.querySelector('.home-footer').textContent.includes('no constituyen predicciones ni recomendaciones agronómicas'), 'El footer repite la aclaración metodológica');

console.log('\n8. Terminología: nada prescriptivo en toda la página');
const textoCompleto = document.body.textContent;
assert(!/mejor opción|estrategia óptima|decisión sugerida|te recomendamos/i.test(textoCompleto), 'No aparece lenguaje prescriptivo en ningún punto de la Home');

console.log('\n9. Elementos nuevos del rediseño (referencia visual)');
assert(document.querySelector('.franja-superior') !== null, 'Existe el filete verde superior');
assert(document.querySelector('.header-acerca') !== null, 'Existe el enlace "Acerca del proyecto" en el header');
assert(document.querySelector('.hero-titulo-acento')?.textContent.trim() === 'SOJA', 'El título del hero tiene "SOJA" en un span de acento (dos tonos)');
assert(document.querySelector('.hero-aclaracion svg') !== null, 'La aclaración del hero tiene un ícono');
assert(document.querySelectorAll('.ficha-icono').length === 0, 'La ficha ya NO tiene íconos (pedido explícito: el número es el protagonista)');
assert(document.querySelectorAll('#ficha-base .ficha-item').length === 5, 'Los 5 ítems de la ficha siguen presentes, solo sin ícono');
assert(document.querySelectorAll('.paso-numero-circulo').length === 3, 'Cada paso tiene su número en un círculo');
assert(document.querySelectorAll('.paso-texto').length === 3, 'Cada paso tiene una descripción, no solo el título');
assert(document.querySelectorAll('.recurso-flecha').length === 6, 'Cada recurso tiene su flecha de navegación');
assert(document.querySelector('.footer-marca img') !== null, 'El footer incluye el logo de CREA');
assert(document.querySelector('.footer-descripcion').textContent.includes('lotes comerciales'), 'El footer incluye la descripción institucional ampliada');

console.log('\n10. Identidad cromática institucional -- colores extraídos del logo oficial, no aproximados');
const cssHome = readFileSync(path.join(ROOT, 'css', 'home.css'), 'utf-8');
assert(cssHome.includes('--crea-green: #009F57'), 'Existe --crea-green con el valor exacto extraído del logo oficial (#009F57)');
assert(cssHome.includes('--crea-yellow: #FEDC00'), 'Existe --crea-yellow con el valor exacto extraído del logo oficial (#FEDC00)');
assert(cssHome.includes('--crea-dark: #1C1C1A'), 'Existe --crea-dark con el valor exacto extraído del logo oficial (#1C1C1A)');
assert(cssHome.includes('--crea-light'), 'Existe --crea-light (variante clara derivada del verde institucional)');
assert(!cssHome.includes('#EA580C') && !cssHome.includes('#16A34A'), 'Ya no quedan los tonos verde/naranja aproximados de antes de esta ronda');
assert(!/color:\s*var\(--crea-yellow\)/.test(cssHome) && !/color:\s*var\(--acento-comparar\)/.test(cssHome.replace(/\/\*[\s\S]*?\*\//g, '')), 'El amarillo institucional nunca se usa como color de texto (ilegible sobre blanco) -- solo como acento decorativo');

console.log('\n11. Los recursos enlazan a contenido real (recursos.html), ya no son "próximamente"');
const recursoLinks = document.querySelectorAll('.recurso-item');
assert(recursoLinks.length === 6, 'Siguen siendo 6 recursos');
assert(Array.from(recursoLinks).every((a) => a.tagName === 'A'), 'Cada recurso es ahora un enlace real (<a>), no un <div> decorativo');
const hrefsRecursos = Array.from(recursoLinks).map((a) => a.getAttribute('href'));
['recursos.html#metodologia', 'recursos.html#variables-disponibles', 'recursos.html#cobertura-de-la-informacion', 'recursos.html#definiciones-y-glosario', 'recursos.html#alcances-y-limitaciones', 'recursos.html#acerca-del-proyecto']
  .forEach((href) => assert(hrefsRecursos.includes(href), `Existe el enlace a "${href}"`));
assert(document.getElementById('recursos').querySelector('.seccion-copete').textContent.trim() === 'Documentación de referencia del proyecto.', 'El copete ya no dice "disponible próximamente"');
assert(document.querySelector('.header-acerca').getAttribute('href') === 'recursos.html#acerca-del-proyecto', 'El link "Acerca del proyecto" del header apunta a la sección real');

console.log('\n12. Contenido de recursos.html');
const htmlRecursos = readFileSync(path.join(ROOT, 'recursos.html'), 'utf-8');
const domRecursos = new JSDOM(htmlRecursos);
const docRecursos = domRecursos.window.document;
['metodologia', 'variables-disponibles', 'cobertura-de-la-informacion', 'definiciones-y-glosario', 'alcances-y-limitaciones', 'acerca-del-proyecto']
  .forEach((id) => assert(docRecursos.getElementById(id) !== null, `Existe la sección #${id}`));
assert(docRecursos.querySelectorAll('.tabla-glosario tbody tr').length === 11, 'La tabla de glosario tiene las 11 filas de términos provistas');
assert(docRecursos.body.textContent.includes('no establece relaciones de causalidad'), 'El texto de "Alcances y limitaciones" está presente tal como se entregó');
assert(docRecursos.body.textContent.includes('Equipo técnico de Mesa Agrícola de CREA COR'), 'El texto de "Acerca del proyecto" está presente tal como se entregó');
assert(docRecursos.querySelectorAll('.grupo-variable').length === 3, 'Los 3 grupos de variables (Ambiente, Manejo, Resultados productivos) están presentes');

console.log('\n' + '='.repeat(60));
console.log(`Verificaciones ejecutadas: ${checksRun}`);
console.log(`Verificaciones fallidas:   ${checksFailed}`);
console.log(checksFailed === 0
  ? '\n✓ LA HOME FUNCIONA CORRECTAMENTE Y RESPETA LA TERMINOLOGÍA DESCRIPTIVA DEL PRODUCTO.'
  : '\n✗ HAY VERIFICACIONES FALLIDAS.');
process.exit(checksFailed === 0 ? 0 : 1);
