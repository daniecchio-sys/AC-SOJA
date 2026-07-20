# AC SOJA 25-26 — Motor + Interfaz Visual (Desktop) — Criterio de Representatividad en Indicadores

Estado: **motor cerrado (89 verificaciones) + interfaz validada (73 verificaciones) + criterio mínimo de representatividad en los indicadores laterales.** No es la identidad definitiva de CREA — ver la nota al inicio de `css/global.css`.

## Esta ronda: umbral mínimo de observaciones para los indicadores (MIN_OBS_KPI)

"Mayor potencial observado" y "Mayor piso productivo" ahora solo consideran ventanas con **al menos 20 observaciones** (`MIN_OBS_KPI = 20`, una única constante en `app.js`, fácil de ajustar sin tocar el algoritmo). Antes de buscar el máximo P75/P25, se descartan las ventanas con menos evidencia — el máximo nunca puede salir de una ventana con pocos datos, aunque su valor sea el más alto.

- Si ninguna ventana del subconjunto actual llega a 20 observaciones, el indicador muestra el mensaje neutro exacto pedido: *"No hay suficientes observaciones para calcular este indicador."* — nunca un valor fabricado ni un espacio en blanco sin explicación.
- Se agregó una segunda nota discreta debajo de ambos indicadores: *"Indicadores calculados sobre ventanas con n ≥ 20 observaciones."*, junto a la que ya existía sobre el subconjunto analizado.
- Sigue siendo cálculo de capa de presentación (`app.js`), no un KPI nuevo del motor — `stats.js` no cambió.

**Validado con un caso real, no simulado:** el smoke test identifica dinámicamente la localidad con menos observaciones de todo el dataset (`Colonia Marina`), filtra por ella a través de la interfaz real, y confirma que dispara exactamente el mensaje neutro pedido. También se agregó una verificación cruzada independiente (recarga el CSV y recalcula desde cero, sin reutilizar ninguna función de `app.js`) que confirma que ninguna ventana candidata a "mayor P75/P25" tiene menos de 20 observaciones. Total: **73 verificaciones de interfaz, 0 fallidas** (sobre las 89 del motor, sin cambios).

## Ronda anterior: ajustes de layout y simplificación de filtros

### 1. Ancho de página (sin scroll horizontal a 100% de zoom)

El ancho máximo de la página bajó de 1440px a **1330px**, y el padding lateral de 64px a 40px. El ancho del **gráfico en sí no se tocó** (sigue fijo en 992px vía `flex-basis`) ni se redujo ninguna tipografía — el ajuste se hizo achicando el espacio entre el gráfico y el panel de indicadores (56px → 28px) y el panel mismo (260px → 220px, con margen de sobra para el contenido que muestra). 1330px entra con margen dentro del umbral seguro para un notebook de 1366px de ancho físico (~1349px de viewport real, descontando el scrollbar del sistema) y, por supuesto, dentro de cualquier Full HD.

### 2. Filtros ocultos de la consulta (no del motor)

`Sistema de riego`, `Genética` y `Superficie sembrada` ya no aparecen como opciones en el buscador de "+ agregar condición". La consulta queda enfocada en las variables realmente relevantes para el análisis de fecha de siembra (campaña, ENSO, zona, departamento, localidad, antecesor, ciclo, riego, fertilización, ocupación, subgrupo, precipitaciones, agua al inicio, lámina de riego).

**Los tres siguen existiendo en el motor sin ningún cambio** — `filters.js` no perdió ninguna definición de `FILTERABLE_FIELDS`. El cambio vive enteramente en `query-builder.js`, en la lista de campos que el buscador ofrece (`CAMPOS_BUSCABLES`), documentado con el motivo exacto de cada exclusión.

Se agregaron 8 verificaciones nuevas al smoke test: confirman que los 3 campos siguen vivos en `filters.js` pero ya no aparecen como categoría en el buscador, que las categorías relevantes siguen disponibles, y que el ancho máximo de página declarado en el CSS entra dentro del umbral seguro de 1366px. Total: **68 verificaciones de interfaz, 0 fallidas** (sobre las 89 del motor, sin cambios).

## Ronda anterior: Iteración 2 de comunicación visual del gráfico

1. **Banda entre percentiles**, no líneas P25/P75. Se reemplazaron las dos líneas punteadas por una banda continua sin borde (`fill: 'tonexty'` en Plotly), color neutro, opacidad 0,13 — el "corredor de comportamiento observado". La mediana sigue siendo la única línea de referencia con protagonismo dentro de ese corredor. Justificación: con datos de lotes de producción (no de un ensayo controlado), el objetivo es comunicar un rango, no exhibir tres estadísticas con igual jerarquía.
2. **Colores de los puntos, sin rojo.** Naranja suave (`#d18a4d`) por debajo del corredor, gris (`#aaaa9e`) dentro, verde institucional (`#2f5233`) por encima. Es una excepción deliberada a la regla de la ronda anterior ("el color de acento nunca representa un dato") — acá el pedido explícito era usar el verde institucional con sentido semántico, y se prioriza ese pedido. Las dos categorías intermedias del motor (`ENTRE_P25_MEDIANA` / `ENTRE_MEDIANA_P75`) comparten el mismo gris a propósito: el corredor no distingue mediana, solo adentro/afuera.
3. **Banda de frecuencia**, ahora con el dominio prácticamente pegado al gráfico principal (gap ≈0,05 en vez de ≈0,10) y un título propio ("Frecuencia de observaciones") en tipografía mínima, para que quede claro qué representa sin que compita visualmente.
4. **Eje Y**, únicamente dos referencias horizontales destacadas (3.000 y 4.000 kg/ha), sin grilla adicional.
5. **Tipografía de la respuesta**: el primer mensaje (el hallazgo central) se distingue del resto — serif itálico, más grande — mientras los mensajes de apoyo pasan a un tratamiento más compacto y neutro (sans, más chico), en vez de un bloque uniforme de texto corrido.
6. **Ancho del gráfico sin cambios** (992px, igual que la ronda anterior, fijado con `flex-basis` para que agregar contenido al lado no lo modifique).
7. **Dos indicadores de síntesis** en el espacio lateral liberado: "Mayor potencial observado" (ventana con mayor P75) y "Mayor piso productivo" (ventana con mayor P25), con la nota discreta "Basado en el subconjunto actualmente analizado." debajo de ambos.

**Sobre la forma de los indicadores:** se descartaron velocímetros/gauges/radiales. Un número grande en tipografía limpia es, de por sí, lo más rápido de leer que existe — agregarle un widget gráfico encima (aguja, arco, escala) no lo hace más claro, lo hace más pesado, y contradice la filosofía "sin cajas, sin sombras, jerarquía por tipografía" que ya gobierna el resto de la interfaz. Se optó por dos bloques puramente tipográficos, distinguidos entre sí solo por una regla superior finísima.

**Aclaración importante sobre "Mayor potencial observado" y "Mayor piso productivo":** no son KPIs nuevos del motor — se calculan en la capa de presentación (`app.js`), buscando el máximo de `p75` y de `p25` respectivamente sobre `visibleWindows` (el mismo resumen por ventana que ya alimenta el gráfico), restringido a ventanas donde el percentil correspondiente efectivamente se calculó. `stats.js` no cambió.

Se agregaron 20 verificaciones nuevas al smoke test de interfaz para blindar cada punto de esta iteración (banda sin líneas sueltas, opacidad baja, colores exactos sin rojo, las dos referencias exactas en 3000/4000, título de la banda de frecuencia, gap reducido, contenido y lenguaje de ambos indicadores). Total: **60 verificaciones de interfaz, 0 fallidas** (sobre las 89 del motor, sin cambios).

## Ronda anterior: primera materialización visual

Se implementó `css/global.css` completo bajo la filosofía pedida — jerarquía por tipografía, alineación, espaciado y contraste, sin cajas ni sombras pesadas, un único color de acento usado con moderación, estética neutra inspirada en la *filosofía* de Notion/Linear/Stripe/Apple (no en su estética literal). La consulta es el elemento de mayor peso tipográfico de toda la pantalla (38px); el gráfico no tiene marco ni borde; comparación, historial y valores exactos permanecen deliberadamente discretos hasta que se usan; la respuesta a "¿Qué muestran estos datos?" se distingue con una regla fina a la izquierda y un tratamiento serif itálico, como una voz distinta hablando, no otro dato en pantalla.

**Dos inconsistencias reales encontradas y corregidas al revisar la integración con el JS existente** (no eran errores de HTML/CSS en sí, sino que `app.js` seguía con lógica de la ronda anterior, previa a esta reestructuración visual):
1. `renderContexto()` construía el punto de representatividad temporal con un **emoji** (🟢🟡🔴). Un emoji trae su propio color fijo y no puede recolorearse con CSS — las clases `.rep-alta/.rep-media/.rep-baja` no tenían ningún efecto real. Se reemplazó por un carácter de texto simple (`●`), que si hereda el color de la clase.
2. `renderContexto()` movía `comparar-btn` al interior de `#contexto` en cada render, envuelto en un `<span class="acciones-secundarias">` que ni siquiera tenía estilos definidos. Rompía la estructura `.fila-contexto` ya prevista en el HTML. Se corrigió para que el botón permanezca en su lugar del layout.

También se armonizó la paleta del gráfico (`js/charts.js`) con el resto del sistema: los **datos** ahora se codifican en escala de grises (más oscuro = rendimiento más alto dentro de su ventana), y el color de acento queda reservado exclusivamente para elementos **interactivos** de la interfaz — nunca para representar un dato.

Se agregaron 2 verificaciones nuevas al smoke test de interfaz para blindar ambas correcciones (el punto es recoloreable; el botón de comparar no se reubica). Total: **40 verificaciones de interfaz, 0 fallidas** (sobre las 89 del motor, sin cambios).

## Cómo abrir el prototipo

```bash
npm run preview
# o directamente: python3 -m http.server 8098
```

Y abrir `http://localhost:8098/` en el navegador. Solo Desktop en esta ronda — no se trabajó responsive, tablet ni mobile todavía, tal como se pidió.

## Qué se puede recorrer

- **Consulta como interfaz**: "+ agregar condición" abre un buscador de dos pasos (categoría → valor), sin desplegables tradicionales.
- **Cada condición se aplica de inmediato**, registrada en un historial atrás/adelante (← →) muy discreto junto al logo.
- **Contexto del análisis**: observaciones + representatividad temporal (●, coloreado por nivel), con detalle desplegable al click.
- **"+ comparar"**: fija la consulta actual como referencia; al seguir ajustando aparece el bloque con ambas consultas completas y qué cambió, sin caja, con una simple regla fina arriba.
- **Selección directa sobre el gráfico**: arrastrar el mouse recorta un tramo del calendario y ofrece agregarlo como condición.
- **"¿Qué muestran estos datos?"**: acción explícita, se abre como una cita (regla fina + itálica), no como un panel de conclusiones.
- **"Ver valores exactos"**: texto mínimo al final de la página, nunca compite visualmente con el resto.

## Decisión de diseño que se apartó del documento conceptual de la Etapa 5

El modelo de la Etapa 5 definía un flujo de borrador de filtros + botón "Aplicar filtros". Esta iteración lo reemplaza por aplicación inmediata de cada condición, porque el historial tipo navegador pedido explícitamente (Zona 2 → Zona 4 → Zona 5 → Niña → ...) solo tiene sentido si cada paso es, en sí mismo, un estado navegable. El motor (`state.js`) no cambió: sigue exponiendo `setDraftFilter()` y `applyFilters()` por separado; la interfaz los llama en el mismo gesto en vez de esperar una confirmación aparte.

## Qué se extendió en el motor (documentado, no silencioso)

- **`filters.js`**: nuevo tipo de condición `daterange`, para convertir una selección hecha con el mouse sobre el gráfico en una condición más. Compara por "día de temporada" (no por fecha absoluta), para que la selección funcione igual con una o con doce campañas mezcladas. Trajo una dependencia nueva y puntual: `filters.js` ahora importa `diaDeTemporada` de `stats.js`.
- **`stats.js`**: se agregaron `diaDeTemporada(mes, dia)` y su inverso `fechaDesdeDiaDeTemporada(diaTemporada)` — utilidades de presentación, no participan de ningún cálculo de ventanas o percentiles ya validado.
- Las 89 verificaciones de `test/engine-test.js` se corrieron de nuevo después de todos estos cambios y siguen pasando sin modificaciones.

## Estructura

```
ac-soja-25-26/
├── index.html                 # prototipo navegable (Desktop)
├── data/ac_soja.csv
├── vendor/plotly.min.js       # Plotly local, sin depender de un CDN
├── css/global.css             # capa visual completa, NO la identidad definitiva de CREA
├── js/
│   ├── utils.js, data-loader.js, filters.js, stats.js, state.js   # motor (validado)
│   ├── query-builder.js       # la oración-consulta + buscador de dos pasos
│   ├── history.js             # historial atrás/adelante, muy liviano
│   ├── comparison.js          # comparación de consultas completas
│   ├── charts.js               # única puerta de entrada a Plotly, paleta armonizada con el CSS
│   └── app.js                  # orquestación general
├── test/
│   ├── engine-test.js          # 89 verificaciones del motor, sin interfaz
│   └── smoke-test-ui.mjs       # 40 verificaciones de la interacción + capa visual
└── package.json
```

## Cómo volver a correr las pruebas

```bash
npm run test:engine     # motor, sin servidor necesario
npm install jsdom --no-save
npm run preview &        # servir el proyecto
npm run test:ui
```

## Decisiones de diseño relevantes para la próxima etapa

- **Filtros "borrador + aplicar" en el motor, pero aplicación inmediata en la interfaz.**
- **`visibleWindows`** ya viene con `n` y percentiles incluidos.
- **Percentiles por ventana:** interpolación lineal.
- **Clasificación en los límites** (`CLASSIFICATION_LABELS` en `stats.js`): P25 y Mediana abren su grupo; P75 cierra el suyo.
- **`representatividadTemporal`** (no "calidad"): mide cobertura del período, no confiabilidad de los datos.
- **Período analizado**: 01/oct al 15/ene, inclusive.
- **Color de acento reservado a interacción**, nunca a datos — los datos del gráfico son monocromos a propósito.

## Qué falta (próxima etapa)

Validación de uso sobre esta versión Desktop. Recién después: identidad visual definitiva de CREA (paleta, tipografía, logo real), responsive para tablet y mobile, animaciones, íconos, y la decisión pendiente sobre la vista comparativa tipo mapa de calor.




