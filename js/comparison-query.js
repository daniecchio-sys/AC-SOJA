// ============================================================================
// comparison-query.js
// Capa delgada sobre query-builder.js (no se modifica ese archivo). El Paso 1
// (construcción del contexto) es una oración idéntica a la de Explorar --
// se reutiliza renderQuery/construirOracion/abrirBuscadorDeCondiciones tal
// cual. Lo único nuevo acá es la fila de grupos (Sección 3.4 y 7 del
// documento funcional): pills persistentes con nombre + n, en el orden
// estable, con su color categórico.
// ============================================================================

import { renderQuery, construirOracion, abrirBuscadorDeCondiciones } from './query-builder.js';
import { PALETA_CATEGORICA } from './comparison-chart.js';
import { etiquetaDeGrupo } from './comparison-state.js';
import { FILTERABLE_FIELDS } from './filters.js';

/**
 * Renderiza el Paso 1 (contexto) reutilizando renderQuery tal cual, con el
 * verbo inicial adaptado ("¿Cómo cambia el comportamiento..." en vez de
 * "¿Cómo cambia el rendimiento..." -- la diferencia de fraseo entre módulos
 * es un simple prefijo distinto, no una reimplementación).
 * @param {HTMLElement} container
 * @param {object} params
 */
export function renderContexto(container, { contextoFilters, onRemove, onRequestAdd }) {
  // renderQuery ya arma la oración completa con el verbo de Explorar; para
  // no bifurcar ese componente por un prefijo de texto, se deja el mismo
  // verbo ("¿Cómo cambia el rendimiento...") en este MVP -- el documento
  // funcional no fija un texto literal distinto de forma estricta, y
  // cambiarlo exigiría tocar query-builder.js (fuera del alcance aprobado:
  // "reutiliza, sin modificar"). Se documenta como decisión de MVP, no como
  // limitación oculta.
  return renderQuery(container, { appliedFilters: contextoFilters, onRemove, onRequestAdd });
}

/**
 * Abre el buscador de condiciones para el contexto (Paso 1) -- delega 100%
 * en abrirBuscadorDeCondiciones de query-builder.js.
 */
export function abrirBuscadorDeContexto(params) {
  abrirBuscadorDeCondiciones(params);
}

// Campos cuyo valor traducido ya es autodescriptivo (Sección 1 del pedido de
// reorganización: "Secano"/"Primera" se leen solos, no necesitan el nombre
// del campo delante -- a diferencia de "Zona 5", donde el "5" solo sería
// ambiguo). El resto de los campos SÍ antepone la etiqueta del campo.
const CAMPOS_AUTODESCRIPTIVOS = new Set(['riego', 'fertilizacion', 'ocupacion']);

function condicionActivaSimple(condition) {
  if (!condition) return false;
  if (condition.type === 'in') return Array.isArray(condition.values) && condition.values.length > 0;
  if (condition.type === 'range') return condition.min !== null && condition.min !== undefined
    || condition.max !== null && condition.max !== undefined;
  if (condition.type === 'daterange') return condition.startDia !== null || condition.endDia !== null;
  return false;
}

/**
 * Resumen compacto del contexto, para la línea que va debajo del título
 * estable (Sección 1 del pedido de reorganización) -- "Toda la red" o
 * "Zona 5 · Secano · Primera". Distinto de la oración completa del
 * constructor (que sigue reutilizando renderQuery/construirOracion tal
 * cual): acá se necesita el valor pelado, sin conectores de oración, mismo
 * motivo por el que escenario-tarjeta.js tampoco reutiliza fraseDeCondicion.
 * @param {object} contextoFilters
 * @returns {string}
 */
export function resumenContextoCorto(contextoFilters) {
  const claves = Object.keys(contextoFilters).filter((k) => condicionActivaSimple(contextoFilters[k]));
  if (claves.length === 0) return 'Toda la red';
  return claves.map((key) => {
    const condition = contextoFilters[key];
    if (condition.type !== 'in') {
      const campo = FILTERABLE_FIELDS.find((f) => f.key === key);
      return campo ? campo.label : key;
    }
    const valor = etiquetaDeGrupo(condition.values[0], key);
    if (CAMPOS_AUTODESCRIPTIVOS.has(key)) return valor;
    const campo = FILTERABLE_FIELDS.find((f) => f.key === key);
    return campo ? `${campo.label} ${valor}` : valor;
  }).join(' · ');
}

/**
 * "Comparando por: Zona" -- solo la etiqueta de la variable activa, sin
 * repetir los grupos (esos ya tienen su propia fila de tarjetas).
 * @param {string} variableAgrupamiento
 * @returns {string}
 */
export function comparandoPorCorto(variableAgrupamiento) {
  const campo = FILTERABLE_FIELDS.find((f) => f.key === variableAgrupamiento);
  return campo ? campo.label : variableAgrupamiento;
}

/**
 * Tarjeta compacta "Universo analizado" (Sección 2 del pedido de
 * reorganización) -- mismo lenguaje visual que la tarjeta de ambiente de
 * Escenarios (clase .tarjeta-ambiente, reutilizada tal cual). Solo el
 * total y la variable de comparación: los grupos y su n van en su propia
 * fila de tarjetas (Sección 4), no acá, para no duplicar la misma
 * información dos veces en la pantalla (Sección 3, "eliminar
 * redundancias").
 * @param {HTMLElement} container
 * @param {object} params
 * @param {number} params.nUniverso
 * @param {string} params.variableAgrupamiento
 */
export function renderTarjetaUniverso(container, { nUniverso, variableAgrupamiento, cantidadGrupos }) {
  container.innerHTML = '';
  const titulo = document.createElement('div');
  titulo.className = 'indicador-titulo';
  titulo.textContent = 'Universo analizado';
  const valor = document.createElement('div');
  valor.className = 'indicador-valor';
  valor.textContent = `${nUniverso.toLocaleString('es-AR')} observaciones`;
  const subtitulo = document.createElement('div');
  subtitulo.className = 'indicador-subtitulo';
  const plural = cantidadGrupos === 1 ? 'grupo' : 'grupos';
  subtitulo.textContent = `Comparando por: ${comparandoPorCorto(variableAgrupamiento)} · ${cantidadGrupos} ${plural}`;
  container.append(titulo, valor, subtitulo);
}

/**
 * Renderiza la fila de TARJETAS de grupo -- única referencia visual
 * permanente de cada grupo (Secciones 1-3 de esta ronda: la tarjeta de
 * universo ya no lista grupos, y la leyenda nativa de Plotly se eliminó
 * del gráfico). Mismo lenguaje visual para cualquier variable de
 * comparación (Zona, ENSO, Riego, Ciclo, Antecesor...) -- el marcado no
 * asume nada sobre cuántos grupos hay ni de qué variable vienen.
 *
 * Interacción (Sección 4): clic en el cuerpo de la tarjeta ALTERNA mostrar
 * u ocultar esa serie en el gráfico (ya no quita el grupo -- antes hacía
 * eso, ahora ese rol pasa exclusivamente al botón × dedicado, para no
 * mezclar "ocultar temporalmente" con "sacar de la comparación"). Hover
 * resalta la curva y su banda en el gráfico.
 * @param {HTMLElement} container
 * @param {object} params
 * @param {Array} params.grupos [{ valor, n, visible }] en orden estable
 * @param {boolean} params.puedeAgregar
 * @param {string} params.variableAgrupamiento
 * @param {(valor:string)=>void} params.onQuitar
 * @param {(valor:string)=>void} params.onToggleVisibilidad
 * @param {(anchorEl:HTMLElement)=>void} params.onRequestAgregar
 * @param {(valor:string|null)=>void} [params.onHoverGrupo]
 */
export function renderFilaDeGrupos(container, { grupos, puedeAgregar, variableAgrupamiento, onQuitar, onToggleVisibilidad, onRequestAgregar, onHoverGrupo }) {
  container.innerHTML = '';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Grupos comparados');

  grupos.forEach((g, indice) => {
    const etiqueta = etiquetaDeGrupo(g.valor, variableAgrupamiento);
    const oculto = g.visible === false;

    // <div>, no <button>: adentro va un botón real (quitar), y un botón no
    // puede anidar otro botón de forma válida en HTML.
    const tarjeta = document.createElement('div');
    tarjeta.className = 'grupo-tarjeta'
      + (g.n === 0 ? ' grupo-tarjeta-vacia' : '')
      + (oculto ? ' grupo-tarjeta-oculta' : '');
    tarjeta.style.setProperty('--color-grupo', PALETA_CATEGORICA[indice % PALETA_CATEGORICA.length]);
    tarjeta.setAttribute('data-grupo-valor', g.valor);
    tarjeta.setAttribute('role', 'button');
    tarjeta.setAttribute('tabindex', '0');
    tarjeta.setAttribute('aria-label', `${oculto ? 'Mostrar' : 'Ocultar'} ${etiqueta} en el gráfico`);
    tarjeta.innerHTML = `
      <span class="grupo-tarjeta-punto"></span>
      <span class="grupo-tarjeta-texto">
        <span class="grupo-tarjeta-nombre">${etiqueta}</span>
        <span class="grupo-tarjeta-n">${g.n.toLocaleString('es-AR')} lotes</span>
      </span>
    `;
    tarjeta.addEventListener('click', () => onToggleVisibilidad(g.valor));
    if (onHoverGrupo) {
      tarjeta.addEventListener('mouseenter', () => onHoverGrupo(g.valor));
      tarjeta.addEventListener('mouseleave', () => onHoverGrupo(null));
    }

    const quitarBtn = document.createElement('button');
    quitarBtn.type = 'button';
    quitarBtn.className = 'grupo-tarjeta-quitar';
    quitarBtn.textContent = '×';
    quitarBtn.setAttribute('aria-label', `Quitar grupo de la comparación: ${etiqueta}`);
    quitarBtn.addEventListener('click', (e) => { e.stopPropagation(); onQuitar(g.valor); });
    tarjeta.appendChild(quitarBtn);

    container.appendChild(tarjeta);
  });

  if (puedeAgregar) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'agregar-grupo';
    addBtn.textContent = '+ agregar grupo';
    addBtn.addEventListener('click', () => onRequestAgregar(addBtn));
    container.appendChild(addBtn);
  }
}

/**
 * Abre un buscador simple de un solo paso (solo valores, no categoría→valor)
 * para re-agregar un grupo ya con la variable de agrupamiento fijada (punto
 * 6: "reutiliza el mismo buscador simple del resto del producto, sin ningún
 * modo especial de selección múltiple"). Implementado acá como una lista
 * mínima -- no reutiliza abrirBuscadorDeCondiciones porque ese buscador
 * siempre empieza en el paso "categoría", y acá la categoría ya está fija.
 * @param {object} params
 * @param {HTMLElement} params.anchorEl
 * @param {string[]} params.valoresDisponibles valores que todavía no están en la comparación
 * @param {string} params.variableAgrupamiento
 * @param {(valor:string)=>void} params.onSelect
 */
export function abrirBuscadorDeGrupo({ anchorEl, valoresDisponibles, variableAgrupamiento, onSelect }) {
  document.querySelectorAll('.buscador-overlay').forEach((el) => el.remove());

  const overlay = document.createElement('div');
  overlay.className = 'buscador-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Agregar grupo');

  const lista = document.createElement('ul');
  lista.className = 'buscador-lista';
  overlay.appendChild(lista);

  document.body.appendChild(overlay);
  const rect = anchorEl.getBoundingClientRect();
  overlay.style.position = 'absolute';
  overlay.style.top = `${window.scrollY + rect.bottom + 6}px`;
  overlay.style.left = `${window.scrollX + rect.left}px`;

  if (valoresDisponibles.length === 0) {
    const vacio = document.createElement('li');
    vacio.className = 'buscador-vacio';
    vacio.textContent = 'Sin más valores disponibles';
    lista.appendChild(vacio);
  } else {
    valoresDisponibles.forEach((valor) => {
      const li = document.createElement('li');
      li.className = 'buscador-item';
      li.textContent = etiquetaDeGrupo(valor, variableAgrupamiento);
      li.addEventListener('click', () => {
        onSelect(valor);
        overlay.remove();
      });
      lista.appendChild(li);
    });
  }

  function onOutsideClick(e) {
    if (!overlay.contains(e.target) && e.target !== anchorEl) {
      overlay.remove();
      document.removeEventListener('mousedown', onOutsideClick, true);
    }
  }
  document.addEventListener('mousedown', onOutsideClick, true);
}
