// ============================================================================
// test/engine-test-escenarios.mjs
// Verificación del motor de Escenarios (Etapas 1-3 del plan): constructor
// (aplicación de condiciones), filtrado AND, e indicador principal con
// todos sus estados (sin escenario / sin observaciones / <50 / =50 / >50).
// Sin DOM, sin gráfico -- se puede correr desde una consola de Node.
// Se ejecuta con: node test/engine-test-escenarios.mjs
// ============================================================================

import fs from 'fs';
import { loadDataset } from '../js/data-loader.js';
import { createEscenarioState, MIN_OBS_ESCENARIO, CLAVES_VARIABLES_PERMITIDAS } from '../js/escenario-state.js';

let checks = 0, failed = 0;
function check(desc, cond) {
  checks++;
  if (!cond) { failed++; console.log(`  ✗ ${desc}`); } else { console.log(`  ✓ ${desc}`); }
}

const csvText = fs.readFileSync('data/ac_soja.csv', 'utf8');
const { records } = loadDataset(csvText);
console.log(`Registros cargados: ${records.length}\n`);

console.log('1. Estado "sin escenario" (sin condiciones activas)');
{
  const es = createEscenarioState();
  es.load(records);
  const snap = es.getSnapshot();
  check('hayCondiciones es false sin ninguna condición activa', snap.hayCondiciones === false);
  check('nEscenario es igual al total del dataset cargado', snap.nEscenario === records.length);
  check('El universo completo alcanza sobradamente el mínimo (miles >> 50)', snap.alcanzaMinimo === true);
  check('campanasIncluidas cuenta más de una campaña sobre el dataset completo', snap.campanasIncluidas > 1);
}

console.log('\n2. Estado "sin observaciones" (combinación imposible)');
{
  const es = createEscenarioState();
  es.load(records);
  // combinar dos condiciones que no pueden coexistir en ningún registro real
  es.setCondicion('zona', { type: 'in', values: ['CEN'] });
  es.setCondicion('enso', { type: 'in', values: ['__VALOR_INEXISTENTE__'] });
  const snap = es.getSnapshot();
  check('nEscenario es exactamente 0', snap.nEscenario === 0);
  check('alcanzaMinimo es false con 0 observaciones', snap.alcanzaMinimo === false);
  check('campanasIncluidas es 0 cuando no hay observaciones', snap.campanasIncluidas === 0);
  check('hayCondiciones sigue siendo true (el escenario tiene condiciones, aunque dé 0)', snap.hayCondiciones === true);
}

console.log('\n3. Filtrado AND: agregar condiciones nunca aumenta el n');
{
  const es = createEscenarioState();
  es.load(records);
  const nSinCondiciones = es.getSnapshot().nEscenario;
  es.setCondicion('zona', { type: 'in', values: ['4'] });
  const nConZona = es.getSnapshot().nEscenario;
  check('Agregar "Zona=4" reduce (o iguala) el n respecto de toda la red', nConZona <= nSinCondiciones);
  es.setCondicion('riego', { type: 'in', values: ['SI'] });
  const nConZonaYRiego = es.getSnapshot().nEscenario;
  check('Agregar "Riego=SI" reduce (o iguala) el n respecto de solo Zona=4 (AND estricto)', nConZonaYRiego <= nConZona);

  // verificación cruzada independiente: contar a mano sobre records crudos
  const nManual = records.filter((r) => r.zona === '4' && r.riego === 'SI').length;
  check('El n calculado coincide exactamente con un conteo manual AND sobre los datos crudos', nConZonaYRiego === nManual);
}

console.log('\n4. Quitar una condición vuelve a ampliar el universo');
{
  const es = createEscenarioState();
  es.load(records);
  es.setCondicion('zona', { type: 'in', values: ['4'] });
  const nConZona = es.getSnapshot().nEscenario;
  es.setCondicion('riego', { type: 'in', values: ['SI'] });
  es.quitarCondicion('riego');
  const nTrasQuitar = es.getSnapshot().nEscenario;
  check('Quitar "Riego=SI" recupera exactamente el n que había solo con Zona=4', nTrasQuitar === nConZona);
}

console.log('\n5. Estado "menos de 50" (< MIN_OBS_ESCENARIO)');
{
  const es = createEscenarioState();
  es.load(records);
  // Búsqueda programática de una combinación real de DOS condiciones que dé
  // 1 <= n < 50 (en vez de adivinar valores a mano, que puede dar 0 y no
  // ejercitar el caso pedido).
  let combinacion = null;
  outer:
  for (const campoA of CLAVES_VARIABLES_PERMITIDAS) {
    const valoresA = [...new Set(records.map((r) => r[campoA]).filter((v) => v !== null))];
    for (const valorA of valoresA) {
      const subsetA = records.filter((r) => r[campoA] === valorA);
      if (subsetA.length < MIN_OBS_ESCENARIO) continue; // ya buscamos que el recorte SIGUIENTE caiga en rango
      for (const campoB of CLAVES_VARIABLES_PERMITIDAS) {
        if (campoB === campoA) continue;
        const valoresB = [...new Set(subsetA.map((r) => r[campoB]).filter((v) => v !== null))];
        for (const valorB of valoresB) {
          const n = subsetA.filter((r) => r[campoB] === valorB).length;
          if (n > 0 && n < MIN_OBS_ESCENARIO) { combinacion = { campoA, valorA, campoB, valorB, n }; break outer; }
        }
      }
    }
  }
  check('Se encontró una combinación real con 1 <= n < 50', combinacion !== null);
  if (combinacion) {
    es.setCondicion(combinacion.campoA, { type: 'in', values: [combinacion.valorA] });
    es.setCondicion(combinacion.campoB, { type: 'in', values: [combinacion.valorB] });
    const snap = es.getSnapshot();
    check(`El escenario construido queda por debajo de ${MIN_OBS_ESCENARIO} (obtenido: n=${snap.nEscenario}, esperado=${combinacion.n})`, snap.nEscenario === combinacion.n && snap.nEscenario < MIN_OBS_ESCENARIO);
    check('alcanzaMinimo es false por debajo del umbral', snap.alcanzaMinimo === false);
  }
}

console.log('\n6. Estado "exactamente 50" (borde inclusive)');
{
  // Se busca, sobre el dataset real, una combinación de UNA condición que dé
  // exactamente 50 -- si no existe ninguna con una sola condición, se
  // prueba con combinaciones de dos, hasta encontrar el caso real exacto.
  const es = createEscenarioState();
  es.load(records);
  let encontrado = null;
  for (const campo of CLAVES_VARIABLES_PERMITIDAS) {
    const valores = new Set(records.map((r) => r[campo]).filter((v) => v !== null));
    for (const valor of valores) {
      const n = records.filter((r) => r[campo] === valor).length;
      if (n === MIN_OBS_ESCENARIO) { encontrado = { campo, valor }; break; }
    }
    if (encontrado) break;
  }
  if (encontrado) {
    es.setCondicion(encontrado.campo, { type: 'in', values: [encontrado.valor] });
    const snap = es.getSnapshot();
    check(`Se encontró un caso real con n=${MIN_OBS_ESCENARIO} exacto (${encontrado.campo}=${encontrado.valor})`, snap.nEscenario === MIN_OBS_ESCENARIO);
    check('Con n exactamente 50, alcanzaMinimo es true (el borde es inclusive, Sección 9.3)', snap.alcanzaMinimo === true);
  } else {
    // Si el dataset real no tiene ningún caso natural de exactamente 50,
    // se verifica la regla de borde de forma sintética, inyectando un
    // dataset de prueba controlado -- la regla en sí (>= vs >) es lo que
    // importa, no que el dataset real tenga ese caso.
    const registrosSinteticos = Array.from({ length: MIN_OBS_ESCENARIO }, (_, i) => ({
      ...records[0], zona: '__SINTETICO__', campana: records[0].campana,
    }));
    const esSint = createEscenarioState();
    esSint.load(registrosSinteticos);
    esSint.setCondicion('zona', { type: 'in', values: ['__SINTETICO__'] });
    const snapSint = esSint.getSnapshot();
    check('(caso sintético, no se encontró uno real) n=50 exacto construido artificialmente', snapSint.nEscenario === MIN_OBS_ESCENARIO);
    check('Con n exactamente 50 (sintético), alcanzaMinimo es true (borde inclusive)', snapSint.alcanzaMinimo === true);
  }
}

console.log('\n7. Estado "más de 50"');
{
  const es = createEscenarioState();
  es.load(records);
  es.setCondicion('zona', { type: 'in', values: ['4'] });
  const snap = es.getSnapshot();
  check(`Zona=4 sola ya supera holgadamente 50 (obtenido: n=${snap.nEscenario})`, snap.nEscenario > MIN_OBS_ESCENARIO);
  check('alcanzaMinimo es true por encima del umbral', snap.alcanzaMinimo === true);
}

console.log('\n8. Validación de variables permitidas');
{
  const es = createEscenarioState();
  es.load(records);
  check('CLAVES_VARIABLES_PERMITIDAS tiene exactamente las 7 variables vigentes', CLAVES_VARIABLES_PERMITIDAS.length === 7);
  let lanzoError = false;
  try { es.setCondicion('ciclo', { type: 'in', values: ['5 CORTO'] }); }
  catch (e) { lanzoError = true; }
  check('Intentar usar una variable NO permitida (ej. ciclo, ya no es condición del buscador) lanza un error explícito', lanzoError);
  check('departamento SÍ está entre las variables permitidas (lista actualizada)', CLAVES_VARIABLES_PERMITIDAS.includes('departamento'));
}

console.log('\n' + '='.repeat(60));
console.log(`Verificaciones ejecutadas: ${checks}`);
console.log(`Verificaciones fallidas:   ${failed}`);
console.log(failed === 0
  ? '\n✓ EL MOTOR DE ESCENARIOS (ETAPAS 1-3) FUNCIONA CORRECTAMENTE.'
  : '\n✗ HAY VERIFICACIONES FALLIDAS.');
process.exit(failed === 0 ? 0 : 1);
