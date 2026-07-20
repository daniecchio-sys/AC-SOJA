// ============================================================================
// test/engine-test-query-builder.mjs
// Verifica el contrato de la pregunta raíz configurable de query-builder.js
// (construirOracion / renderQuery), agregado para permitir que Escenarios
// use su propia pregunta sin duplicar el motor de construcción de consultas.
// No requiere DOM (usa solo construirOracion, no renderQuery).
// Se ejecuta con: node test/engine-test-query-builder.mjs
// ============================================================================

import { construirOracion, BASE_SENTENCE_EXPLORAR } from '../js/query-builder.js';

let checks = 0, failed = 0;
function check(desc, cond) {
  checks++;
  if (!cond) { failed++; console.log(`  ✗ ${desc}`); } else { console.log(`  ✓ ${desc}`); }
}

console.log('1. Comportamiento por defecto (sin baseSentence) -- Explorar/Comparar intactos');
{
  const vacio = construirOracion({});
  check('Sin filtros y sin baseSentence, usa la pregunta raíz de Explorar', vacio.texto === `${BASE_SENTENCE_EXPLORAR} en toda la red?`);

  const conFiltro = construirOracion({ zona: { type: 'in', values: ['4'] } });
  check('Con un filtro y sin baseSentence, antepone la pregunta raíz de Explorar', conFiltro.texto.startsWith(BASE_SENTENCE_EXPLORAR));
  check('La cláusula del filtro se redacta igual que siempre ("en Zona 4")', conFiltro.clausulas[0].texto === 'en Zona 4');
}

console.log('\n2. Pregunta raíz configurable (uso previsto: Escenarios)');
{
  const preguntaEscenarios = '¿Qué ocurrió históricamente';
  const vacio = construirOracion({}, { baseSentence: preguntaEscenarios });
  check('Sin filtros, con baseSentence propia, la usa en vez de la de Explorar', vacio.texto === `${preguntaEscenarios} en toda la red?`);
  check('No mezcla ambas preguntas raíz en el mismo texto', !vacio.texto.includes(BASE_SENTENCE_EXPLORAR));

  const conFiltros = construirOracion(
    { zona: { type: 'in', values: ['4'] }, enso: { type: 'in', values: ['NIÑA'] } },
    { baseSentence: preguntaEscenarios },
  );
  check('Con filtros, antepone la pregunta raíz propia', conFiltros.texto.startsWith(preguntaEscenarios));
  check('Las cláusulas se redactan exactamente igual que con la pregunta raíz por defecto (mismo motor, misma sintaxis)', conFiltros.clausulas[0].texto === 'en Zona 4' && conFiltros.clausulas[1].texto === 'bajo condiciones Niña');
}

console.log('\n3. Dos llamadas con distinta pregunta raíz no se contaminan entre sí (sin estado compartido)');
{
  const a = construirOracion({}, { baseSentence: 'Pregunta A' });
  const b = construirOracion({}, { baseSentence: 'Pregunta B' });
  const c = construirOracion({}); // por defecto, llamada después de las dos anteriores
  check('La primera llamada usa su propia pregunta', a.texto.startsWith('Pregunta A'));
  check('La segunda llamada usa su propia pregunta, sin heredar la primera', b.texto.startsWith('Pregunta B'));
  check('Una llamada posterior sin baseSentence vuelve exactamente a la de Explorar (no quedó "pegada" ninguna anterior)', c.texto.startsWith(BASE_SENTENCE_EXPLORAR));
}

console.log('\n' + '='.repeat(60));
console.log(`Verificaciones ejecutadas: ${checks}`);
console.log(`Verificaciones fallidas:   ${failed}`);
console.log(failed === 0
  ? '\n✓ LA PREGUNTA RAÍZ CONFIGURABLE FUNCIONA SIN AFECTAR EL COMPORTAMIENTO POR DEFECTO.'
  : '\n✗ HAY VERIFICACIONES FALLIDAS.');
process.exit(failed === 0 ? 0 : 1);
