/**
 * vaplayer.js — Wrapper para el reproductor VAPlayer / VidSrc
 * Instancia global: window.vaPlayer
 */
class VAPlayer {
    /**
     * @param {string} host  Host base del reproductor, ej: 'https://vaplayer.ru'
     */
    constructor(host) {
        const defaultHost = (window.CONFIG && window.CONFIG.DEFAULT_PLAYER_URL) || 'https://vaplayer.ru';
        this.host = (host || defaultHost).replace(/\/$/, '');
    }

    /**
     * Retorna el host actual del reproductor.
     * @returns {string}
     */
    getHost() {
        return this.host;
    }

    /**
     * Actualiza el host y lo persiste en localStorage.
     * @param {string} newHost
     */
    setHost(newHost) {
        const defaultHost = (window.CONFIG && window.CONFIG.DEFAULT_PLAYER_URL) || 'https://vaplayer.ru';
        this.host = (newHost || defaultHost).replace(/\/$/, '');
        localStorage.setItem('player_url', this.host);
    }

    /**
     * Construye la URL de embed para el reproductor.
     * Para películas: /embed/movie/{id}
     * Para series:    /embed/tv/{id}/{season}/{episode}/
     *
     * @param {string} id        ID de la película o serie (IMDB o TMDb)
     * @param {string} type      'movie' | 'tv'
     * @param {string|null} season    Número de temporada (solo para TV)
     * @param {string|null} episode   Número de episodio (solo para TV)
     * @param {Object} extraParams   Parámetros adicionales de query string
     * @returns {string}
     */
    embedUrl(id, type, season = null, episode = null, extraParams = {}) {
        let endpoint;
        if (type === 'tv' && season && episode) {
            endpoint = `/embed/tv/${id}/${season}/${episode}/`;
        } else {
            endpoint = `/embed/movie/${id}`;
        }

        const params = new URLSearchParams(extraParams);
        const qs = params.toString();
        return `${this.host}${endpoint}${qs ? '?' + qs : ''}`;
    }

    /**
     * URL simple de embed con sub_lang y cache bust (uso legado desde index.html).
     * @param {string} id
     * @param {string} type  'movie' | 'tv'
     * @returns {string}
     */
    simpleEmbedUrl(id, type) {
        return `${this.host}/embed/${type}/${id}?sub_lang=es&v=${Date.now()}`;
    }

    /**
     * Retorna true si el host actual es VidSrc (diferente comportamiento de sandbox).
     * @returns {boolean}
     */
    isVidSrc() {
        return this.host.includes('vidsrcme');
    }

    /**
     * Extrae y formatea la resolución y fuente a partir de un nombre de archivo.
     * @param {string} fileName Nombre del archivo.
     * @param {string} defaultRes Resolución por defecto (fallback).
     * @param {string} defaultSrc Fuente por defecto (fallback).
     * @returns {string} Texto formateado para el badge, ej: "1080p Webrip".
     */
    getQualityBadgeText(fileName, defaultRes = '', defaultSrc = '') {
        let extractedRes = '';
        let extractedSrc = '';
        if (fileName) {
            const resMatch = fileName.match(/(2160p|1080p|720p|480p|4k)/i);
            const srcMatch = fileName.match(/(webrip|web-dl|bluray|bdrip|brrip|hdtv|dvdrip|cam|ts|TELESYNC|Telesync|WEB-DL|Web-DL)/i);
            if (resMatch) extractedRes = resMatch[1].toLowerCase();
            if (srcMatch) extractedSrc = srcMatch[1].toUpperCase();
        }
        const displayRes = extractedRes || defaultRes;
        let displaySrc = extractedSrc || defaultSrc;
        if (displaySrc && !extractedSrc) {
            displaySrc = displaySrc.toUpperCase();
        }
        return [displaySrc, displayRes].filter(Boolean).join(' ');
    }
}

// Instancia global — lee el host guardado en localStorage o usa window.CONFIG
const _defaultPlayerUrl = (window.CONFIG && window.CONFIG.DEFAULT_PLAYER_URL) || 'https://vaplayer.ru';
window.vaPlayer = new VAPlayer(localStorage.getItem('player_url') || _defaultPlayerUrl);
