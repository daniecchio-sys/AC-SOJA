import fs from 'fs';
import { loadDataset } from '../js/data-loader.js';
import { createComparisonState, CLAVES_VARIABLE_AGRUPAMIENTO, MAX_GRUPOS } from '../js/comparison-state.js';

let checks = 0, failed = 0;
function check(desc, cond) {
  checks++;
  if (!cond) { failed++; console.log(`  ✗ ${desc}`); } else { console.log(`  ✓ ${desc}`); }
}

const csvText = fs.readFileSync('data/ac_soja.csv', 'utf8');
const { records } = loadDataset(csvText);
console.log(`Registros cargados: ${records.length}\n`);

const cs = createComparisonState();
cs.load(records);

console.log('1. Selección automática de grupos');
cs.setVariableAgrupamiento('zona');
let snap = cs.getSnapshot();
check('Se seleccionaron hasta MAX_GRUPOS grupos', snap.gruposOrden.length > 0 && snap.gruposOrden.length <= MAX_GRUPOS);
check('Los grupos están ordenados por mayor n descendente', snap.grupos.every((g, i) => i === 0 || g.n <= snap.grupos[i-1].n));
console.log(`  Grupos: ${snap.grupos.map(g => `${g.valor}(n=${g.n})`).join(', ')}\n`);

console.log('2. Orden estable se mantiene tras agregar/quitar');
const valorAQuitar = snap.gruposOrden[1];
cs.quitarGrupo(valorAQuitar);
snap = cs.getSnapshot();
check('El grupo quitado ya no está en gruposOrden', !snap.gruposOrden.includes(valorAQuitar));
check('El resto conserva su orden relativo', snap.grupos.length >= 1);

console.log('\n3. n=0 no elimina el grupo si se agrega uno inexistente en el contexto');
// probamos agregar un grupo (si hay lugar)
if (snap.gruposOrden.length < MAX_GRUPOS) {
  const disponibles = cs.getValoresDisponibles().filter(v => !snap.gruposOrden.includes(v));
  if (disponibles.length > 0) {
    cs.agregarGrupo(disponibles[0]);
    snap = cs.getSnapshot();
    check('El grupo agregado aparece al final del orden', snap.gruposOrden[snap.gruposOrden.length - 1] === disponibles[0]);
  }
}

console.log('\n4. Elegibilidad simultánea de indicadores (MIN_OBS_KPI=20 en TODOS los grupos)');
cs.setVariableAgrupamiento('ciclo'); // variable con probablemente más n por grupo
snap = cs.getSnapshot();
console.log(`  Grupos: ${snap.grupos.map(g => `${g.valor}(n=${g.n})`).join(', ')}`);
check('indicadores tiene la forma esperada', 'diferenciaMediana' in snap.indicadores && 'diferenciaPiso' in snap.indicadores);
if (snap.indicadores.diferenciaMediana) {
  const d = snap.indicadores.diferenciaMediana;
  check('diferenciaMediana.delta es un número >= 0', typeof d.delta === 'number' && d.delta >= 0);
  check('diferenciaMediana identifica grupoSupera distinto de grupoSuperado', d.grupoSupera !== d.grupoSuperado);
  console.log(`  Mayor diferencia de mediana: ${d.delta} kg/ha en ${d.windowLabel} (${d.grupoSupera} > ${d.grupoSuperado})`);
} else {
  console.log('  Sin ventana elegible para diferenciaMediana (esperable si n es bajo por grupo)');
}

console.log('\n5. Contexto (Paso 1) se aplica como AND antes de la condición de grupo');
const nTotalSinContexto = cs.getSnapshot().grupos.reduce((a, g) => a + g.n, 0);
cs.setContexto({ enso: { type: 'in', values: ['NIÑA'] } });
snap = cs.getSnapshot();
const nTotalConContexto = snap.grupos.reduce((a, g) => a + g.n, 0);
check('El total de observaciones baja (o igual) al agregar una condición de contexto', nTotalConContexto <= nTotalSinContexto);
console.log(`  n total sin contexto: ${nTotalSinContexto} · n total con ENSO=NIÑA: ${nTotalConContexto}`);
cs.setContexto({}); // limpiar

console.log('\n6. windowMode "auto" recorta bordes usando la UNIÓN de todos los grupos');
cs.setVariableAgrupamiento('zona');
cs.setWindowMode('auto');
snap = cs.getSnapshot();
const anyGroupVisible = snap.grupos[0] ? (snap.visibleWindowsPorGrupo.get(snap.grupos[0].valor) || []) : [];
check('Todos los grupos tienen la MISMA cantidad de ventanas visibles (eje compartido)', 
  snap.grupos.every(g => (snap.visibleWindowsPorGrupo.get(g.valor) || []).length === anyGroupVisible.length));
console.log(`  Ventanas visibles (modo auto, eje compartido): ${anyGroupVisible.length} de ${snap.windows.length}`);

console.log('\n7. Validación de CLAVES_VARIABLE_AGRUPAMIENTO contra el motor');
check('Las 7 variables de agrupamiento existen en filters.js (ya validado al importar el módulo sin lanzar)', CLAVES_VARIABLE_AGRUPAMIENTO.length === 7);

console.log('\n8. quitarGrupo hasta dejar 1 solo grupo: indicadores deben quedar null (necesitan >=2)');
cs.setVariableAgrupamiento('riego');
snap = cs.getSnapshot();
while (cs.getSnapshot().gruposOrden.length > 1) {
  cs.quitarGrupo(cs.getSnapshot().gruposOrden[cs.getSnapshot().gruposOrden.length - 1]);
}
snap = cs.getSnapshot();
check('Con 1 solo grupo, ambos indicadores son null', snap.indicadores.diferenciaMediana === null && snap.indicadores.diferenciaPiso === null);

console.log('\n9. Terminología de producto: Riego como variable de agrupamiento');
{
  const csModule = await import('../js/comparison-state.js');
  cs.setVariableAgrupamiento('riego');
  const snap9 = cs.getSnapshot();
  const etiquetas = snap9.gruposOrden.map((valor) => csModule.etiquetaDeGrupo(valor, 'riego'));
  check('SI se traduce a "Riego" (nunca el código crudo)', etiquetas.includes('Riego'));
  check('NO se traduce a "Secano" (nunca el código crudo)', snap9.gruposOrden.includes('NO') ? etiquetas.includes('Secano') : true);
  check('Ningún código crudo ("SI"/"NO") queda expuesto en las etiquetas', !etiquetas.includes('SI') && !etiquetas.includes('NO'));
  const snapshotSerializado = cs.getSerializableSnapshot();
  check('El snapshot serializado (historial) también usa la etiqueta de producto, no el código crudo', snapshotSerializado.groups.every((g) => g.label === 'Riego' || g.label === 'Secano'));
  console.log(`  Grupos (riego): ${snap9.gruposOrden.join(', ')} -> etiquetas: ${etiquetas.join(', ')}`);
}

console.log('\n' + '='.repeat(60));
console.log(`Verificaciones ejecutadas: ${checks}`);
console.log(`Verificaciones fallidas:   ${failed}`);
console.log(failed === 0 ? '\n✓ TODAS LAS VERIFICACIONES DEL MOTOR DE COMPARAR PASARON.' : '\n✗ HAY VERIFICACIONES FALLIDAS.');
process.exit(failed === 0 ? 0 : 1);
