// ============================================================================
// data-loader.js
// Responsable EXCLUSIVO de la etapa CSV -> dataset validado y normalizado.
// Ningún otro módulo debe leer el CSV ni conocer sus nombres de columna
// originales: todo lo que sale de acá ya usa el esquema interno estable
// definido en INTERNAL_SCHEMA.
//
// Filosofía: el motor no confía ciegamente en el formato de origen. La base
// BS_SOJA_AC tuvo, a lo largo de varias auditorías, columnas numéricas
// exportadas como texto con coma decimal y categorías con variantes de
// mayúsculas/espacios. Este loader normaliza de forma defensiva en vez de
// asumir que el CSV de turno ya viene perfecto.
// ============================================================================

import { parseFlexibleNumber, parseFlexibleDate, normalizeCategory } from './utils.js';
import { estaDentroDelPeriodoAnalizado, PERIODO_ANALIZADO } from './stats.js';

// ---------------------------------------------------------------------------
// Esquema: nombre de columna en el CSV de origen -> clave interna estable.
// Si el nombre de una columna cambia en una futura actualización de la base,
// este es el ÚNICO lugar que hay que tocar.
// ---------------------------------------------------------------------------
const COLUMN_MAP = {
  'Campaña': 'campana',
  'ENSO': 'enso',
  'Región': 'region',
  'Departamento/Partido': 'departamento',
  'Localidad': 'localidad',
  'Zona': 'zona',
  'Cultivo': 'cultivo',
  'Subgrupo': 'subgrupo',
  '1°/2°': 'ocupacion',
  'Superficie Sembrada': 'superficieSembrada',
  'Superficie Cosechada': 'superficieCosechada',
  'Destino': 'destino',
  'Rendimiento': 'rendimiento',
  'Antecesor': 'antecesor',
  'Genética': 'genetica',
  'Ciclo_OK': 'ciclo',
  'Fecha de siembra (dd/mm/aaaa)': 'fechaSiembraRaw',
  'Agua al inicio': 'aguaInicio',
  'Riego': 'riego',
  'Sistema de riego': 'sistemaRiego',
  'Lámina de riego': 'laminaRiego',
  'Precipitaciones ciclo (sept-abril)': 'precipitaciones',
  'Fertilización': 'fertilizacion',
};

// Columnas sin las cuales una fila no es utilizable por el explorador.
// No exigimos TODAS las columnas del CSV como obligatorias -- varias son
// legítimamente sparse por diseño (riego, agua al inicio, etc., según la
// auditoría de datos). Solo lo mínimo indispensable para ubicar una
// observación en el eje del explorador (fecha) y para poder graficarla
// (rendimiento).
const REQUIRED_INTERNAL_FIELDS = ['fechaSiembraRaw', 'rendimiento', 'campana'];

const CATEGORY_FIELDS = [
  'campana', 'enso', 'region', 'departamento', 'localidad', 'zona',
  'cultivo', 'subgrupo', 'ocupacion', 'destino', 'antecesor', 'genetica',
  'ciclo', 'riego', 'sistemaRiego', 'fertilizacion',
];

const NUMERIC_FIELDS = [
  'superficieSembrada', 'superficieCosechada', 'rendimiento',
  'aguaInicio', 'laminaRiego', 'precipitaciones',
];

// ---------------------------------------------------------------------------
// Parser de CSV, sin dependencias externas.
// Soporta campos entre comillas dobles (incluida coma y comillas escapadas
// como "" dentro de un campo entrecomillado), que es lo que puede aparecer
// en columnas de texto libre exportadas desde Excel.
// ---------------------------------------------------------------------------
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let insideQuotes = false;

  // Normaliza saltos de línea de Windows antes de recorrer caracter a caracter.
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const char = src[i];

    if (insideQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          insideQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      insideQuotes = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += char;
  }
  // última celda / última fila, si el archivo no termina con salto de línea
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // descarta filas totalmente vacías (típico al final del archivo)
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/**
 * Carga y procesa el CSV de origen: parsea, valida y normaliza.
 * @param {string} csvText contenido crudo del archivo CSV
 * @returns {{records: object[], audit: object}}
 */
export function loadDataset(csvText) {
  const rawRows = parseCSV(csvText);
  if (rawRows.length === 0) {
    throw new Error('El archivo CSV está vacío o no se pudo interpretar.');
  }

  const header = rawRows[0].map((h) => h.trim());
  const dataRows = rawRows.slice(1);

  const audit = {
    totalFilasCSV: dataRows.length,
    columnasEsperadas: Object.keys(COLUMN_MAP),
    columnasFaltantes: [],
    columnasNoReconocidas: [],
    filasValidas: 0,
    filasDescartadas: 0,
    motivosDescartadas: {}, // motivo -> cantidad
    fechasInvalidas: 0,
    fechasFueraDeRangoAnalizado: 0, // fuera del período analizado (ver PERIODO_ANALIZADO en stats.js), pero válidas
    numerosNoConvertibles: {}, // campo -> cantidad de valores no convertibles (no se descarta la fila por esto salvo Rendimiento)
  };
  NUMERIC_FIELDS.forEach((f) => { audit.numerosNoConvertibles[f] = 0; });

  // --- Validación de columnas esperadas ---
  const headerSet = new Set(header);
  Object.keys(COLUMN_MAP).forEach((expected) => {
    if (!headerSet.has(expected)) audit.columnasFaltantes.push(expected);
  });
  header.forEach((h) => {
    if (!(h in COLUMN_MAP)) audit.columnasNoReconocidas.push(h);
  });

  if (audit.columnasFaltantes.length > 0) {
    throw new Error(
      `Faltan columnas obligatorias en el CSV: ${audit.columnasFaltantes.join(', ')}`
    );
  }

  // índice de columna por clave interna, para no buscar por nombre en cada fila
  const columnIndexByInternalKey = {};
  header.forEach((originalName, idx) => {
    const internalKey = COLUMN_MAP[originalName];
    if (internalKey) columnIndexByInternalKey[internalKey] = idx;
  });

  const records = [];

  dataRows.forEach((rawRow, rowNumber) => {
    // fila vacía o con una sola celda vacía -> se ignora sin contar como descarte
    if (rawRow.length === 1 && rawRow[0].trim() === '') return;

    const record = {};
    Object.entries(columnIndexByInternalKey).forEach(([internalKey, idx]) => {
      record[internalKey] = rawRow[idx] !== undefined ? rawRow[idx] : '';
    });

    // --- validación de campos mínimos obligatorios ---
    const missingRequired = REQUIRED_INTERNAL_FIELDS.filter((f) => {
      const v = record[f];
      return v === undefined || v === null || String(v).trim() === '';
    });
    if (missingRequired.length > 0) {
      audit.filasDescartadas++;
      const motivo = `Sin dato en campo obligatorio: ${missingRequired.join(', ')}`;
      audit.motivosDescartadas[motivo] = (audit.motivosDescartadas[motivo] || 0) + 1;
      return;
    }

    // --- fecha ---
    const fecha = parseFlexibleDate(record.fechaSiembraRaw);
    if (!fecha) {
      audit.filasDescartadas++;
      audit.fechasInvalidas++;
      const motivo = 'Fecha de siembra inválida o no interpretable';
      audit.motivosDescartadas[motivo] = (audit.motivosDescartadas[motivo] || 0) + 1;
      return;
    }

    // --- rendimiento (obligatorio y numérico) ---
    const rendimiento = parseFlexibleNumber(record.rendimiento);
    if (rendimiento === null) {
      audit.filasDescartadas++;
      audit.numerosNoConvertibles.rendimiento++;
      const motivo = 'Rendimiento no numérico o vacío';
      audit.motivosDescartadas[motivo] = (audit.motivosDescartadas[motivo] || 0) + 1;
      return;
    }

    // --- resto de campos numéricos: se normalizan, no descartan la fila ---
    const numericValues = {};
    NUMERIC_FIELDS.forEach((f) => {
      if (f === 'rendimiento') { numericValues[f] = rendimiento; return; }
      const parsed = parseFlexibleNumber(record[f]);
      if (parsed === null && String(record[f]).trim() !== '') {
        audit.numerosNoConvertibles[f]++;
      }
      numericValues[f] = parsed;
    });

    // --- categorías: normalizadas, S/D se conserva como categoría válida ---
    const categoryValues = {};
    CATEGORY_FIELDS.forEach((f) => {
      categoryValues[f] = normalizeCategory(record[f]);
    });

    // --- campos derivados de fecha ---
    const mes = fecha.getMonth() + 1; // 1-12
    const dia = fecha.getDate();
    const dentroDeRangoAnalizado = estaDentroDelPeriodoAnalizado(mes, dia);
    if (!dentroDeRangoAnalizado) audit.fechasFueraDeRangoAnalizado++;

    const finalRecord = {
      ...categoryValues,
      ...numericValues,
      fechaSiembra: fecha,
      fechaSiembraMes: mes,
      fechaSiembraDia: dia,
      fechaFueraDeRangoAnalizado: !dentroDeRangoAnalizado,
      // campos booleanos derivados, útiles para filtros/analítica sin volver
      // a interpretar el string cada vez
      tieneRiego: categoryValues.riego === 'SI' ? true : categoryValues.riego === 'NO' ? false : null,
      tieneFertilizacion:
        categoryValues.fertilizacion === 'CON FERTILIZACIÓN' ? true
          : categoryValues.fertilizacion === 'SIN FERTILIZACIÓN' ? false
            : null, // S/D u otro valor no reconocido -> desconocido, nunca false
    };

    records.push(finalRecord);
    audit.filasValidas++;
  });

  return { records, audit };
}

/**
 * Imprime el reporte de auditoría de la carga en consola, en un formato
 * legible. No lanza errores; es puramente informativo.
 * @param {object} audit
 */
export function printAuditReport(audit) {
  const line = '─'.repeat(60);
  console.log(line);
  console.log('AC SOJA 25-26 · Reporte de auditoría de carga de datos');
  console.log(line);
  console.log(`Filas totales en el CSV (sin encabezado): ${audit.totalFilasCSV}`);
  console.log(`Filas válidas incorporadas al motor:       ${audit.filasValidas}`);
  console.log(`Filas descartadas:                         ${audit.filasDescartadas}`);
  if (Object.keys(audit.motivosDescartadas).length > 0) {
    console.log('  Motivos de descarte:');
    Object.entries(audit.motivosDescartadas).forEach(([motivo, cantidad]) => {
      console.log(`    - ${motivo}: ${cantidad}`);
    });
  }
  console.log(`Fechas fuera del rango analizado (fuera de ${PERIODO_ANALIZADO.inicio.dia}/${PERIODO_ANALIZADO.inicio.mes} - ${PERIODO_ANALIZADO.fin.dia}/${PERIODO_ANALIZADO.fin.mes}), pero válidas: ${audit.fechasFueraDeRangoAnalizado}`);
  console.log('Valores numéricos no convertibles por campo (no descartan la fila, salvo Rendimiento):');
  Object.entries(audit.numerosNoConvertibles).forEach(([campo, cantidad]) => {
    if (cantidad > 0) console.log(`    - ${campo}: ${cantidad}`);
  });
  if (audit.columnasNoReconocidas.length > 0) {
    console.log(`Columnas presentes en el CSV pero no usadas por el motor: ${audit.columnasNoReconocidas.join(', ')}`);
  }
  console.log(line);
}

export const INTERNAL_SCHEMA = {
  COLUMN_MAP,
  CATEGORY_FIELDS,
  NUMERIC_FIELDS,
  REQUIRED_INTERNAL_FIELDS,
};
