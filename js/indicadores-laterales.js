// ============================================================================
// indicadores-laterales.js
// Renderizado de los dos indicadores tipográficos "Mayor potencial
// observado" / "Mayor piso productivo" -- extraído de app.js (Explorar) a
// su propio módulo, SIN cambiar una sola línea de su lógica, para que
// Escenarios pueda reutilizarlo literalmente.
//
// Por qué no se importa directamente desde app.js: ese archivo tiene
// efectos secundarios de módulo (agarra elementos del DOM por id y llama a
// init() en cuanto se carga) pensados para explorar.html -- importarlo desde
// escenarios.html ejecutaría ese código contra un documento que no tiene
// esos elementos. Se extrae a un módulo sin efectos secundarios, que ambos
// (app.js y escenario-app.js) importan por igual.
// ============================================================================

export function formatearKg(valor) {
  return `${Math.round(valor).toLocaleString('es-AR')} kg/ha`;
}

/**
 * Pinta un indicador "título / valor / ventana / subtítulo" (o el mensaje
 * neutro de "no hay suficientes observaciones" si `ventana` es null).
 * @param {HTMLElement} contenedor
 * @param {object} params
 * @param {string} params.titulo
 * @param {object|null} params.ventana salida de ventanaConMayorP75()/ventanaConMayorP25() (stats.js)
 * @param {'p75'|'p25'} params.campo
 * @param {string} params.subtitulo
 */
export function pintarIndicador(contenedor, { titulo, ventana, campo, subtitulo }) {
  contenedor.innerHTML = '';
  const tituloEl = document.createElement('div');
  tituloEl.className = 'indicador-titulo';
  tituloEl.textContent = titulo;
  contenedor.appendChild(tituloEl);

  if (!ventana) {
    const vacio = document.createElement('div');
    vacio.className = 'indicador-vacio';
    vacio.textContent = 'No hay suficientes observaciones para calcular este indicador.';
    contenedor.appendChild(vacio);
    return;
  }

  const valorEl = document.createElement('div');
  valorEl.className = 'indicador-valor';
  valorEl.textContent = formatearKg(ventana[campo]);

  const ventanaEl = document.createElement('div');
  ventanaEl.className = 'indicador-ventana';
  ventanaEl.textContent = ventana.label;

  const subtituloEl = document.createElement('div');
  subtituloEl.className = 'indicador-subtitulo';
  subtituloEl.textContent = subtitulo;

  contenedor.append(valorEl, ventanaEl, subtituloEl);
}
