/**
 * Módulo de Validación de Películas - MauriTV
 * Centraliza la lógica para verificar si un contenido está disponible.
 */

/**
 * Valida la disponibilidad de la película consultando al servicio de imobiledeals.
 */
async function validarPeliculaFinal(id) {
    try {
        const url = `https://imobiledeals.com/service/verify?id=${id}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            console.warn(`Error HTTP al verificar ${id}: ${response.status}`);
            return false;
        }

        const data = await response.json();
        return data.disponible === true;
    } catch (error) {
        console.error(`Error en validación API para ${id}:`, error);
        return false;
    }
}
