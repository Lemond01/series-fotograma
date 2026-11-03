# Series Atlas

Series Atlas es una aplicación web que construí para descubrir y consultar series de televisión. Se puede buscar cualquier serie, filtrar el catálogo por género y estado, ver la ficha completa de cada una con sus temporadas y episodios, y guardar mis favoritas para tenerlas siempre a mano.

Todos los datos son reales: los obtengo de la [API pública de TVmaze](https://www.tvmaze.com/api).

## Objetivo

Es un proyecto académico. Mi objetivo era construir un sitio estático completo, sin frameworks ni backend, que consuma una API REST real: HTML semántico, Sass organizado en parciales, JavaScript con módulos ES, Axios para las solicitudes y `localStorage` para guardar preferencias, cuidando los estados de carga y error, la accesibilidad y el diseño responsive.

![Página de inicio de Series Atlas con Breaking Bad como serie destacada](docs/capturas/inicio.jpg)

## Qué hace

### Inicio

La página de inicio presenta una **serie destacada** a pantalla completa, un buscador y una selección de **series para empezar**. Tanto la destacada como la selección son series que elegí yo (por eso las rotulo como *selección editorial*), no un ranking de popularidad: TVmaze no ofrece ese dato y no quería inventarlo.

Más abajo hay accesos directos por **género**, que abren Explorar con ese filtro ya aplicado, y la **programación web** del día: las series que estrenan episodio hoy en plataformas de streaming, agrupadas por serie y con la hora convertida a la zona horaria de quien visita la página.

![Secciones de géneros y programación web en Inicio](docs/capturas/inicio-generos-programacion.jpg)

### Explorar

Aquí está el catálogo. Sin escribir nada, muestro el índice de TVmaze página a página (unas 240 series por página); en cuanto se escriben dos caracteres o más, paso a buscar por título. El título de la sección indica siempre si se está viendo el **catálogo** o los **resultados de búsqueda**.

- **Paginación:** con «Anterior» y «Siguiente» se recorre el índice. Solo muestro «Página N», sin un total, porque TVmaze no lo informa: sé que llegué al final cuando una página responde 404, y entonces vuelvo a la última página válida, lo aviso y desactivo «Siguiente». Si se pulsa varias veces seguidas, espero 300 ms y pido solo la última página, cancelando cualquier solicitud anterior.

- **Búsqueda con debounce:** espero 400 ms desde la última tecla antes de consultar la API, y si llega una búsqueda nueva cancelo la anterior para no mostrar resultados viejos.
- **Filtros por género:** se pueden elegir varios a la vez y muestro las series que tienen *al menos uno* de ellos. Además de los nueve géneros principales, el botón «Más géneros» despliega los demás que aparecen en los datos (Acción, Anime, Western…).
- **Filtro por estado:** solo ofrezco los estados que realmente aparecen en los datos, cada uno con su número de series según los géneros elegidos.
- **Ordenamiento:** por puntuación, por nombre o por año de estreno. Las series sin puntuación o sin fecha siempre quedan al final.

Los filtros y el orden se aplican en memoria sobre la página actual (o sobre los resultados de la búsqueda), sin volver a consultar la API, y se mantienen al cambiar de página. Los géneros que voy encontrando en cada página se quedan disponibles durante la visita. Si en una página no hay coincidencias, lo indico así, porque puede haberlas en otra. Todo se refleja en la URL, así que se puede compartir una búsqueda o volver atrás desde una ficha sin perder la página ni los filtros.

![Explorar en la página 2 del catálogo, con los géneros Drama y Acción y orden por mejor puntuación](docs/capturas/explorar-filtros.jpg)

### Detalle de una serie

Cada tarjeta lleva a `detalle.html?id=…`, donde muestro el póster, la sinopsis, los géneros, la puntuación, el estado y una ficha técnica con estreno, cadena, idioma, duración y horario.

Los episodios aparecen **agrupados por temporada** en secciones desplegables. Cada temporada se genera solo cuando se abre, porque hay series con cientos de episodios (Los Simpson tienen más de 800).

![Ficha de Stranger Things con sinopsis, ficha técnica y la primera temporada desplegada](docs/capturas/detalle.jpg)

### Favoritos

Cualquier serie se puede guardar pulsando el corazón, ya sea en una tarjeta, en la serie destacada o en su ficha. Cada botón indica su acción («Agregar a favoritos» o «Quitar de favoritos»). Los favoritos se conservan aunque se cierre el navegador, y el enlace «Favoritos» de la navegación muestra cuántos hay guardados.

La vista de favoritos está dentro de Explorar (`explorar.html#favoritos`). Desde ahí se puede quitar cualquier serie y la tarjeta desaparece al instante. Si una serie guardada ya no existe en TVmaze, aviso de ello y ofrezco quitarla, sin que eso impida mostrar las demás.

![Vista de favoritos con cuatro series guardadas](docs/capturas/favoritos.jpg)

### En el móvil

Diseñé la interfaz primero para pantallas pequeñas. En el móvil, la navegación se recoge en un menú desplegable, las tarjetas pasan a dos columnas, los géneros se desplazan en horizontal y la paginación se reduce a flechas.

![Inicio y Explorar con su paginación en una pantalla de móvil](docs/capturas/movil.jpg)

> Las capturas son del 3 de noviembre de 2026. La programación web cambia cada día y los datos dependen de lo que TVmaze tenga en ese momento.

## Tecnologías

- **HTML5 semántico**, con atención a la accesibilidad: enlace para saltar al contenido, botones con nombres que indican su acción, foco visible, navegación por teclado y contrastes AA.
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
├── .nojekyll           # Indica a GitHub Pages que no procese el sitio con Jekyll
├── assets/icons/       # sprite.svg (iconos) y favicon.svg
├── src/
│   ├── scss/           # main.scss + _variables, _base, _layout, _components
│   ├── vendor/axios/   # Copia de Axios (ESM) para el navegador, con su licencia
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
npm run build
```

| Comando | Qué hace |
| --- | --- |
| `npm run build` | Copia Axios a `src/vendor/` y compila los estilos |
| `npm run sass` | Compila `src/scss/main.scss` en `css/main.css` |
| `npm run sass:watch` | Vuelve a compilar cada vez que cambia un archivo `.scss` |
| `npm run vendor` | Copia la versión ESM de Axios (y su licencia) desde `node_modules` a `src/vendor/axios/` |

Siempre edito los archivos `.scss`, nunca `css/main.css` directamente.

Para abrir el proyecto hace falta un servidor local, porque los navegadores bloquean los módulos de JavaScript cuando la página se abre con doble clic (`file://`). Yo uso cualquiera de estas dos opciones:

- La extensión **Live Server** de VS Code.
- `python -m http.server 8000` en la carpeta del proyecto, y después abrir <http://localhost:8000>.

Como no uso empaquetador, `api.js` importa Axios desde una copia local:

```js
import axios from '../vendor/axios/axios.min.js';
```

Esa copia se versiona a propósito: `node_modules/` no se sube al repositorio, y sin ella el sitio publicado no podría cargar Axios. Si actualizo Axios, vuelvo a ejecutar `npm run vendor`.

## Publicar en GitHub Pages

El proyecto es un sitio estático y todas las rutas son relativas, así que funciona tanto en la raíz de un dominio como bajo la ruta de un repositorio (`https://usuario.github.io/series-atlas/`). Antes de publicarlo lo probé en local servido desde una subcarpeta con solo los archivos que se suben al repositorio.

1. Ejecutar `npm run build` y comprobar que `css/main.css` y `src/vendor/axios/` están actualizados.
2. Confirmar los cambios y subirlos a la rama principal del repositorio en GitHub.
3. En el repositorio: **Settings → Pages → Build and deployment**, elegir **Deploy from a branch**, la rama principal y la carpeta **/ (root)**.
4. Esperar a que termine el despliegue y abrir `https://usuario.github.io/nombre-del-repositorio/`.

GitHub Pages sirve el sitio por HTTPS, y la API y las imágenes de TVmaze también usan HTTPS, por lo que no hay contenido mixto.

## Los datos de TVmaze

TVmaze no necesita API key. Estos son los endpoints que uso:

| Endpoint | Para qué lo uso |
| --- | --- |
| `GET /search/shows?q=` | La búsqueda de Explorar |
| `GET /shows?page=N` | El catálogo paginado de Explorar cuando no hay búsqueda |
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
| `page` | `?page=3` | Página del catálogo tal como se muestra (empieza en 1; no se usa al buscar) |
| `genre` | `?genre=Drama&genre=Action` | Géneros de TVmaze; se puede repetir |
| `status` | `?status=Ended` | `Running`, `Ended`, `To Be Determined`, `In Development` |
| `sort` | `?sort=rating-desc` | `rating-desc`, `rating-asc`, `name-asc`, `name-desc`, `year-desc`, `year-asc` |

Si algún valor no es válido, simplemente lo ignoro.

## Limitaciones conocidas

- El índice de TVmaze está ordenado por el ID de cada serie, no por popularidad, y no informa cuántas páginas tiene: el final solo se descubre al pedir una página que ya no existe.
- Los filtros solo trabajan con la página cargada; no buscan un género en todo el índice.
- Guardo en memoria las últimas 8 páginas visitadas; las demás se vuelven a pedir si se regresa a ellas.
- La búsqueda de TVmaze devuelve **como máximo 10 resultados**, así que al combinarla con filtros a veces quedan pocas series.
- TVmaze limita la API a unas 20 solicitudes cada 10 segundos por IP. Ante un error 429 reintento una vez; si se repite, muestro un aviso.
- Dependo de servicios externos (TVmaze y Google Fonts): sin conexión, el sitio muestra sus mensajes de error y las tipografías de respaldo.
- TVmaze no permite pedir varias series en una sola consulta. Para los favoritos reutilizo las que ya tengo en memoria y pido el resto una a una, como máximo cuatro a la vez.
- Los favoritos se guardan en el navegador: no hay cuentas ni sincronización entre dispositivos.

## Créditos

- **Datos de series:** [TVmaze](https://www.tvmaze.com/). Su API se ofrece bajo licencia [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), que pide citar a TVmaze con un enlace; el sitio lo hace en el pie de todas las páginas.
- **Imágenes (pósteres y fotogramas):** las sirve TVmaze desde su CDN y pertenecen a sus respectivos titulares. La documentación de TVmaze permite enlazarlas directamente, pero no indica que estén cubiertas por la licencia CC BY-SA. Series Atlas no posee derechos sobre ellas, ni sobre las sinopsis o los datos.
- **Axios:** © Matt Zabriskie y colaboradores, licencia MIT (incluida en `src/vendor/axios/LICENSE`).
- **Tipografías:** [Fraunces](https://fonts.google.com/specimen/Fraunces) y [Manrope](https://fonts.google.com/specimen/Manrope), desde Google Fonts.
