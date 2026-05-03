# 🎬 MariTV

**MariTV** es un proyecto personal que ofrece una interfaz simple y amigable para explorar y reproducir películas y series online.

🔗 Sitio: https://mauritv.tourn1.com

---

## 🚀 Descripción

MariTV combina información de contenido audiovisual con reproducción directa, permitiendo al usuario:

- Explorar películas y series
- Ver detalles como sinopsis, rating y fecha de estreno
- Reproducir contenido directamente desde la web
- Navegar de forma rápida y responsive

Todo esto con una experiencia enfocada en simplicidad y usabilidad.

---

## ⚙️ Cómo funciona

El proyecto se basa en la integración de dos fuentes principales:

### 1. TMDb API
Se utiliza la API de **The Movie Database (TMDb)** para obtener:

- Listado de películas y series
- Información detallada (título, descripción, géneros, etc.)
- Posters e imágenes
- Ratings y fechas de lanzamiento

Esto permite tener un catálogo actualizado y bien estructurado.

---

### 2. PlayIMDB (fuente de reproducción)

Para la reproducción del contenido, MariTV utiliza embeds externos provenientes de:

- https://playimdb.*

A partir del **ID de IMDb** (obtenido desde TMDb), se construye dinámicamente una URL de reproducción, por ejemplo:

https://playimdb.ru/embed/movie/{imdb_id}

Esto permite:

- Reproducir películas y series directamente en la web
- Evitar almacenamiento o hosting de contenido
- Mantener el proyecto liviano

---

## 🧠 Flujo de la aplicación

1. El usuario navega por el catálogo
2. La app consulta TMDb para obtener datos
3. Se obtiene el `imdb_id` del contenido seleccionado
4. Se construye la URL de reproducción
5. Se carga un `<iframe>` con el player externo

---

## 💻 Tecnologías utilizadas

- HTML / CSS / JavaScript
- Fetch API
- TMDb API
- Embeds externos (PlayIMDB)

---

## 📱 Diseño

- Interfaz responsive (adaptada a mobile y desktop)
- Navegación simple e intuitiva
- Enfoque en velocidad de carga

---

## ⚠️ Disclaimer

MariTV es un proyecto personal sin fines comerciales.

- No almacena contenido audiovisual
- No es dueño de los streams reproducidos
- Todo el contenido es proporcionado por servicios de terceros

---

## 🛠️ Mejoras futuras

- Búsqueda avanzada
- Filtros por género / año
- Sistema de favoritos
- Historial de reproducción
- Mejor detección de errores en players externos

---

## 👨‍💻 Autor

Desarrollado por Mauricio Tourn como proyecto personal.

---

