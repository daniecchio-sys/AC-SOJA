// ============================================================================
// escenario-indicadores-destacados.js
// "Indicadores destacados" -- reemplaza al bloque textual "¿Qué muestran
// estos datos?" como elemento principal (ronda de reorganización visual).
// Cinco KPIs independientes, cada uno resaltando un atributo distinto de
// las estrategias evaluadas -- ninguno implica que exista una única
// estrategia superior a las demás.
//
// Regla de evidencia (idéntica a la del ranking, Sección 6.2 v2): los cinco
// se calculan EXCLUSIVAMENTE sobre snapshot.rankingElegible, que el motor
// ya filtra a n >= MIN_OBS_KPI -- no se relaja ese criterio acá. Si no hay
// ninguna combinación elegible, cada indicador lo dice explícitamente en
// vez de mostrar un valor con evidencia insuficiente.
// ============================================================================

// Los 5 criterios -- 4 del mínimo pedido (mediana, P25, dispersión relativa,
// n) + potencial observado (P75), que también necesitaba quedar resuelto
// con la misma regla de evidencia. `dir` define qué extremo se destaca:
// todos el máximo, salvo dispersión relativa (mínimo -- menor dispersión es
// la lectura relevante, mismo criterio ya usado en el ranking).
const CRITERIOS_DESTACADOS = [
  { key: 'mediana', label: 'Mayor mediana observada', dir: 'desc', unidad: 'kg/ha' },
  { key: 'p25', label: 'Mayor piso productivo (P25)', dir: 'desc', unidad: 'kg/ha' },
  { key: 'p75', label: 'Mayor potencial observado (P75)', dir: 'desc', unidad: 'kg/ha' },
  { key: 'dispersionRelativa', label: 'Menor dispersión relativa', dir: 'asc', unidad: '%' },
  { key: 'n', label: 'Mayor respaldo histórico (n)', dir: 'desc', unidad: 'lotes' },
];

function nombreLegibleCiclo(ciclo) {
  return ciclo === 'S/D' ? 'Sin dato' : ciclo;
}

function formatearValor(valor, unidad) {
  if (unidad === '%') return `${valor}%`;
  if (unidad === 'lotes') return `${valor.toLocaleString('es-AR')} lotes`;
  return `${Math.round(valor).toLocaleString('es-AR')} kg/ha`;
}

/**
 * Renderiza los 5 indicadores destacados dentro de `container`.
 * @param {HTMLElement} container
 * @param {object} params
 * @param {Array} params.rankingElegible snapshot.rankingElegible (motor, ya filtrado a n>=MIN_OBS_KPI)
 */
export function renderIndicadoresDestacados(container, { rankingElegible }) {
  container.innerHTML = '';

  CRITERIOS_DESTACADOS.forEach(({ key, label, dir, unidad }) => {
    const card = document.createElement('div');
    card.className = 'kpi-destacado';

    if (rankingElegible.length === 0) {
      card.innerHTML = `
        <div class="kpi-destacado-titulo">${label}</div>
        <div class="kpi-destacado-vacio">No existe evidencia suficiente para generar este indicador.</div>
      `;
      container.appendChild(card);
      return;
    }

    const signo = dir === 'asc' ? 1 : -1;
    const destacada = [...rankingElegible].sort((a, b) => signo * (a[key] - b[key]))[0];

    card.innerHTML = `
      <div class="kpi-destacado-titulo">${label}</div>
      <div class="kpi-destacado-valor">${formatearValor(destacada[key], unidad)}</div>
      <div class="kpi-destacado-detalle">${destacada.windowLabel} · ${nombreLegibleCiclo(destacada.ciclo)}</div>
    `;
    container.appendChild(card);
  });
}
