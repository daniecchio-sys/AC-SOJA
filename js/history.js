// ============================================================================
// history.js
// Historial de consultas muy liviano, al estilo de un navegador: una pila de
// estados con un puntero a la posición actual. No es una lista de consultas
// guardadas -- es exclusivamente atrás/adelante, tal como se pidió.
//
// No sabe nada de filtros, de motor ni de DOM: guarda "snapshots" opacos
// (lo que sea que el llamador le pase) y devuelve el snapshot correspondiente
// al moverse. Quien lo usa decide qué es un snapshot.
// ============================================================================

/**
 * Crea una instancia de historial independiente.
 * @returns {object}
 */
export function createHistory() {
  let stack = [];
  let index = -1;

  return {
    /**
     * Empuja un nuevo estado. Si el usuario había retrocedido y ahora aplica
     * una condición nueva, el historial "hacia adelante" se descarta -- es
     * el mismo comportamiento que el de un navegador real.
     * @param {*} snapshot
     */
    push(snapshot) {
      stack = stack.slice(0, index + 1);
      stack.push(snapshot);
      index = stack.length - 1;
    },

    canGoBack() {
      return index > 0;
    },

    canGoForward() {
      return index < stack.length - 1;
    },

    back() {
      if (!this.canGoBack()) return null;
      index -= 1;
      return stack[index];
    },

    forward() {
      if (!this.canGoForward()) return null;
      index += 1;
      return stack[index];
    },

    current() {
      return index >= 0 ? stack[index] : null;
    },

    /** Longitud total y posición actual, útil para depurar o mostrar un contador discreto. */
    info() {
      return { length: stack.length, index };
    },
  };
}
