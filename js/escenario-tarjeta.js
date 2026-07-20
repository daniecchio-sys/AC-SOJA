// ============================================================================
// escenario-tarjeta.js
// Presentación de la tarjeta de resumen del escenario (Sección 6.1 del
// documento funcional) -- de solo lectura, sin cláusulas clickeables.
// Exclusiva de Escenarios (no tiene equivalente en Explorar ni Comparar).
//
// Por qué NO reutiliza fraseDeCondicion() de query-builder.js: esa función
// arma FRAGMENTOS DE ORACIÓN, con la preposición/conector ya incorporado al
// gusto de cada campo ("bajo condiciones Niña", "con antecesor Maíz", "de
// ciclo Corto") -- útil para una oración corrida, pero la tarjeta necesita
// el VALOR solo, en un formato etiqueta:valor ("ENSO: Niña", "Antecesor:
// Maíz"). Extraer el valor "pelado" de cada frase con una expresión regular
// sería más fragil que simplemente declarar, para las 7 variables (una
// lista fija y corta), qué valor mostrar -- exactamente lo que hace este
// archivo.
// ============================================================================

import { tituloLegible } from './query-builder.js';

// Etiquetas de columna para la tarjeta -- deliberadamente más cortas que
// FRASE_POR_CAMPO[key].categoria (esa incluye aclaraciones para el
// buscador, ej. "Ocupación (1°/2°)"; la tarjeta solo necesita "Ocupación").
const ETIQUETAS_TARJETA = {
  zona: 'Zona',
  enso: 'ENSO',
  ocupacion: 'Ocupación',
  ciclo: 'Ciclo',
  riego: 'Riego',
  fertilizacion: 'Fertilización',
  antecesor: 'Antecesor',
};

const ETIQUETAS_OCUPACION = { '1°': 'Primera', '2°': 'Segunda', '3°': 'Tercera' };

/**
 * Valor "pelado" de una condición para la tarjeta -- sin preposiciones ni
 * conectores de oración. Mapeo explícito por campo porque cada uno
 * necesita una regla propia (ver ejemplo en Sección 6.1 del documento
 * funcional): Zona muestra el código tal cual ("4"), Riego y
 * Fertilización muestran una forma corta capitalizada ("Con riego", "Con
 * fertilización"), Ocupación traduce el código a texto ("Primera"), y el
 * resto usa Title Case simple (mismo criterio que el resto del producto).
 * @param {string} key
 * @param {string} valor
 * @returns {string}
 */
function valorParaTarjeta(key, valor) {
  switch (key) {
    case 'zona':
      return valor;
    case 'ocupacion':
      return ETIQUETAS_OCUPACION[valor] || tituloLegible(valor);
    case 'riego':
      return valor === 'SI' ? 'Con riego' : 'En secano';
    case 'fertilizacion':
      if (valor === 'CON FERTILIZACIÓN') return 'Con fertilización';
      if (valor === 'SIN FERTILIZACIÓN') return 'Sin fertilización';
      return 'Sin dato registrado';
    default: // enso, ciclo, antecesor
      return tituloLegible(valor);
  }
}

/**
 * Renderiza la tarjeta de resumen dentro de `container`. De solo lectura:
 * no registra ningún listener de click (Sección 6.1 -- "no tiene cláusulas
 * clickeables ni ninguna interacción propia").
 * @param {HTMLElement} container
 * @param {object} params
 * @param {object} params.condiciones mismo formato que appliedFilters (solo condiciones type:'in', Escenarios no usa rangos)
 * @param {number} params.nEscenario
 * @param {number} params.campanasIncluidas
 */
export function renderTarjetaEscenario(container, { condiciones, nEscenario, campanasIncluidas }) {
  container.innerHTML = '';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Resumen del escenario');

  const grilla = document.createElement('div');
  grilla.className = 'tarjeta-grilla';

  Object.keys(condiciones).forEach((key) => {
    const condition = condiciones[key];
    if (!condition || condition.type !== 'in' || !condition.values || condition.values.length === 0) return;
    const etiqueta = ETIQUETAS_TARJETA[key];
    if (!etiqueta) return; // por si alguna vez aparece una clave fuera de las 7 permitidas
    const valor = valorParaTarjeta(key, condition.values[0]);

    const item = document.createElement('div');
    item.className = 'tarjeta-item';
    item.innerHTML = `<span class="tarjeta-etiqueta">${etiqueta}:</span> <span class="tarjeta-valor">${valor}</span>`;
    grilla.appendChild(item);
  });

  container.appendChild(grilla);

  const pie = document.createElement('div');
  pie.className = 'tarjeta-pie';
  pie.textContent = `${nEscenario.toLocaleString('es-AR')} observaciones históricas comparables · ${campanasIncluidas.toLocaleString('es-AR')} campañas`;
  container.appendChild(pie);
}
