# Movie Search App - APK Packaging Instructions

Esta es una aplicación web optimizada para **Android TV y Dispositivos Móviles**. Para convertirla en un archivo APK instalable, sigue estos pasos recomendados usando **Capacitor**.

## Requisitos Previos
- [Node.js](https://nodejs.org/) instalado.
- [Android Studio](https://developer.android.com/studio) instalado.

## Pasos para generar el APK

> **Nota**: Copia solo los comandos dentro de los bloques de código, no los encabezados.

1. **Instalar Capacitor**:
   ```bash
   npm install @capacitor/core @capacitor/cli @capacitor/android
   ```

2. **Inicializar Capacitor**:
   ```bash
   npx cap init MovieSearch com.tuempresa.moviesearch --web-dir .
   ```
   *Si el asistente te pregunta por el **Web asset directory**, escribe `.` (un punto) y pulsa Enter. **No uses `www`** a menos que muevas tus archivos a esa carpeta.*

3. **Agregar la plataforma Android**:
   ```bash
   npx cap add android
   ```

4. **Sincronizar cambios** (opcional, si editas archivos después):
   ```bash
   npx cap copy
   ```

5. **Abrir el proyecto en Android Studio**:
   ```bash
   npx cap open android
   ```

4. **Generar el APK en Android Studio**:
   - Espera a que Gradle termine de sincronizar.
   - Ve a **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
   - Una vez finalizado, aparecerá una notificación con el enlace al archivo `app-debug.apk`.

## Notas de Desarrollo para TV
- La aplicación ya incluye lógica de **Navegación Espacial** (D-Pad), por lo que las flechas del control de Chromecast funcionarán automáticamente para mover el foco entre la barra de búsqueda y las películas.
- El botón de micrófono utiliza la API de voz estándar; en Android, esto invocará el diálogo de voz del sistema si el WebView lo permite.

## Características de la App
- **Autocomplete**: Búsqueda en tiempo real usando IMDb.
- **Responsive**: Se adapta a pantallas 16:9 (TV) y 9:16 (Móvil).
- **Dark Mode**: Optimizado para pantallas OLED.
