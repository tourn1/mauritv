/**
 * verify.js — Validación de disponibilidad de contenido
 *
 * Lee la configuración desde localStorage en cada invocación, por lo que
 * siempre refleja el valor más reciente aunque el usuario haya cambiado
 * la URL o toggles desde el panel de configuración.
 *
 * Expone: window.validarPeliculaFinal
 */

/**
 * Valida si un contenido está disponible consultando el servicio de verificación de streamdata.vaplayer.ru.
 *
 * @param {string}        id       IMDB ID o TMDb ID del contenido (debe ser el IMDB para la API de streamdata)
 * @param {string}        type     'movie' | 'tv' (se normaliza 'tvSeries' → 'tv')
 * @param {number|string} season   Temporada (solo para TV, por defecto 1)
 * @param {number|string} episode  Episodio (solo para TV, por defecto 1)
 * @returns {Promise<{
 *   disponible: boolean,
 *   resolution: string,
 *   source: string,
 *   file_name: string
 * }>}
 */
async function validarPeliculaFinal(id, type, season = 1, episode = 1) {
    if (!id) return { disponible: false, resolution: '', source: '', file_name: '' };

    // Normalizar tipo
    if (type === 'tvSeries') {
        type = 'tv';
    }

    const cfg = window.CONFIG || {};
    const VERIFY_DISPONIBILIDAD = localStorage.getItem('verify_disponibilidad') === 'true';
    const BLOCK_LOW_RES = localStorage.getItem('block_low_res') !== 'false';
    const HIDDEN_RESOLUTIONS = cfg.HIDDEN_RESOLUTIONS || ['CAM', 'TS', 'TC'];

    // Si la verificación está desactivada, todo se considera disponible
    if (!VERIFY_DISPONIBILIDAD) {
        return { disponible: true, resolution: '', source: '', file_name: '' };
    }

    const defaultVerifyUrl = cfg.DEFAULT_VERIFY_API_URL || 'https://streamdata.vaplayer.ru/api.php';
    const VERIFY_API_URL = localStorage.getItem('verify_api_url') || defaultVerifyUrl;

    // Construir la URL del endpoint de verificación
    let url = `${VERIFY_API_URL}?imdb=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}`;
    if (type === 'tv') {
        url += `&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`;
    }

    let validationResult = { disponible: false, resolution: '', source: '', file_name: '' };

    try {
        console.log(`[verify] Verificando disponibilidad para ID: ${id}, URL: ${url}`);
        const response = await fetch(url, {
            method: 'GET',
            cache: 'no-store'
        });
        if (!response.ok) {
            console.error(`[verify] Error HTTP ${response.status} al consultar ${url}`);
            throw new Error(`HTTP ${response.status}`);
        }
        const responseData = await response.json();
        console.log(`[verify] Respuesta de streamdata para ${id}:`, responseData);
        
        // El contenido puede venir anidado en .data o estar en la raíz
        const dataInfo = responseData.data || responseData;

        // La lógica de validación es que debe tener dataInfo.file_name completo (no vacío)
        if (dataInfo && dataInfo.file_name && String(dataInfo.file_name).trim() !== '') {
            const q = dataInfo.quality_info || {};
            validationResult = {
                disponible: true,
                resolution: q.resolucion || dataInfo.resolution || 'HD',
                source: q.fuente || dataInfo.source || 'EXT',
                file_name: dataInfo.file_name
            };
            console.log(`[verify] Contenido ${id} DISPONIBLE:`, validationResult);
        } else {
            console.warn(`[verify] Contenido ${id} NO DISPONIBLE (file_name vacío o nulo).`);
        }
    } catch (error) {
        console.error(`[verify] Falló la verificación en streamdata para ${id} (${url}):`, error);
    }

    // Aplicar filtro de resoluciones/fuentes ocultas si está disponible
    if (validationResult.disponible && BLOCK_LOW_RES) {
        let isHidden = false;
        const res = String(validationResult.resolution || '').toUpperCase();
        const src = String(validationResult.source || '').toUpperCase();
        
        if (HIDDEN_RESOLUTIONS.includes(res) || HIDDEN_RESOLUTIONS.includes(src)) {
            isHidden = true;
        }

        if (!isHidden && validationResult.file_name) {
            const srcMatch = String(validationResult.file_name).match(/(webrip|web-dl|bluray|bdrip|brrip|hdtv|dvdrip|cam|ts)/i);
            if (srcMatch && HIDDEN_RESOLUTIONS.includes(srcMatch[1].toUpperCase())) {
                isHidden = true;
            }
        }

        if (isHidden) {
            validationResult.disponible = false;
        }
    }

    return validationResult;
}

// Exponer globalmente
window.validarPeliculaFinal = validarPeliculaFinal;
