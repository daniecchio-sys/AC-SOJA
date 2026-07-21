// ============================================================================
// filters.js
// Lógica de filtrado, pura (sin DOM). Los filtros son SIEMPRE acumulativos:
// AND entre distintos campos, OR dentro de un mismo campo multi-selección.
//
// No define la interfaz de los controles (eso es la próxima etapa) — define
// qué campos son filtrables, de qué tipo, y cómo se aplican sobre el dataset
// normalizado que entrega data-loader.js.
// ============================================================================

/**
 * Catálogo de campos filtrables. `type: 'in'` = selección múltiple sobre
 * valores categóricos ya normalizados. `type: 'range'` = filtro numérico de
 * mínimo/máximo. Agregar un filtro nuevo en el futuro es sumar una entrada
 * acá; ningún otro módulo necesita cambiar.
 */
// Nota de dependencia: filters.js importa diaDeTemporada de stats.js para el
// filtro 'daterange' (selección directa sobre el gráfico). Es una dependencia
// nueva y puntual, igual de justificada que la que ya tiene data-loader.js:
// la alternativa era reimplementar el cálculo de "día de temporada" acá,
// duplicando lógica que ya vive en un solo lugar por diseño.
import { diaDeTemporada } from './stats.js';

/**
 * Catálogo de campos filtrables. `type: 'in'` = selección múltiple sobre
 * valores categóricos ya normalizados. `type: 'range'` = filtro numérico de
 * mínimo/máximo. Agregar un filtro nuevo en el futuro es sumar una entrada
 * acá; ningún otro módulo necesita cambiar.
 */
export const FILTERABLE_FIELDS = [
  { key: 'campana', type: 'in', label: 'Campaña' },
  { key: 'enso', type: 'in', label: 'ENSO' },
  { key: 'departamento', type: 'in', label: 'Departamento' },
  { key: 'localidad', type: 'in', label: 'Localidad' },
  { key: 'zona', type: 'in', label: 'Zona' },
  { key: 'subgrupo', type: 'in', label: 'Subgrupo (OGM / No OGM)' },
  { key: 'ocupacion', type: 'in', label: 'Ocupación (1°/2°)' },
  { key: 'antecesor', type: 'in', label: 'Antecesor' },
  { key: 'genetica', type: 'in', label: 'Genética' },
  { key: 'ciclo', type: 'in', label: 'Ciclo' },
  { key: 'riego', type: 'in', label: 'Riego' },
  { key: 'sistemaRiego', type: 'in', label: 'Sistema de riego' },
  { key: 'fertilizacion', type: 'in', label: 'Fertilización' },
  { key: 'superficieSembrada', type: 'range', label: 'Superficie sembrada (ha)' },
  { key: 'precipitaciones', type: 'range', label: 'Precipitaciones del ciclo (mm)' },
  { key: 'aguaInicio', type: 'range', label: 'Agua al inicio (mm)' },
  { key: 'laminaRiego', type: 'range', label: 'Lámina de riego (mm)' },
  // 'daterange' -- agregado para la exploración directa sobre el gráfico
  // (seleccionar un tramo del calendario con el mouse y convertirlo en una
  // condición más). Compara por "día de temporada" (relativo, cruza
  // campañas), no por fecha absoluta -- ver diaDeTemporada() en stats.js.
  // No reemplaza a las 21 ventanas fijas del motor: es un recorte adicional
  // e independiente sobre el mismo eje temporal.
  { key: 'temporada', type: 'daterange', label: 'Tramo del calendario de siembra' },
];

const FIELD_BY_KEY = new Map(FILTERABLE_FIELDS.map((f) => [f.key, f]));

/**
 * Devuelve un objeto de filtros vacío (sin ninguna restricción activa).
 * @returns {object}
 */
export function createEmptyFilters() {
  return {};
}

/**
 * Aplica el conjunto de filtros activos sobre el dataset normalizado.
 * Un filtro ausente del objeto `filters`, o con lista de valores vacía, o
 * con min/max ambos nulos, se considera inactivo y no restringe nada.
 * @param {object[]} records dataset normalizado (salida de data-loader.js)
 * @param {object} filters ej: { campana: { type:'in', values:['2024-25'] }, superficieSembrada: { type:'range', min:20, max:100 } }
 * @returns {object[]}
 */
export function applyFilters(records, filters) {
  const activeEntries = Object.entries(filters || {}).filter(([key, condition]) => {
    if (!condition) return false;
    if (condition.type === 'in') return Array.isArray(condition.values) && condition.values.length > 0;
    if (condition.type === 'range') return condition.min !== null && condition.min !== undefined
      || condition.max !== null && condition.max !== undefined;
    if (condition.type === 'daterange') return condition.startDia !== null && condition.startDia !== undefined
      || condition.endDia !== null && condition.endDia !== undefined;
    return false;
  });

  if (activeEntries.length === 0) return records.slice();

  return records.filter((record) =>
    activeEntries.every(([key, condition]) => {
      if (condition.type === 'daterange') {
        const dia = diaDeTemporada(record.fechaSiembraMes, record.fechaSiembraDia);
        if (dia === null) return false; // fuera del período analizado: no matchea ningún tramo del calendario
        if (condition.startDia !== null && condition.startDia !== undefined && dia < condition.startDia) return false;
        if (condition.endDia !== null && condition.endDia !== undefined && dia > condition.endDia) return false;
        return true;
      }
      const value = record[key];
      if (condition.type === 'in') {
        return condition.values.includes(value);
      }
      if (condition.type === 'range') {
        if (value === null || value === undefined) return false;
        if (condition.min !== null && condition.min !== undefined && value < condition.min) return false;
        if (condition.max !== null && condition.max !== undefined && value > condition.max) return false;
        return true;
      }
      return true;
    })
  );
}

/**
 * Devuelve la lista de valores distintos disponibles para un campo
 * categórico, ordenados alfabéticamente, excluyendo nulos. Pensado para que
 * la futura interfaz arme las opciones de cada selector.
 *
 * Por diseño, las opciones se calculan sobre `records` tal como se le pase —
 * si se le pasa el dataset completo, las opciones son fijas; si se le pasa
 * el subconjunto ya filtrado por los DEMÁS filtros activos, las opciones se
 * acotan dinámicamente. Esa decisión de UX queda para la etapa de interfaz;
 * esta función sirve para ambos casos.
 * @param {object[]} records
 * @param {string} fieldKey
 * @returns {string[]}
 */
export function getDistinctValues(records, fieldKey) {
  const field = FIELD_BY_KEY.get(fieldKey);
  if (!field || field.type !== 'in') return [];
  const values = new Set();
  records.forEach((r) => {
    if (r[fieldKey] !== null && r[fieldKey] !== undefined) values.add(r[fieldKey]);
  });
  return Array.from(values).sort((a, b) => a.localeCompare(b, 'es'));
}

/**
 * Cuenta observaciones por valor distinto de un campo categórico, ordenado
 * por mayor n y, en caso de empate, alfabéticamente. Utilidad genérica (no
 * específica de "Material") -- getDistinctValues() ya existía para listar
 * valores sin conteo; esta es la variante con conteo que hacía falta para
 * el filtro dinámico de Material (Explorar), reutilizable por cualquier
 * campo 'in' que en el futuro necesite lo mismo.
 * @param {object[]} records
 * @param {string} fieldKey
 * @returns {{valor:string, n:number}[]}
 */
export function contarValoresDistintos(records, fieldKey) {
  const field = FIELD_BY_KEY.get(fieldKey);
  if (!field || field.type !== 'in') return [];
  const conteo = new Map();
  records.forEach((r) => {
    const v = r[fieldKey];
    if (v === null || v === undefined) return;
    conteo.set(v, (conteo.get(v) || 0) + 1);
  });
  return Array.from(conteo.entries())
    .map(([valor, n]) => ({ valor, n }))
    .sort((a, b) => b.n - a.n || a.valor.localeCompare(b.valor, 'es'));
}

/**
 * Devuelve el rango [min, max] real presente en los datos para un campo
 * numérico filtrable. Útil para que la interfaz fije los extremos de un
 * control de rango (slider, inputs min/max).
 * @param {object[]} records
 * @param {string} fieldKey
 * @returns {{min: number, max: number}|null}
 */
export function getRangeBounds(records, fieldKey) {
  const field = FIELD_BY_KEY.get(fieldKey);
  if (!field || field.type !== 'range') return null;
  const values = records
    .map((r) => r[fieldKey])
    .filter((v) => v !== null && v !== undefined);
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * Cuenta cuántos filtros están efectivamente activos (no vacíos). Útil para
 * mostrar, por ejemplo, un contador tipo "3 filtros activos" en la interfaz.
 * @param {object} filters
 * @returns {number}
 */
export function countActiveFilters(filters) {
  return Object.values(filters || {}).filter((condition) => {
    if (!condition) return false;
    if (condition.type === 'in') return Array.isArray(condition.values) && condition.values.length > 0;
    if (condition.type === 'range') return condition.min !== null && condition.min !== undefined
      || condition.max !== null && condition.max !== undefined;
    if (condition.type === 'daterange') return condition.startDia !== null && condition.startDia !== undefined
      || condition.endDia !== null && condition.endDia !== undefined;
    return false;
  }).length;
}
