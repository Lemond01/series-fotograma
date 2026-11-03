# Series Atlas

Series Atlas es una aplicación web que construí para descubrir y consultar series de televisión. Se puede buscar cualquier serie, filtrar el catálogo por género y estado, ver la ficha completa de cada una con sus temporadas y episodios, y guardar mis favoritas para tenerlas siempre a mano.

Todos los datos son reales: los obtengo de la [API pública de TVmaze](https://www.tvmaze.com/api). Es un proyecto académico con el que practiqué HTML semántico, Sass, JavaScript sin frameworks y el consumo de una API REST con Axios.

![Página de inicio de Series Atlas con Breaking Bad como serie destacada](docs/capturas/inicio.jpg)

## Qué hace

### Inicio

La página de inicio presenta una **serie destacada** a pantalla completa, un buscador y una selección de **series para empezar**. Tanto la destacada como la selección son series que elegí yo (por eso las rotulo como *selección editorial*), no un ranking de popularidad: TVmaze no ofrece ese dato y no quería inventarlo.

Más abajo hay accesos directos por **género**, que abren Explorar con ese filtro ya aplicado, y la **programación web** del día: las series que estrenan episodio hoy en plataformas de streaming, agrupadas por serie y con la hora convertida a la zona horaria de quien visita la página.

![Secciones de géneros y programación web en Inicio](docs/capturas/inicio-generos-programacion.jpg)

### Explorar

Aquí está el catálogo. Sin escribir nada, muestro la primera página del índice de TVmaze (240 series); en cuanto se escriben dos caracteres o más, busco por título.

- **Búsqueda con debounce:** espero 400 ms desde la última tecla antes de consultar la API, y si llega una búsqueda nueva cancelo la anterior para no mostrar resultados viejos.
- **Filtros por género:** se pueden elegir varios a la vez y muestro las series que tienen *al menos uno* de ellos. Además de los nueve géneros principales, el botón «Más géneros» despliega los demás que aparecen en los datos (Acción, Anime, Western…).
- **Filtro por estado:** solo ofrezco los estados que realmente aparecen en los datos, cada uno con su número de series según los géneros elegidos.
- **Ordenamiento:** por puntuación, por nombre o por año de estreno. Las series sin puntuación o sin fecha siempre quedan al final.

Los filtros y el orden se aplican en memoria, sin volver a consultar la API, y todo se refleja en la URL. Así se puede compartir una búsqueda o volver atrás desde una ficha sin perder nada.

![Explorar con los géneros Drama y Acción seleccionados y ordenado por mejor puntuación](docs/capturas/explorar-filtros.jpg)

### Detalle de una serie

Cada tarjeta lleva a `detalle.html?id=…`, donde muestro el póster, la sinopsis, los géneros, la puntuación, el estado y una ficha técnica con estreno, cadena, idioma, duración y horario.

Los episodios aparecen **agrupados por temporada** en secciones desplegables. Cada temporada se genera solo cuando se abre, porque hay series con cientos de episodios (Los Simpson tienen más de 800).

![Ficha de Stranger Things con sinopsis, ficha técnica y la primera temporada desplegada](docs/capturas/detalle.jpg)

### Favoritos

Cualquier serie se puede guardar pulsando el corazón, ya sea en una tarjeta, en la serie destacada o en su ficha. Los favoritos se conservan aunque se cierre el navegador, y el enlace «Favoritos» de la navegación muestra cuántos hay guardados.

La vista de favoritos está dentro de Explorar (`explorar.html#favoritos`). Desde ahí se puede quitar cualquier serie y la tarjeta desaparece al instante. Si una serie guardada ya no existe en TVmaze, aviso de ello y ofrezco quitarla, sin que eso impida mostrar las demás.

![Vista de favoritos con cuatro series guardadas](docs/capturas/favoritos.jpg)

### En el móvil

Diseñé la interfaz primero para pantallas pequeñas. En el móvil, la navegación se recoge en un menú desplegable, las tarjetas pasan a dos columnas y los géneros se desplazan en horizontal.

![Inicio y Explorar en una pantalla de móvil](docs/capturas/movil.jpg)

> Las capturas son del 3 de noviembre de 2026. La programación web cambia cada día y los datos dependen de lo que TVmaze tenga en ese momento.

## Tecnologías

- **HTML5 semántico**, con atención a la accesibilidad (enlace para saltar al contenido, `aria-pressed` en los botones de favorito, foco visible).
- **Sass (SCSS)** compilado con Dart Sass, organizado en parciales y con clases BEM.
- **JavaScript vanilla** con módulos ES, sin frameworks ni jQuery.
- **Axios** para las solicitudes HTTP.
- **localStorage** para los favoritos.
- **npm** y **Git**.

## Cómo lo organicé

```text
series-atlas/
├── index.html          # Inicio
├── explorar.html       # Catálogo, búsqueda, filtros y favoritos
├── detalle.html        # Ficha de una serie
├── assets/icons/       # sprite.svg (iconos) y favicon.svg
├── src/
│   ├── scss/           # main.scss + _variables, _base, _layout, _components
│   └── js/
│       ├── main.js     # Inicio
│       ├── explorar.js # Explorar y vista de favoritos
│       ├── detalle.js  # Detalle
│       ├── api.js      # Todas las llamadas a TVmaze
│       ├── favorites.js# Favoritos en localStorage
│       └── ui.js       # Piezas de interfaz compartidas
├── css/main.css        # CSS compilado (el que enlazan los HTML)
└── docs/capturas/      # Imágenes de este README
```

Cada página carga solo su propio archivo de entrada, y la lógica compartida vive en tres módulos:

- **`api.js`** centraliza Axios: URL base, tiempo de espera de 10 segundos, una caché en memoria para no repetir solicitudes y errores con un tipo concreto (sin conexión, 404, límite de solicitudes…), para que cada página muestre el mensaje adecuado.
- **`favorites.js`** es la única parte que toca `localStorage`. Guarda solo los IDs de las series, sin duplicados, y si encuentra datos corruptos los ignora en lugar de fallar.
- **`ui.js`** crea las tarjetas de serie, maneja el menú móvil, los corazones de favoritos y los formatos en español.

## Instalación y uso

Necesitas Node.js y npm.

```bash
npm install
```

Para compilar los estilos:

| Comando | Qué hace |
| --- | --- |
| `npm run sass` | Compila `src/scss/main.scss` en `css/main.css` |
| `npm run sass:watch` | Vuelve a compilar cada vez que cambia un archivo `.scss` |

Siempre edito los archivos `.scss`, nunca `css/main.css` directamente.

Para abrir el proyecto hace falta un servidor local, porque los navegadores bloquean los módulos de JavaScript cuando la página se abre con doble clic (`file://`). Yo uso cualquiera de estas dos opciones:

- La extensión **Live Server** de VS Code.
- `python -m http.server 8000` en la carpeta del proyecto, y después abrir <http://localhost:8000>.

Como no uso empaquetador, `api.js` importa Axios directamente desde `node_modules`:

```js
import axios from '../../node_modules/axios/dist/esm/axios.min.js';
```

Por eso hay que ejecutar `npm install` y servir el proyecto desde su carpeta raíz.

## Los datos de TVmaze

TVmaze no necesita API key. Estos son los endpoints que uso:

| Endpoint | Para qué lo uso |
| --- | --- |
| `GET /search/shows?q=` | La búsqueda de Explorar |
| `GET /shows?page=0` | El catálogo de Explorar cuando no hay búsqueda |
| `GET /shows/{id}` | La ficha de detalle, la selección de Inicio y los favoritos que no tengo ya en memoria |
| `GET /shows/{id}/episodes` | Las temporadas y los episodios |
| `GET /schedule/web` | La programación web de Inicio |

Algunas decisiones que tomé con los datos:

- **No los modifico.** Si TVmaze devuelve un valor que parece extraño (por ejemplo, un año de finalización inesperado), lo muestro tal cual.
- **Las sinopsis están en inglés**, que es como las ofrece TVmaze. No las traduzco y las marco con `lang="en"`.
- **Las sinopsis llegan en HTML**, así que las convierto a texto plano antes de mostrarlas, en lugar de insertarlas con `innerHTML`, para no ejecutar contenido externo.
- **Si falta una imagen o un dato**, muestro un marcador «Sin imagen» o «No disponible».

### URL de Explorar

Explorar guarda su estado en la URL, que también sirve como enlace directo:

| Parámetro | Ejemplo | Valores |
| --- | --- | --- |
| `q` | `?q=house` | Texto de búsqueda (mínimo 2 caracteres) |
| `genre` | `?genre=Drama&genre=Action` | Géneros de TVmaze; se puede repetir |
| `status` | `?status=Ended` | `Running`, `Ended`, `To Be Determined`, `In Development` |
| `sort` | `?sort=rating-desc` | `rating-desc`, `rating-asc`, `name-asc`, `name-desc`, `year-desc`, `year-asc` |

Si algún valor no es válido, simplemente lo ignoro.

## Limitaciones conocidas

- El catálogo de Explorar es solo la **primera página** del índice de TVmaze: 240 series ordenadas por su ID, la mayoría antiguas. No es el catálogo completo ni un ranking.
- La búsqueda de TVmaze devuelve **como máximo 10 resultados**, así que al combinarla con filtros a veces quedan pocas series.
- TVmaze no permite pedir varias series en una sola consulta. Para los favoritos reutilizo las que ya tengo en memoria y pido el resto una a una, como máximo cuatro a la vez.
- Los favoritos se guardan en el navegador: no hay cuentas ni sincronización entre dispositivos.

## Créditos

- **Datos e imágenes de series:** [TVmaze](https://www.tvmaze.com/), bajo licencia [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Los pósteres que aparecen en las capturas son de TVmaze y de sus respectivos titulares.
- **Tipografías:** [Fraunces](https://fonts.google.com/specimen/Fraunces) y [Manrope](https://fonts.google.com/specimen/Manrope), desde Google Fonts.
