/**
 * tmdb.js — Wrapper para la API de The Movie Database (TMDb)
 * Instancia global: window.tmdb
 */
class TMDb {
    /**
     * @param {string} apiKey  API Key de TMDb
     * @param {string} baseUrl Base URL de la API (por defecto v3)
     */
    constructor(apiKey, baseUrl) {
        const cfg = window.CONFIG || {};
        this.apiKey = apiKey || cfg.TMDB_API_KEY;
        this.baseUrl = baseUrl || cfg.TMDB_BASE_URL || 'https://api.themoviedb.org/3';
        this.POSTER_SIZE = cfg.TMDB_POSTER_SIZE || 'w300';
        this.BACKDROP_SIZE = cfg.TMDB_BACKDROP_SIZE || 'original';
        this.IMAGE_BASE = 'https://image.tmdb.org/t/p';
    }

    // ========== CORE FETCH ==========

    /**
     * Realiza una petición autenticada a la API de TMDb.
     * @param {string} endpoint  Ruta relativa, ej: '/search/multi'
     * @param {Object} params    Parámetros adicionales de query string
     * @returns {Promise<Object>}
     */
    async fetch(endpoint, params = {}) {
        const url = new URL(`${this.baseUrl}${endpoint}`);
        url.searchParams.append('api_key', this.apiKey);
        url.searchParams.append('v', Date.now());
        Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));
        const response = await fetch(url);
        if (!response.ok) throw new Error(`TMDb API Error: ${response.status} en ${endpoint}`);
        return response.json();
    }

    // ========== BÚSQUEDA ==========

    /**
     * Búsqueda multi (películas, series, personas).
     * @param {string} query
     * @param {string} language  Código de idioma (ej: 'es-MX')
     * @param {number} page
     * @returns {Promise<Object>}
     */
    async search(query, language = 'es-MX', page = 1) {
        return this.fetch('/search/multi', { query, language, page, include_adult: false });
    }

    // ========== DETALLES ==========

    /**
     * Obtiene los detalles completos de una película o serie.
     * @param {string|number} id    ID de TMDb
     * @param {string} type         'movie' | 'tv'
     * @param {string} appendToResponse  Campos adicionales separados por coma
     * @param {string} language
     * @returns {Promise<Object>}
     */
    async getDetails(id, type, appendToResponse = '', language = 'es-MX') {
        const endpoint = `/${type}/${id}`;
        const params = { language };
        if (appendToResponse) params.append_to_response = appendToResponse;
        return this.fetch(endpoint, params);
    }

    /**
     * Obtiene IDs externos (imdb_id, etc.) y fecha de lanzamiento digital de una película/serie.
     * @param {string|number} id
     * @param {string} type  'movie' | 'tv' | 'tvSeries'
     * @returns {Promise<{imdbId: string|null, digitalReleaseDate: string|null}>}
     */
    async getExternalIds(id, type) {
        try {
            const normalizedType = (type === 'tvSeries') ? 'tv' : type;
            const append = normalizedType === 'tv' ? 'external_ids' : 'external_ids,release_dates';
            const data = await this.fetch(`/${normalizedType}/${id}`, { append_to_response: append });

            let digitalReleaseDate = null;
            if (data.release_dates?.results) {
                for (const res of data.release_dates.results) {
                    const digital = res.release_dates.find(rd => rd.type === 4);
                    if (digital) {
                        digitalReleaseDate = digital.release_date.split('T')[0];
                        break;
                    }
                }
            }

            return {
                imdbId: data.external_ids?.imdb_id || null,
                digitalReleaseDate
            };
        } catch (e) {
            console.warn('TMDb: Error obteniendo IDs externos para', id, e);
            return { imdbId: null, digitalReleaseDate: null };
        }
    }

    // ========== VIDEOS / TRAILERS ==========

    /**
     * Busca el trailer oficial de una película/serie en múltiples idiomas.
     * @param {string|number} id
     * @param {string} type  'movie' | 'tv'
     * @returns {Promise<string|null>} YouTube key del trailer o null
     */
    async getTrailerKey(id, type) {
        const idiomas = ['es-MX', 'es-ES', 'en-US'];
        for (const lang of idiomas) {
            try {
                const data = await this.fetch(`/${type}/${id}/videos`, { language: lang });
                if (data.results?.length) {
                    const video =
                        data.results.find(v => v.site === 'YouTube' && v.type === 'Trailer' && v.official === true) ||
                        data.results.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
                        data.results.find(v => v.site === 'YouTube' && v.type === 'Teaser') ||
                        data.results.find(v => v.site === 'YouTube');
                    if (video?.key) return video.key;
                }
            } catch (e) {
                console.log(`TMDb: Error buscando trailer en ${lang}:`, e);
            }
        }
        return null;
    }

    // ========== TRENDING ==========

    /**
     * Obtiene contenido popular usando un endpoint y parámetros.
     * @param {string} endpoint  Endpoint de TMDb, ej: '/discover/movie'
     * @param {Object} params
     * @returns {Promise<Object>}
     */
    async getTrending(endpoint, params = {}) {
        return this.fetch(endpoint, params);
    }

    // ========== RECOMENDACIONES ==========

    /**
     * Obtiene recomendaciones basadas en una película/serie.
     * @param {string|number} id
     * @param {string} type  'movie' | 'tv'
     * @param {string} language
     * @returns {Promise<Object>}
     */
    async getRecommendations(id, type, language = 'es-MX') {
        return this.fetch(`/${type}/${id}/recommendations`, { language, page: 1 });
    }

    // ========== PERSONAS ==========

    /**
     * Obtiene los créditos combinados (cast + crew) de una persona.
     * @param {string|number} personId
     * @param {string} language
     * @returns {Promise<Object>}
     */
    async getPersonCredits(personId, language = 'es-MX') {
        return this.fetch(`/person/${personId}/combined_credits`, { language });
    }

    // ========== HELPERS DE IMÁGENES ==========

    /**
     * Construye la URL completa de un póster.
     * @param {string} path  path relativo de TMDb, ej: '/abc123.jpg'
     * @param {string} size  Tamaño (ej: 'w300', 'w500')
     * @returns {string}
     */
    posterUrl(path, size) {
        return `${this.IMAGE_BASE}/${size || this.POSTER_SIZE}${path}`;
    }

    /**
     * Construye la URL completa de un backdrop/banner.
     * @param {string} path
     * @param {string} size
     * @returns {string}
     */
    backdropUrl(path, size) {
        return `${this.IMAGE_BASE}/${size || this.BACKDROP_SIZE}${path}`;
    }
}

// Instancia global — usa window.CONFIG si está disponible
window.tmdb = new TMDb();
