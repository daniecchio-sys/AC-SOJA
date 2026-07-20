// ============================================================================
// utils.js
// Funciones genéricas, sin conocimiento de dominio agrícola.
// No dependen de state.js, data-loader.js ni de ningún otro módulo propio.
// ============================================================================

/**
 * Convierte un valor de celda de texto en número, tolerando distintos
 * formatos de separador decimal y de miles.
 *
 * Motivo: la base de origen (BS_SOJA_AC) tuvo, en más de una revisión,
 * columnas numéricas exportadas como texto con coma decimal en vez de punto.
 * La auditoría de QA (previa a esta versión) además encontró que la
 * implementación anterior tenía una rama de código muerta: decía manejar el
 * caso de separador de miles + decimal combinados (ej. "3.600,50") pero en
 * los hechos ejecutaba la misma operación sin importar el formato, y ese
 * caso puntual devolvía `null` en vez del número real.
 *
 * Reglas de esta versión, en orden:
 *   1. Si el texto tiene COMA y PUNTO a la vez: el separador que aparece
 *      MÁS A LA DERECHA es el decimal; el otro se interpreta como separador
 *      de miles y se elimina. Cubre tanto "3.600,50" (formato es-AR) como
 *      "3,600.50" (formato en-US) sin ambigüedad, porque la presencia de
 *      ambos símbolos ya indica cuál cumple cada rol.
 *   2. Si el texto tiene solo COMA: si aparece una única vez, se trata como
 *      decimal (es el patrón real y confirmado de esta base). Si aparece más
 *      de una vez, el valor no es interpretable y se rechaza (no se adivina).
 *   3. Si el texto tiene solo PUNTO: si aparece una única vez, se trata como
 *      decimal -- es la interpretación más segura para esta base, donde SÍ
 *      existen rendimientos reales con varios decimales (ej. "4408.955224")
 *      y NO hay evidencia, en ninguna auditoría, de que el punto se use
 *      alguna vez como separador de miles en un valor con un solo punto.
 *      Si aparece más de un punto, no puede tratarse de un decimal (un
 *      número no tiene dos puntos decimales), así que se interpretan todos
 *      como separadores de miles y se eliminan.
 *
 * Nota de ambigüedad reconocida explícitamente (no oculta): un valor como
 * "1.234", tomado de forma aislada, es inherentemente ambiguo entre "mil
 * doscientos treinta y cuatro" (separador de miles) y "uno coma
 * doscientos treinta y cuatro" (decimal). Esta función resuelve esa
 * ambigüedad puntual siempre como decimal, por ser el patrón que la base
 * real usa; queda documentado acá para que, si en el futuro aparece un caso
 * real donde el punto se use como separador de miles sin decimal, se sepa
 * exactamente dónde ajustar la regla.
 *
 * Nunca devuelve NaN: si el valor no es convertible, devuelve null, para no
 * propagar silenciosamente un valor inválido en cálculos posteriores.
 * @param {*} raw
 * @returns {number|null}
 */
export function parseFlexibleNumber(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  const text = String(raw).trim();
  if (text === '' || text.toUpperCase() === 'S/D' || text.toUpperCase() === 'NAN') return null;

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');
  let normalized;

  if (hasComma && hasDot) {
    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');
    normalized = lastComma > lastDot
      ? text.replace(/\./g, '').replace(',', '.') // coma es el decimal (es-AR): "3.600,50" -> "3600.50"
      : text.replace(/,/g, ''); // punto es el decimal (en-US): "3,600.50" -> "3600.50"
  } else if (hasComma) {
    const commaCount = (text.match(/,/g) || []).length;
    normalized = commaCount === 1 ? text.replace(',', '.') : null;
  } else if (hasDot) {
    const dotCount = (text.match(/\./g) || []).length;
    normalized = dotCount === 1 ? text : text.replace(/\./g, '');
  } else {
    normalized = text;
  }

  if (normalized === null) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parsea una fecha en formato ISO (aaaa-mm-dd) o dd/mm/aaaa [hh:mm:ss opcional].
 * Devuelve un objeto Date en hora local a medianoche, o null si no es parseable.
 * @param {*} raw
 * @returns {Date|null}
 */
export function parseFlexibleDate(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === '') return null;

  // formato ISO: 2024-12-05 (con o sin hora)
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return isValidCalendarDate(date, Number(y), Number(m), Number(d)) ? date : null;
  }

  // formato dd/mm/aaaa, con día/mes de uno o dos dígitos, hora opcional
  const dmyMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return isValidCalendarDate(date, Number(y), Number(m), Number(d)) ? date : null;
  }

  return null;
}

function isValidCalendarDate(date, year, month, day) {
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/**
 * Normaliza un string de categoría: recorta espacios, colapsa espacios internos
 * múltiples, y lo pasa a mayúsculas. Es idempotente: aplicarlo dos veces da el
 * mismo resultado que aplicarlo una vez.
 * @param {*} raw
 * @returns {string|null}
 */
export function normalizeCategory(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().replace(/\s+/g, ' ');
  if (text === '') return null;
  return text.toUpperCase();
}

/**
 * Redondea un número a la cantidad de decimales indicada (por defecto 1).
 * Devuelve null si el valor de entrada es null.
 * @param {number|null} value
 * @param {number} decimals
 * @returns {number|null}
 */
export function round(value, decimals = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Formatea un número entero con separador de miles al estilo es-AR (punto).
 * Uso exclusivamente para reportes de consola / mensajes de texto del motor;
 * el formateo definitivo de UI se resuelve en la etapa de interfaz.
 * @param {number|null} value
 * @returns {string}
 */
export function formatNumber(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'S/D';
  return Math.round(value).toLocaleString('es-AR');
}

/**
 * debounce simple: agrupa llamadas sucesivas en una sola, tras un período de
 * inactividad. Se deja disponible para la etapa de interfaz (por ejemplo, para
 * inputs de texto en filtros), pero el motor en sí no depende de esta función.
 * @param {Function} fn
 * @param {number} delayMs
 * @returns {Function}
 */
export function debounce(fn, delayMs = 250) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delayMs);
  };
}

/**
 * Genera un identificador de suscripción incremental simple, usado por state.js
 * para poder dar de baja una suscripción puntual.
 */
export function createIdGenerator() {
  let next = 1;
  return () => next++;
}

/**
 * Mediana de un array simple de números -- distinto de percentileOfSorted()
 * (stats.js), que trabaja sobre observaciones crudas dentro del pipeline de
 * ventanas. Esta es la versión genérica para cualquier lista de números ya
 * calculados (ej. las medianas de varias combinaciones ya resueltas), sin
 * depender de nada del dominio agronómico. No existía nada equivalente en
 * el producto antes de esta función.
 * @param {number[]} values
 * @returns {number|null}
 */
export function medianOf(values) {
  const limpios = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v)).sort((a, b) => a - b);
  if (limpios.length === 0) return null;
  const mid = Math.floor(limpios.length / 2);
  return limpios.length % 2 === 0 ? (limpios[mid - 1] + limpios[mid]) / 2 : limpios[mid];
}
