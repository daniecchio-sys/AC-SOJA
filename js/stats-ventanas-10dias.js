// ============================================================================
// stats-ventanas-10dias.js
// PRUEBA METODOLÓGICA REVERSIBLE -- no es la fuente de verdad del producto.
// Configuración ALTERNATIVA de ventanas de fecha de siembra (~10 días en
// vez de las 5 vigentes), para comparar resultados antes de decidir si
// reemplazar buildFixedWindows() (stats.js, intacta, no se toca acá).
//
// Reutiliza SIN modificar: MESES_VENTANA/diasEnMes/PERIODO_ANALIZADO
// (exportados de stats.js para este propósito) y, más importante,
// TODO el resto del pipeline metodológico -- computeWindowSummary,
// classifyObservations, computeKPIs, generateMessages, selectVisibleWindows,
// ventanaConMayorP75/P25, assignWindowId -- ninguna de esas funciones sabe
// ni le importa si una ventana dura 5 o 10 días: todas reciben `windows`
// como parámetro genérico. No se duplicó ni una línea de percentiles,
// clasificación o KPIs para esta prueba.
// ============================================================================

import { MESES_VENTANA, diasEnMes } from './stats.js';

/**
 * Construye las 11 ventanas de ~10 días del documento de prueba
 * ("Ventanas de fecha de siembra de 10 días" -- nombre provisorio, no
 * "decenatos", porque la última ventana de enero es parcial). Mismo
 * período analizado que la versión vigente (01/oct-15/ene).
 *
 * Dos reglas distintas según el mes, ambas ya usadas en el producto (la
 * primera es exactamente la de buildFixedWindows(), solo con ancho 10 en
 * vez de 5; la segunda es nueva, exclusiva del mes final truncado):
 *   - Meses completos del período (Octubre, Noviembre, Diciembre): la
 *     última ventana ABSORBE el resto de días, para no dejar nunca una
 *     ventana huérfana de 1 día (ej. Octubre: 1-10, 11-20, 21-31 -- no
 *     "21-30" + "31-31" suelto).
 *   - El último mes del período (Enero, truncado en el día 15 por
 *     PERIODO_ANALIZADO): el resto NO se fusiona con la ventana anterior
 *     -- queda como su propia ventana parcial (1-10, 11-15), tal como
 *     pide explícitamente el documento de prueba. Fusionarlo produciría
 *     una única ventana de 15 días, demasiado ancha para lo que se está
 *     evaluando.
 * @returns {Array} misma forma que buildFixedWindows(): {id, mes, nombreMes, diaInicio, diaFin, label}
 */
export function buildVentanas10Dias() {
  const ANCHO_BASE = 10;
  const windows = [];
  let id = 0;
  const ultimoMesDelPeriodo = MESES_VENTANA[MESES_VENTANA.length - 1].mes;

  MESES_VENTANA.forEach(({ mes, nombre }) => {
    const totalDias = diasEnMes(mes);
    const esMesTruncadoFinal = mes === ultimoMesDelPeriodo;

    if (esMesTruncadoFinal) {
      // No se fusiona el resto: cada tramo de hasta 10 días es su propia
      // ventana, incluida la última aunque quede más angosta.
      const cantidadVentanas = Math.ceil(totalDias / ANCHO_BASE);
      for (let i = 0; i < cantidadVentanas; i++) {
        const diaInicio = i * ANCHO_BASE + 1;
        const diaFin = Math.min(diaInicio + ANCHO_BASE - 1, totalDias);
        windows.push({ id, mes, nombreMes: nombre, diaInicio, diaFin, label: `${diaInicio}-${diaFin} ${nombre}` });
        id++;
      }
    } else {
      // Mismo criterio que buildFixedWindows(): la última ventana del mes
      // absorbe el resto de días.
      const cantidadVentanas = Math.floor(totalDias / ANCHO_BASE);
      for (let i = 0; i < cantidadVentanas; i++) {
        const esUltimaVentanaDelMes = i === cantidadVentanas - 1;
        const diaInicio = i * ANCHO_BASE + 1;
        const diaFin = esUltimaVentanaDelMes ? totalDias : diaInicio + ANCHO_BASE - 1;
        windows.push({ id, mes, nombreMes: nombre, diaInicio, diaFin, label: `${diaInicio}-${diaFin} ${nombre}` });
        id++;
      }
    }
  });
  return windows;
}
