// ============================================================================
// home-app.js
// Calcula en vivo la ficha descriptiva de la base ("La información detrás
// del análisis") -- nunca cifras hardcodeadas. Reutiliza loadDataset()
// (data-loader.js) sin modificarlo, igual que el resto del producto.
// ============================================================================

import { loadDataset } from './data-loader.js';

function distintos(records, campo) {
  return new Set(records.map((r) => r[campo]).filter((v) => v !== null && v !== undefined)).size;
}

export async function cargarFichaDeLaBase() {
  try {
    const csvText = await fetch('data/ac_soja.csv').then((r) => r.text());
    const { records } = loadDataset(csvText);

    const valores = {
      campanas: distintos(records, 'campana'),
      registros: records.length,
      localidades: distintos(records, 'localidad'),
      ambientes: distintos(records, 'zona'),
      ciclos: distintos(records, 'ciclo'),
    };

    Object.entries(valores).forEach(([campo, valor]) => {
      const el = document.querySelector(`.ficha-valor[data-campo="${campo}"]`);
      if (el) {
        el.textContent = valor.toLocaleString('es-AR');
        el.classList.remove('ficha-cargando');
      }
    });

    return valores;
  } catch (err) {
    const nota = document.getElementById('ficha-nota');
    if (nota) nota.style.display = '';
    throw err;
  }
}

cargarFichaDeLaBase();
