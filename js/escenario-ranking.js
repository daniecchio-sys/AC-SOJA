// ============================================================================
// escenario-ranking.js
// Ranking de combinaciones según el criterio seleccionado (Sección 6.2 del
// documento funcional v2 de Escenarios). Componente nuevo, exclusivo de
// este módulo -- no tiene equivalente en Explorar ni Comparar.
// ============================================================================

import { MIN_OBS_KPI } from './stats.js';
import { clave } from './escenario-dispersion.js';

// Los 5 criterios exactos del documento v2, en este orden. `dir` define el
// sentido de orden por defecto de cada uno: todos descendente salvo
// Dispersión relativa (Sección 6.2 v2: "única de las cinco que ordena
// ascendente por defecto -- menor dispersión es la lectura relevante").
export const CRITERIOS_PRIORIZACION = [
  { key: 'mediana', label: 'Mediana', dir: 'desc', mensaje: 'Las combinaciones con mayor mediana aparecen primero.' },
  { key: 'p25', label: 'Piso productivo (P25)', dir: 'desc', mensaje: 'Las combinaciones con mayor piso productivo aparecen primero.' },
  { key: 'p75', label: 'Potencial observado (P75)', dir: 'desc', mensaje: 'Las combinaciones con mayor potencial observado aparecen primero.' },
  { key: 'dispersionRelativa', label: 'Dispersión relativa', dir: 'asc', mensaje: 'Las combinaciones con menor dispersión relativa aparecen primero.' },
  { key: 'n', label: 'Número de lotes evaluados (n)', dir: 'desc', mensaje: 'Las combinaciones con mayor respaldo histórico aparecen primero.' },
];

export const CRITERIO_INICIAL = 'mediana';
export const FILAS_INICIALES = 10;

function nombreLegibleCiclo(ciclo) {
  return ciclo === 'S/D' ? 'Sin dato' : ciclo;
}

/**
 * Ordena rankingElegible (motor) según el criterio activo. Pura
 * responsabilidad de presentación -- el motor entrega la lista sin orden,
 * distintos criterios de lectura no ameritan recalcular nada del lado del
 * motor, solo reordenar el mismo array.
 * @param {Array} rankingElegible
 * @param {string} criterioKey
 * @returns {Array}
 */
export function ordenarRanking(rankingElegible, criterioKey) {
  const criterio = CRITERIOS_PRIORIZACION.find((c) => c.key === criterioKey) || CRITERIOS_PRIORIZACION[0];
  const signo = criterio.dir === 'asc' ? 1 : -1;
  return [...rankingElegible].sort((a, b) => signo * (a[criterio.key] - b[criterio.key]));
}

/**
 * Renderiza el bloque completo: encabezado, selector, mensaje dinámico,
 * tabla (10 filas o todas) y la acción de expandir/contraer.
 * @param {HTMLElement} container
 * @param {object} params
 * @param {Array} params.rankingElegible snapshot.rankingElegible (motor, sin ordenar)
 * @param {string} params.criterioActivo key de CRITERIOS_PRIORIZACION
 * @param {boolean} params.expandido
 * @param {(criterioKey:string)=>void} params.onCambiarCriterio
 * @param {()=>void} params.onToggleExpandir
 * @param {(clave:string|null)=>void} [params.onHoverFila] hover sincronizado con el gráfico de dispersión (misma combinación Ventana×Ciclo)
 */
export function renderRanking(container, { rankingElegible, criterioActivo, expandido, onCambiarCriterio, onToggleExpandir, onHoverFila }) {
  container.innerHTML = '';

  const encabezado = document.createElement('div');
  encabezado.className = 'ranking-encabezado';
  encabezado.innerHTML = `
    <h3 class="ranking-titulo">Ranking de combinaciones según el criterio seleccionado</h3>
    <p class="ranking-subtitulo">Analizar estrategias</p>
    <p class="ranking-pregunta">¿Qué atributo desea priorizar para analizar las estrategias?</p>
  `;
  container.appendChild(encabezado);

  if (rankingElegible.length === 0) {
    const vacio = document.createElement('p');
    vacio.className = 'ranking-vacio';
    vacio.textContent = `No hay combinaciones de estrategia con al menos ${MIN_OBS_KPI} observaciones para este ambiente.`;
    container.appendChild(vacio);
    return;
  }

  // ---- selector "Priorizar según" ----
  const selectorWrap = document.createElement('div');
  selectorWrap.className = 'ranking-selector';
  const label = document.createElement('label');
  label.setAttribute('for', 'ranking-priorizar-select');
  label.textContent = 'Priorizar según:';
  const select = document.createElement('select');
  select.id = 'ranking-priorizar-select';
  CRITERIOS_PRIORIZACION.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.key;
    opt.textContent = c.label;
    if (c.key === criterioActivo) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => onCambiarCriterio(select.value));
  selectorWrap.append(label, select);
  container.appendChild(selectorWrap);

  // ---- mensaje contextual dinámico ----
  const criterio = CRITERIOS_PRIORIZACION.find((c) => c.key === criterioActivo) || CRITERIOS_PRIORIZACION[0];
  const mensaje = document.createElement('p');
  mensaje.className = 'ranking-mensaje-dinamico';
  mensaje.textContent = criterio.mensaje;
  container.appendChild(mensaje);

  // ---- tabla ----
  const ordenado = ordenarRanking(rankingElegible, criterioActivo);
  const totalElegibles = ordenado.length;
  const filasAMostrar = expandido ? ordenado : ordenado.slice(0, FILAS_INICIALES);

  const tabla = document.createElement('table');
  tabla.className = 'tabla-ranking';
  tabla.innerHTML = `
    <thead>
      <tr><th>Fecha de siembra</th><th>Ciclo</th><th>n</th><th>Mediana</th><th>P25</th><th>P75</th><th>Disp. relativa</th></tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = tabla.querySelector('tbody');
  filasAMostrar.forEach((c) => {
    const tr = document.createElement('tr');
    tr.setAttribute('data-combo-key', clave(c));
    tr.innerHTML = `
      <td>${c.windowLabel}</td>
      <td>${nombreLegibleCiclo(c.ciclo)}</td>
      <td>${c.n}</td>
      <td>${Math.round(c.mediana).toLocaleString('es-AR')}</td>
      <td>${Math.round(c.p25).toLocaleString('es-AR')}</td>
      <td>${Math.round(c.p75).toLocaleString('es-AR')}</td>
      <td>${c.dispersionRelativa !== null ? `${c.dispersionRelativa}%` : '—'}</td>
    `;
    if (onHoverFila) {
      tr.addEventListener('mouseenter', () => onHoverFila(clave(c)));
      tr.addEventListener('mouseleave', () => onHoverFila(null));
    }
    tbody.appendChild(tr);
  });
  container.appendChild(tabla);

  // ---- expandir / contraer -- solo si hay más de FILAS_INICIALES ----
  if (totalElegibles > FILAS_INICIALES) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'ranking-expandir';
    boton.textContent = expandido ? 'Mostrar menos' : `Mostrar todas las combinaciones (${totalElegibles})`;
    boton.addEventListener('click', onToggleExpandir);
    container.appendChild(boton);
  }

  if (totalElegibles < 5) {
    const nota = document.createElement('p');
    nota.className = 'ranking-nota-pocas';
    nota.textContent = `Hay menos de 5 combinaciones con evidencia suficiente (n≥${MIN_OBS_KPI}) para este ambiente.`;
    container.appendChild(nota);
  }
}
