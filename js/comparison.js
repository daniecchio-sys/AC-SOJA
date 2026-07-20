// ============================================================================
// comparison.js
// Comparar consultas completas, no solo gráficos: fija una consulta como
// "referencia" y calcula qué cambió respecto de la consulta "actual". El
// gráfico es una consecuencia de esta comparación, no el punto de partida.
// ============================================================================

import { fraseDeCondicion } from './query-builder.js';

/**
 * Crea una instancia de comparación independiente.
 * @returns {object}
 */
export function createComparison() {
  let referencia = null; // { filters, sentence, snapshot }

  return {
    fijar(filters, sentence, snapshot) {
      referencia = { filters: { ...filters }, sentence, snapshot };
    },
    limpiar() {
      referencia = null;
    },
    hayReferencia() {
      return referencia !== null;
    },
    obtenerReferencia() {
      return referencia;
    },
  };
}

/**
 * Compara dos conjuntos de filtros (referencia vs. actual) y devuelve, en
 * lenguaje natural, qué cambió. No asume que la comparación es "un valor
 * cambió por otro" -- también contempla condiciones agregadas o quitadas
 * por completo.
 * @param {object} filtrosReferencia
 * @param {object} filtrosActual
 * @returns {Array<{ tipo: 'agregada'|'quitada'|'modificada', texto: string }>}
 */
export function diferenciasEntreConsultas(filtrosReferencia, filtrosActual) {
  const claves = new Set([...Object.keys(filtrosReferencia || {}), ...Object.keys(filtrosActual || {})]);
  const diferencias = [];

  claves.forEach((key) => {
    const enRef = filtrosReferencia?.[key];
    const enActual = filtrosActual?.[key];
    const activaEnRef = condicionActiva(enRef);
    const activaEnActual = condicionActiva(enActual);

    if (activaEnRef && !activaEnActual) {
      diferencias.push({ tipo: 'quitada', texto: fraseDeCondicion(key, enRef) });
    } else if (!activaEnRef && activaEnActual) {
      diferencias.push({ tipo: 'agregada', texto: fraseDeCondicion(key, enActual) });
    } else if (activaEnRef && activaEnActual && JSON.stringify(enRef) !== JSON.stringify(enActual)) {
      diferencias.push({
        tipo: 'modificada',
        texto: `${fraseDeCondicion(key, enRef)} → ${fraseDeCondicion(key, enActual)}`,
      });
    }
  });

  return diferencias;
}

function condicionActiva(condition) {
  if (!condition) return false;
  if (condition.type === 'in') return condition.values && condition.values.length > 0;
  if (condition.type === 'range') return condition.min !== null || condition.max !== null;
  if (condition.type === 'daterange') return condition.startDia !== null || condition.endDia !== null;
  return false;
}
