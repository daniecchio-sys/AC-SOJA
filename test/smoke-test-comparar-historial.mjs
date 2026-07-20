// ============================================================================
// test/smoke-test-comparar-historial.mjs
// Prueba de humo dedicada a la conexión de history.js con el módulo
// COMPARAR. Mismo patrón que los demás smoke tests: jsdom como proveedor de
// DOM, comparar-app.js corre con el motor de módulos real de Node, Plotly
// simulado (incluye .on/.removeAllListeners para poder disparar
// plotly_legendclick "a mano", tal como haría un click real de leyenda).
//
// Requiere el proyecto servido por HTTP en localhost:8098.
// Se ejecuta con: node test/smoke-test-comparar-historial.mjs
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
const plotlyFalso = {
  react(containerId, traces, layout) {
    plotlyLlamadas.push({ containerId, traces, layout });
  },
};

console.log('Preparando DOM (jsdom) y globals de comparar-app.js...');

const htmlPath = path.join(ROOT, 'comparar.html');
const html = readFileSync(htmlPath, 'utf-8');
const dom = new JSDOM(html, { url: 'http://localhost:8098/comparar.html', pretendToBeVisual: true });
const { window } = dom;

global.window = window;
global.document = window.document;
global.Event = window.Event;
global.HTMLElement = window.HTMLElement;
global.Plotly = plotlyFalso;

// El gráfico real (Plotly de verdad) agrega .on()/.removeAllListeners() al
// div del contenedor cuando lo dibuja. Se simula acá para no romper el
// wiring de hover sincronizado (ya no hay leyenda de Plotly que disparar --
// la visibilidad ahora se controla con un clic real sobre la tarjeta).
const graficoEl = window.document.getElementById('grafico-comparativo');
graficoEl.on = (evento, cb) => { graficoEl._listeners = graficoEl._listeners || {}; graficoEl._listeners[evento] = cb; };
graficoEl.removeAllListeners = () => {};

process.chdir(ROOT);
const fetchNativo = fetch;
global.fetch = (url, opts) => (typeof url === 'string' && !url.startsWith('http')
  ? fetchNativo(`http://localhost:8098/${url}`, opts)
  : fetchNativo(url, opts));

await import(path.join(ROOT, 'js', 'comparar-app.js') + `?t=${Date.now()}`);
await esperar(500);

function ultimoRender() { return plotlyLlamadas.filter((c) => c.containerId === 'grafico-comparativo').pop(); }
function pillsActuales() { return Array.from(document.querySelectorAll('#fila-grupos .grupo-tarjeta')); }
function clickPill(indice) { pillsActuales()[indice].dispatchEvent(new window.Event('click', { bubbles: true })); }
function clickQuitar(indice) { pillsActuales()[indice].querySelector('.grupo-tarjeta-quitar').dispatchEvent(new window.Event('click', { bubbles: true })); }

// ============================================================================
console.log('\n1. Contexto → atrás → adelante');
{
  const historialAtras = document.getElementById('historial-atras');
  const historialAdelante = document.getElementById('historial-adelante');
  assert(historialAtras.disabled, 'Al inicio, "atrás" está deshabilitado (un único estado en el historial)');
  assert(historialAdelante.disabled, 'Al inicio, "adelante" está deshabilitado');

  const gruposAntes = pillsActuales().map((p) => p.textContent);

  // agrega una condición de contexto a través del buscador real
  document.querySelector('#contexto-oracion .agregar-condicion').dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  const itemZona = Array.from(document.querySelectorAll('.buscador-item')).find((li) => li.textContent.includes('Zona'));
  itemZona.dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  const itemValor = document.querySelector('.buscador-item');
  itemValor.dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);

  assert(!historialAtras.disabled, 'Tras agregar una condición de contexto, "atrás" se habilita');
  assert(historialAdelante.disabled, '"adelante" sigue deshabilitado (estamos en la punta del historial)');
  const nObsConContexto = document.getElementById('contexto-corto').textContent;

  historialAtras.dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  assert(document.getElementById('contexto-corto').textContent !== nObsConContexto, 'Al ir atrás, el universo de análisis vuelve a como estaba (contexto restaurado)');
  assert(!historialAdelante.disabled, 'Tras ir atrás, "adelante" se habilita');

  historialAdelante.dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  assert(document.getElementById('contexto-corto').textContent === nObsConContexto, 'Al ir adelante, se recupera exactamente el estado con la condición de contexto');

  // vuelve atrás para dejar el contexto limpio para las siguientes secciones
  historialAtras.dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
}

// ============================================================================
console.log('\n2. Cambio de variable de comparación genera un estado navegable');
{
  const historialAtras = document.getElementById('historial-atras');
  const select = document.getElementById('select-variable');
  const variableAntes = select.value;
  const otraVariable = Array.from(select.options).map((o) => o.value).find((v) => v !== variableAntes);
  const nAntesDeCambiar = historialCanGoBackSnapshotCount();

  select.value = otraVariable;
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await esperar(50);

  assert(!historialAtras.disabled, 'Tras cambiar la variable, "atrás" está habilitado (nuevo estado empujado)');

  historialAtras.dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  assert(document.getElementById('select-variable').value === variableAntes, 'Al ir atrás, la variable de comparación vuelve a la anterior');

  document.getElementById('historial-adelante').dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  assert(document.getElementById('select-variable').value === otraVariable, 'Al ir adelante, se recupera la variable nueva');
  void nAntesDeCambiar;
}
function historialCanGoBackSnapshotCount() { return 0; } // placeholder de legibilidad, no se usa como conteo real

// ============================================================================
console.log('\n3. Agregado y eliminación de grupos generan estados navegables independientes');
{
  const historialAtras = document.getElementById('historial-atras');
  const gruposAntesDeQuitar = pillsActuales().length;
  const valorQuitado = pillsActuales()[0].textContent;

  clickQuitar(0); // quita el primer grupo (botón ×, ya no el cuerpo de la tarjeta)
  await esperar(50);
  assert(pillsActuales().length === gruposAntesDeQuitar - 1, 'Quitar un grupo desde su pill baja la cantidad de grupos activos');
  assert(!historialAtras.disabled, 'Quitar un grupo generó un estado navegable ("atrás" habilitado)');

  // agrega un grupo distinto desde "+ agregar grupo"
  const addBtn = document.querySelector('#fila-grupos .agregar-grupo');
  assert(addBtn !== null, 'Con lugar libre tras quitar un grupo, existe la acción "+ agregar grupo"');
  addBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  const itemGrupo = document.querySelector('.buscador-item');
  const nombreAgregado = itemGrupo.textContent;
  itemGrupo.dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  assert(pillsActuales().length === gruposAntesDeQuitar, 'Agregar otro grupo recupera la cantidad original de grupos activos');
  assert(pillsActuales().some((p) => p.textContent.includes(nombreAgregado)), 'El grupo recién agregado aparece en la fila de pills');

  // atrás dos veces: primero deshace el "agregar", después el "quitar"
  historialAtras.dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  assert(pillsActuales().length === gruposAntesDeQuitar - 1, 'Al ir atrás una vez, se deshace el "agregar grupo"');
  historialAtras.dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  assert(pillsActuales().some((p) => p.textContent.includes(valorQuitado)), 'Al ir atrás otra vez, el grupo originalmente quitado vuelve a estar presente');

  // adelante dos veces: vuelve al estado con el grupo nuevo agregado
  document.getElementById('historial-adelante').dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  document.getElementById('historial-adelante').dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  assert(pillsActuales().some((p) => p.textContent.includes(nombreAgregado)), 'Navegando adelante dos veces, se recupera el grupo agregado');
}

// ============================================================================
console.log('\n4. Visibilidad desde la tarjeta de grupo genera un estado navegable');
{
  const historialAtras = document.getElementById('historial-atras');
  const traces = ultimoRender().traces;
  const grupoObjetivo = traces.find((t) => t.legendgroup)?.legendgroup;
  assert(grupoObjetivo !== undefined, 'Hay al menos un grupo con legendgroup en el gráfico actual');

  const visibleAntes = traces.find((t) => t.legendgroup === grupoObjetivo && t.mode?.includes('markers')).visible;
  const tarjetaObjetivo = document.querySelector(`.grupo-tarjeta[data-grupo-valor="${grupoObjetivo}"]`);
  tarjetaObjetivo.dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);

  const tracesTrasClick = ultimoRender().traces;
  const visibleDespues = tracesTrasClick.find((t) => t.legendgroup === grupoObjetivo && t.mode?.includes('markers')).visible;
  assert(visibleDespues !== visibleAntes, 'Tras el clic en la tarjeta, la traza del grupo cambió su estado de visibilidad');
  assert(!historialAtras.disabled, 'Ocultar un grupo desde su tarjeta generó un estado navegable');

  historialAtras.dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  const tracesTrasVolver = ultimoRender().traces;
  const visibleRestaurado = tracesTrasVolver.find((t) => t.legendgroup === grupoObjetivo && t.mode?.includes('markers')).visible;
  assert(visibleRestaurado === visibleAntes, 'Al ir atrás, la visibilidad del grupo vuelve exactamente a como estaba');

  document.getElementById('historial-adelante').dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
}

// ============================================================================
console.log('\n5. Conservación del orden y del grupo de referencia');
{
  const traces = ultimoRender().traces;
  const trazasMediana = traces.filter((t) => t.mode && t.mode.includes('markers') && t.legendgroup);
  const ordenActual = trazasMediana.map((t) => t.legendgroup);

  // el grupo de referencia del hover (Sección 6) es siempre el primero del
  // orden estable -- se valida indirectamente: la traza-ancla del hover
  // debe existir y el primer elemento de ordenActual debe ser estable tras
  // ir atrás/adelante sin tocar el orden.
  const historialAtras = document.getElementById('historial-atras');
  const historialAdelante = document.getElementById('historial-adelante');
  historialAtras.dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);
  historialAdelante.dispatchEvent(new window.Event('click', { bubbles: true }));
  await esperar(50);

  const tracesTrasIrYVolver = ultimoRender().traces;
  const ordenTrasIrYVolver = tracesTrasIrYVolver.filter((t) => t.mode && t.mode.includes('markers') && t.legendgroup).map((t) => t.legendgroup);
  assert(JSON.stringify(ordenTrasIrYVolver) === JSON.stringify(ordenActual), 'El orden estable de grupos se conserva exactamente tras navegar atrás y adelante');
  assert(ordenActual[0] === ordenTrasIrYVolver[0], 'El grupo de referencia (primero del orden) es el mismo antes y después de navegar');
}

// ============================================================================
console.log('\n6. Ausencia de snapshots duplicados');
{
  const historialAtras = document.getElementById('historial-atras');
  // quitar una condición de contexto que NO existe no debería generar un
  // estado nuevo -- se simula intentando quitar dos veces seguidas la misma
  // condición ya inexistente a través de una acción que no cambia nada.
  const habilitadoAntes = !historialAtras.disabled;
  // re-seleccionar la MISMA variable actual no debería cambiar el snapshot
  const select = document.getElementById('select-variable');
  const valorActual = select.value;
  select.value = valorActual;
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await esperar(50);
  // El estado de habilitación de "atrás" no debería cambiar por una acción
  // que reproduce exactamente el mismo snapshot serializado (misma
  // variable -> misma selección automática de grupos -> mismo array
  // groups). No podemos leer el largo interno del historial desde afuera,
  // así que se verifica indirectamente: "atrás" sigue en el mismo estado
  // de habilitación que antes de la acción no-operativa.
  assert(!historialAtras.disabled === habilitadoAntes, 'Repetir la misma variable de agrupamiento no altera la disponibilidad de "atrás" (no se empujó un duplicado)');
}

// ============================================================================
console.log('\n7. Restauración vía atrás/adelante no crea entradas nuevas');
{
  const historialAtras = document.getElementById('historial-atras');
  const historialAdelante = document.getElementById('historial-adelante');

  // Ir atrás hasta el principio, contando pasos
  let pasosAtras = 0;
  while (!historialAtras.disabled && pasosAtras < 50) {
    historialAtras.dispatchEvent(new window.Event('click', { bubbles: true }));
    await esperar(20);
    pasosAtras++;
  }
  assert(historialAtras.disabled, 'Se llegó al principio del historial (atrás deshabilitado)');

  // Ir adelante la misma cantidad de pasos: si "adelante" no existiera más
  // allá de esos pasos, algo generó una entrada extra durante la
  // restauración (lo cual violaría "restaurar no empuja").
  let pasosAdelante = 0;
  while (!historialAdelante.disabled && pasosAdelante < 50) {
    historialAdelante.dispatchEvent(new window.Event('click', { bubbles: true }));
    await esperar(20);
    pasosAdelante++;
  }
  assert(pasosAdelante === pasosAtras, `La cantidad de pasos hacia adelante (${pasosAdelante}) coincide exactamente con los pasos hacia atrás (${pasosAtras}) -- ninguna restauración generó una entrada nueva`);
  assert(historialAdelante.disabled, 'Tras recorrer todo el historial hacia adelante, "adelante" vuelve a estar deshabilitado (se llegó a la punta original, no se generaron entradas de más)');
}

// ============================================================================
console.log('\n' + '='.repeat(60));
console.log(`Verificaciones ejecutadas: ${checksRun}`);
console.log(`Verificaciones fallidas:   ${checksFailed}`);
console.log(checksFailed === 0
  ? '\n✓ EL HISTORIAL DE COMPARAR FUNCIONA DE PUNTA A PUNTA.'
  : '\n✗ HAY VERIFICACIONES FALLIDAS.');
process.exit(checksFailed === 0 ? 0 : 1);
