// ============================================================================
// query-builder.js
// La consulta ES la interfaz: una oración en lenguaje natural donde cada
// condición activa es una palabra clickeable. Este módulo:
//   - sabe cómo redactar cada condición como un fragmento de oración;
//   - renderiza esa oración con las condiciones como pills removibles;
//   - implementa el buscador de dos pasos (categoría -> valor) que reemplaza
//     a los desplegables tradicionales, al estilo Notion/Linear.
// No conoce el motor por dentro -- recibe filtros ya aplicados y una lista
// de registros para calcular las opciones disponibles, y devuelve objetos
// de condición con la forma exacta que espera filters.js.
// ============================================================================

import { FILTERABLE_FIELDS, getDistinctValues, getRangeBounds } from './filters.js';

// ---------------------------------------------------------------------------
// Pregunta raíz por defecto (Explorar). Constante única -- antes vivía
// escrita dos veces, de forma literal, dentro de construirOracion() y de
// renderQuery(). Se extrae acá para que sea el único lugar que la define,
// y para que sea el valor por defecto de la parametrización de abajo
// (ver "Pregunta raíz configurable").
// ---------------------------------------------------------------------------
export const BASE_SENTENCE_EXPLORAR = '¿Cómo cambia el rendimiento según la fecha de siembra';

// ---------------------------------------------------------------------------
// Metadata de redacción: cómo se lee cada condición dentro de la oración.
// Separado a propósito de FILTERABLE_FIELDS (que vive en filters.js y no
// sabe nada de lenguaje natural) -- este archivo es la única capa que le
// pone palabras a los datos.
// ---------------------------------------------------------------------------
const TITLE_CASE_EXCEPCIONES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'en']);
function tituloLegible(texto) {
  return String(texto)
    .toLowerCase()
    .split(' ')
    .map((palabra, i) => (i > 0 && TITLE_CASE_EXCEPCIONES.has(palabra) ? palabra : palabra.charAt(0).toUpperCase() + palabra.slice(1)))
    .join(' ');
}

const FRASE_POR_CAMPO = {
  campana: { categoria: 'Campaña', frase: (v) => `en la campaña ${v}` },
  enso: { categoria: 'ENSO', frase: (v) => `bajo condiciones ${tituloLegible(v)}` },
  departamento: { categoria: 'Departamento', frase: (v) => `en el departamento ${tituloLegible(v)}` },
  localidad: { categoria: 'Localidad', frase: (v) => `en ${tituloLegible(v)}` },
  zona: { categoria: 'Zona', frase: (v) => `en Zona ${v}` },
  subgrupo: { categoria: 'Subgrupo', frase: (v) => (v === 'OGM' ? 'con material OGM' : 'con material No OGM') },
  ocupacion: {
    categoria: 'Ocupación (1°/2°)',
    frase: (v) => (v === '1°' ? 'en siembra de primera' : v === '2°' ? 'en siembra de segunda' : 'en siembra de tercera'),
  },
  antecesor: { categoria: 'Antecesor', frase: (v) => `con antecesor ${tituloLegible(v)}` },
  genetica: { categoria: 'Genética', frase: (v) => `con la genética ${v}` },
  ciclo: { categoria: 'Ciclo', frase: (v) => `de ciclo ${tituloLegible(v)}` },
  riego: { categoria: 'Riego', frase: (v) => (v === 'SI' ? 'con riego' : 'en secano') },
  sistemaRiego: { categoria: 'Sistema de riego', frase: (v) => `con sistema de riego ${tituloLegible(v)}` },
  fertilizacion: {
    categoria: 'Fertilización',
    frase: (v) => (v === 'CON FERTILIZACIÓN' ? 'con fertilización' : v === 'SIN FERTILIZACIÓN' ? 'sin fertilización' : 'con fertilización sin dato registrado'),
  },
  superficieSembrada: { categoria: 'Superficie sembrada', fraseRango: (min, max) => `con superficie sembrada entre ${min} y ${max} ha` },
  precipitaciones: { categoria: 'Precipitaciones del ciclo', fraseRango: (min, max) => `con precipitaciones del ciclo entre ${min} y ${max} mm` },
  aguaInicio: { categoria: 'Agua al inicio', fraseRango: (min, max) => `con agua al inicio entre ${min} y ${max} mm` },
  laminaRiego: { categoria: 'Lámina de riego', fraseRango: (min, max) => `con lámina de riego entre ${min} y ${max} mm` },
  temporada: { categoria: 'Tramo del calendario', frase: null }, // se redacta aparte, ver fraseTemporada()
};

// Campos que aparecen en el buscador de "agregar condición". Se excluyen
// deliberadamente de la interfaz (no del motor -- siguen existiendo en
// FILTERABLE_FIELDS y funcionan igual si algo los usa programáticamente):
//   - 'temporada': solo se crea seleccionando un tramo sobre el gráfico,
//     nunca desde el buscador de texto;
//   - 'sistemaRiego', 'genetica', 'superficieSembrada': fuera de esta
//     primera versión de la consulta a pedido explícito -- tendrán su
//     propia visualización específica más adelante. La consulta queda
//     enfocada en las variables realmente relevantes para el análisis de
//     fecha de siembra.
const CLAVES_OCULTAS_DEL_BUSCADOR = new Set(['temporada', 'sistemaRiego', 'genetica', 'superficieSembrada']);
const CAMPOS_BUSCABLES = FILTERABLE_FIELDS.filter((f) => !CLAVES_OCULTAS_DEL_BUSCADOR.has(f.key));

/**
 * Redacta el fragmento de oración correspondiente a una condición activa.
 * @param {string} key
 * @param {object} condition
 * @returns {string}
 */
export function fraseDeCondicion(key, condition) {
  const meta = FRASE_POR_CAMPO[key];
  if (!meta) return '';
  if (condition.type === 'in') {
    // multi-selección: "en Zona 4 o Zona 5"
    return condition.values.map((v) => meta.frase(v)).join(' o ');
  }
  if (condition.type === 'range') {
    return meta.fraseRango(condition.min, condition.max);
  }
  if (condition.type === 'daterange') {
    return fraseTemporada(condition);
  }
  return '';
}

function fraseTemporada(condition) {
  // el resolver real (día -> fecha legible) se inyecta desde stats.js en
  // tiempo de ejecución por quien arma la oración completa (ver
  // construirOracion), para no importar stats.js en un módulo que hasta acá
  // solo conocía filters.js.
  return condition.etiquetaLegible || 'en un tramo del calendario seleccionado';
}

/**
 * Construye la oración completa a partir de los filtros aplicados, en el
 * orden en que se agregaron (los objetos JS conservan orden de inserción
 * para claves de tipo string).
 *
 * PREGUNTA RAÍZ CONFIGURABLE: este es el único motor de construcción de
 * consultas de todo el producto -- lo que distingue a Explorar, Comparar y
 * Escenarios entre sí no es el mecanismo (sigue siendo exactamente el
 * mismo: cláusulas AND, en orden de selección, cada una removible), sino
 * la pregunta que cada módulo comunica al principio de la oración. Por eso
 * la pregunta raíz es un parámetro de datos (`baseSentence`), no una rama
 * de código por módulo -- agregar un cuarto módulo en el futuro no
 * requiere tocar este archivo, solo pasar su propia pregunta raíz.
 * Si no se pasa, se usa BASE_SENTENCE_EXPLORAR (Explorar y Comparar
 * comparten la misma pregunta raíz -- Comparar simplemente no pasa este
 * parámetro, y por lo tanto queda exactamente igual que hoy).
 * @param {object} appliedFilters
 * @param {object} [opciones]
 * @param {string} [opciones.baseSentence] pregunta raíz propia del módulo (sin el signo de interrogación de cierre)
 * @returns {{ texto: string, clausulas: Array<{key:string, texto:string}> }}
 */
export function construirOracion(appliedFilters, opciones = {}) {
  const base = opciones.baseSentence || BASE_SENTENCE_EXPLORAR;
  const excluidas = opciones.clavesExcluidas || [];
  const claves = Object.keys(appliedFilters).filter((k) => {
    if (excluidas.includes(k)) return false;
    const c = appliedFilters[k];
    if (!c) return false;
    if (c.type === 'in') return c.values && c.values.length > 0;
    if (c.type === 'range') return c.min !== null || c.max !== null;
    if (c.type === 'daterange') return c.startDia !== null || c.endDia !== null;
    return false;
  });

  if (claves.length === 0) {
    return { texto: `${base} en toda la red?`, clausulas: [] };
  }

  const clausulas = claves.map((key) => ({ key, texto: fraseDeCondicion(key, appliedFilters[key]) }));
  const texto = `${base} ${clausulas.map((c) => c.texto).join(', ')}?`;
  return { texto, clausulas };
}

/**
 * Renderiza la oración dentro de `container`, con cada cláusula como una
 * pill removible y una acción "+ agregar condición" al final.
 * @param {HTMLElement} container
 * @param {object} params
 * @param {object} params.appliedFilters
 * @param {(key:string)=>void} params.onRemove
 * @param {(anchorEl:HTMLElement)=>void} params.onRequestAdd
 * @param {string} [params.baseSentence] pregunta raíz propia del módulo -- ver construirOracion(). Si se omite, Explorar/Comparar quedan exactamente igual.
 */
export function renderQuery(container, { appliedFilters, onRemove, onRequestAdd, baseSentence, clavesExcluidas }) {
  const { texto, clausulas } = construirOracion(appliedFilters, { baseSentence, clavesExcluidas });
  container.innerHTML = '';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Consulta actual');

  const base = baseSentence || BASE_SENTENCE_EXPLORAR;
  const wrap = document.createElement('p');
  wrap.className = 'consulta-oracion';

  if (clausulas.length === 0) {
    wrap.append(document.createTextNode(`${base} en toda la red?`));
  } else {
    wrap.append(document.createTextNode(`${base} `));
    clausulas.forEach((c, i) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'clausula-pill';
      pill.textContent = c.texto;
      pill.setAttribute('aria-label', `Quitar condición: ${c.texto}`);
      pill.addEventListener('click', () => onRemove(c.key));
      wrap.appendChild(pill);
      wrap.append(document.createTextNode(i < clausulas.length - 1 ? ', ' : '?'));
    });
  }
  container.appendChild(wrap);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'agregar-condicion';
  addBtn.textContent = '+ agregar condición';
  addBtn.addEventListener('click', () => onRequestAdd(addBtn));
  container.appendChild(addBtn);

  return texto; // útil para exportación / título de comparación
}

// ---------------------------------------------------------------------------
// Buscador de dos pasos: categoría -> valor. Reemplaza a los desplegables
// tradicionales. Se monta como un overlay mínimo, anclado al botón que lo
// invocó, con navegación por teclado (flechas + enter + escape).
// ---------------------------------------------------------------------------

/**
 * Abre el buscador de condiciones. Devuelve nada; comunica el resultado vía
 * el callback onSelect.
 * @param {object} params
 * @param {HTMLElement} params.anchorEl elemento junto al cual anclar el overlay
 * @param {object[]} params.records dataset (completo o ya filtrado por las demás condiciones) para calcular opciones
 * @param {(key:string, condition:object)=>void} params.onSelect
 * @param {()=>void} params.onClose
 */
/**
 * Abre el buscador de condiciones de dos pasos (categoría → valor).
 * @param {object} params
 * @param {HTMLElement} params.anchorEl
 * @param {Array} params.records
 * @param {(key:string, condition:object)=>void} params.onSelect
 * @param {()=>void} [params.onClose]
 * @param {string[]} [params.categoriasPermitidas] si se pasa, el paso
 *   "categoría" solo ofrece estas claves (subconjunto de CAMPOS_BUSCABLES),
 *   en vez de las de todo el producto. Parámetro opcional para que un
 *   módulo pueda acotar el mismo buscador de siempre a su propio alcance
 *   metodológico, sin bifurcar el componente ni duplicar su lógica --
 *   mismo criterio ya usado con `baseSentence` en renderQuery/
 *   construirOracion. Sin este parámetro, Explorar y Comparar quedan
 *   exactamente iguales (todas las categorías, comportamiento no tocado).
 */
/**
 * Abre el buscador de condiciones de dos pasos (categoría → valor).
 * @param {object} params
 * @param {HTMLElement} params.anchorEl
 * @param {Array} params.records
 * @param {(key:string, condition:object)=>void} params.onSelect
 * @param {()=>void} [params.onClose]
 * @param {string[]} [params.categoriasPermitidas] restringe qué categorías
 *   se ofrecen (ver Escenarios).
 * @param {string[]} [params.ordenPersonalizado] reordena las categorías
 *   listadas al frente, en ese orden exacto; las no listadas conservan su
 *   orden relativo de siempre y quedan después. No modifica
 *   FILTERABLE_FIELDS (compartido por Explorar/Comparar/Escenarios) --
 *   reordena solo la lista que ve ESTE llamador puntual. Sin este
 *   parámetro, el orden queda exactamente igual que siempre.
 */
export function abrirBuscadorDeCondiciones({ anchorEl, records, onSelect, onClose, categoriasPermitidas, ordenPersonalizado }) {
  cerrarBuscadorExistente();

  let camposDisponibles = categoriasPermitidas
    ? CAMPOS_BUSCABLES.filter((f) => categoriasPermitidas.includes(f.key))
    : CAMPOS_BUSCABLES;

  if (ordenPersonalizado) {
    const prioridad = new Map(ordenPersonalizado.map((key, i) => [key, i]));
    camposDisponibles = [...camposDisponibles].sort((a, b) => {
      const pa = prioridad.has(a.key) ? prioridad.get(a.key) : ordenPersonalizado.length;
      const pb = prioridad.has(b.key) ? prioridad.get(b.key) : ordenPersonalizado.length;
      return pa - pb; // empate (ambos fuera de la lista) conserva el orden relativo original (sort estable)
    });
  }

  const overlay = document.createElement('div');
  overlay.className = 'buscador-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Agregar condición');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'buscador-input';
  input.placeholder = 'Buscar condición...';
  overlay.appendChild(input);

  const lista = document.createElement('ul');
  lista.className = 'buscador-lista';
  overlay.appendChild(lista);

  document.body.appendChild(overlay);
  posicionarOverlay(overlay, anchorEl);
  input.focus();

  let paso = 'categoria'; // 'categoria' | 'valor' | 'rango'
  let categoriaElegida = null;
  let itemsActuales = [];
  let indiceActivo = 0;

  function renderPasoCategoria(filtroTexto = '') {
    paso = 'categoria';
    const texto = filtroTexto.toLowerCase();
    itemsActuales = camposDisponibles.filter((f) => {
      const meta = FRASE_POR_CAMPO[f.key];
      return (meta.categoria || f.label).toLowerCase().includes(texto);
    });
    indiceActivo = 0;
    pintarLista(itemsActuales.map((f) => FRASE_POR_CAMPO[f.key].categoria || f.label));
  }

  function renderPasoValor(filtroTexto = '') {
    paso = 'valor';
    const texto = filtroTexto.toLowerCase();
    const valores = getDistinctValues(records, categoriaElegida.key);
    itemsActuales = valores.filter((v) => String(v).toLowerCase().includes(texto));
    indiceActivo = 0;
    pintarLista(itemsActuales.map((v) => FRASE_POR_CAMPO[categoriaElegida.key].frase(v)));
  }

  function renderPasoRango() {
    paso = 'rango';
    const bounds = getRangeBounds(records, categoriaElegida.key) || { min: 0, max: 0 };
    lista.innerHTML = '';
    input.style.display = 'none';

    const contenedor = document.createElement('div');
    contenedor.className = 'buscador-rango';
    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.value = Math.floor(bounds.min);
    minInput.className = 'rango-input';
    const maxInput = document.createElement('input');
    maxInput.type = 'number';
    maxInput.value = Math.ceil(bounds.max);
    maxInput.className = 'rango-input';
    const confirmar = document.createElement('button');
    confirmar.type = 'button';
    confirmar.className = 'rango-confirmar';
    confirmar.textContent = 'Agregar';
    confirmar.addEventListener('click', () => {
      finalizar(categoriaElegida.key, { type: 'range', min: Number(minInput.value), max: Number(maxInput.value) });
    });

    const etiqueta = document.createElement('span');
    etiqueta.className = 'rango-etiqueta';
    etiqueta.textContent = `${FRASE_POR_CAMPO[categoriaElegida.key].categoria}: entre`;

    contenedor.append(etiqueta, minInput, document.createTextNode('y'), maxInput, confirmar);
    lista.appendChild(contenedor);
    minInput.focus();
  }

  function pintarLista(etiquetas) {
    lista.innerHTML = '';
    if (etiquetas.length === 0) {
      const vacio = document.createElement('li');
      vacio.className = 'buscador-vacio';
      vacio.textContent = 'Sin resultados';
      lista.appendChild(vacio);
      return;
    }
    etiquetas.forEach((etiqueta, i) => {
      const li = document.createElement('li');
      li.className = 'buscador-item' + (i === indiceActivo ? ' activo' : '');
      li.textContent = etiqueta;
      li.addEventListener('mouseenter', () => {
        indiceActivo = i;
        actualizarActivo();
      });
      li.addEventListener('click', () => elegir(i));
      lista.appendChild(li);
    });
  }

  function actualizarActivo() {
    Array.from(lista.children).forEach((li, i) => li.classList.toggle('activo', i === indiceActivo));
  }

  function elegir(i) {
    if (paso === 'categoria') {
      categoriaElegida = itemsActuales[i];
      if (!categoriaElegida) return;
      input.value = '';
      if (categoriaElegida.type === 'range') {
        renderPasoRango();
      } else {
        renderPasoValor('');
      }
      return;
    }
    if (paso === 'valor') {
      const valor = itemsActuales[i];
      if (valor === undefined) return;
      finalizar(categoriaElegida.key, { type: 'in', values: [valor] });
    }
  }

  function finalizar(key, condition) {
    onSelect(key, condition);
    cerrar();
  }

  function cerrar() {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('mousedown', onOutsideClick, true);
    onClose?.();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { cerrar(); return; }
    if (paso === 'rango') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); indiceActivo = Math.min(indiceActivo + 1, itemsActuales.length - 1); actualizarActivo(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); indiceActivo = Math.max(indiceActivo - 1, 0); actualizarActivo(); }
    if (e.key === 'Enter') { e.preventDefault(); elegir(indiceActivo); }
    if (e.key === 'Backspace' && input.value === '' && paso === 'valor') { paso = 'categoria'; renderPasoCategoria(''); }
  }

  function onOutsideClick(e) {
    if (!overlay.contains(e.target) && e.target !== anchorEl) cerrar();
  }

  input.addEventListener('input', () => {
    if (paso === 'categoria') renderPasoCategoria(input.value);
    else if (paso === 'valor') renderPasoValor(input.value);
  });
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('mousedown', onOutsideClick, true);

  renderPasoCategoria('');
}

function cerrarBuscadorExistente() {
  document.querySelectorAll('.buscador-overlay').forEach((el) => el.remove());
}

function posicionarOverlay(overlay, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  overlay.style.position = 'absolute';
  overlay.style.top = `${window.scrollY + rect.bottom + 6}px`;
  overlay.style.left = `${window.scrollX + rect.left}px`;
}

export { FRASE_POR_CAMPO, tituloLegible };
