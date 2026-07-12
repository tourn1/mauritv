/**
 * opensubtitles.js — Wrapper para la API de OpenSubtitles v1
 * Instancia global: window.openSubtitles
 */
class OpenSubtitles {
    /**
     * @param {string} apiKey  API Key de OpenSubtitles
     */
    constructor(apiKey) {
        const cfg = window.CONFIG || {};
        this.apiKey = apiKey || cfg.OPENSUBTITLES_API_KEY;
        this.baseUrl = cfg.OPENSUBTITLES_BASE_URL || 'https://api.opensubtitles.com/api/v1';
        this.SMART_MATCH_THRESHOLD = 1.0;
    }

    // ========== BÚSQUEDA DE SUBTÍTULOS ==========

    /**
     * Busca subtítulos para una película o episodio de serie.
     * @param {string} imdbId   IMDB ID completo, ej: 'tt0068646'
     * @param {string} type     'movie' | 'tv'
     * @param {string|null} season    Temporada (solo TV)
     * @param {string|null} episode   Episodio (solo TV)
     * @param {string} language       Código de idioma (ej: 'es')
     * @returns {Promise<Array>}  Array de items de subtítulos con { fileId, release, score }
     */
    async search(imdbId, type, season = null, episode = null, language = 'es,ea') {
        if (!imdbId) return [];

        let url = `${this.baseUrl}/subtitles?languages=${language}`;
        const numericId = imdbId.replace('tt', '');

        if (type === 'tv' && season && episode) {
            url += `&imdb_id=${numericId}&season_number=${season}&episode_number=${episode}`;
        } else {
            url += `&imdb_id=${numericId}`;
        }

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Api-Key': this.apiKey,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        return data.data || [];
    }

    /**
     * Busca subtítulos y aplica SmartMatch para ordenarlos por relevancia.
     * Retorna el array de subtítulos con score y el índice del mejor match.
     *
     * @param {string} imdbId
     * @param {string} type
     * @param {string|null} season
     * @param {string|null} episode
     * @param {string} videoFileName  Nombre del archivo de video para SmartMatch
     * @param {string} language
     * @returns {Promise<{items: Array, bestIndex: number, recommended: boolean}>}
     */
    async searchAndMatch(imdbId, type, season = null, episode = null, videoFileName = '', language = 'es,ea') {
        const rawItems = await this.search(imdbId, type, season, episode, language);

        if (rawItems.length === 0) return { items: [], bestIndex: 0, recommended: false };

        const hasVideo = !!videoFileName;
        let bestIndex = 0;
        let maxScore = -1;

        const items = rawItems.map((item, idx) => {
            const fileId = item.attributes.files[0].file_id;
            const release = item.attributes.release || item.attributes.files[0].file_name || '';
            const score = hasVideo ? this.smartMatchScore(videoFileName, release) : 0;
            if (score > maxScore) { maxScore = score; bestIndex = idx; }
            return { fileId, release, score };
        });

        const recommended = hasVideo && maxScore >= this.SMART_MATCH_THRESHOLD;
        return { items, bestIndex, recommended };
    }

    // ========== DESCARGA ==========

    /**
     * Obtiene el link de descarga directa de un subtítulo por su file_id.
     * @param {string|number} fileId
     * @returns {Promise<string|null>}  URL de descarga o null si falló
     */
    async getDownloadLink(fileId) {
        try {
            const res = await fetch(`${this.baseUrl}/download`, {
                method: 'POST',
                headers: {
                    'Api-Key': this.apiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ file_id: fileId }),
                referrer: 'https://www.opensubtitles.com/',
                referrerPolicy: 'origin'
            });
            if (!res.ok) throw new Error(`API error: ${res.status}`);
            return (await res.json()).link;
        } catch (e) {
            console.error('OpenSubtitles: Error al obtener link de descarga', e);
            return null;
        }
    }

    // ========== SMARTMATCH ==========

    /**
     * Normaliza un nombre de archivo/release para comparación.
     * @param {string} name
     * @returns {string}
     */
    smartMatchNormalize(name) {
        if (!name) return '';
        name = name.split(/[\/\\]/).pop();
        name = name.replace(/\.(mp4|mkv|avi|mov|srt|ass|ssa|sub|idx)$/i, '');
        return name.toLowerCase().replace(/[\s._\-()\[\]]+/g, ' ').trim();
    }

    /**
     * Detecta el grupo de release en un nombre normalizado.
     * @param {string} normalizedName
     * @returns {string|null}
     */
    smartMatchGroup(normalizedName) {
        const groupRegex = /(yts|rarbg|psa|galaxyrg|ion10|evo|flxtv|hazel|shaanig|nitro|vision|bifos|web-dl|amzn)/gi;
        const matches = normalizedName.match(groupRegex);
        return matches ? matches[matches.length - 1].toLowerCase() : null;
    }

    /**
     * Calcula el score de coincidencia entre el archivo de video y un release de subtítulo.
     * @param {string} videoFileName
     * @param {string} subtitleRelease
     * @returns {number}
     */
    smartMatchScore(videoFileName, subtitleRelease) {
        const normVideo = this.smartMatchNormalize(videoFileName);
        const normSub = this.smartMatchNormalize(subtitleRelease);

        if (!normVideo || !normSub) return 0;
        if (normVideo === normSub) return 10.0;

        let score = 0;

        if (normVideo.includes(normSub) || normSub.includes(normVideo)) {
            score += 2.0;
        }

        const videoTokens = new Set(normVideo.split(' ').filter(t => t.length >= 3));
        const subTokens = normSub.split(' ').filter(t => t.length >= 3);
        const significant = subTokens.length;

        if (significant > 0) {
            const found = subTokens.filter(t => videoTokens.has(t)).length;
            const tokenScore = found / significant;
            score += tokenScore;

            const videoGroup = this.smartMatchGroup(normVideo);
            const subGroup = this.smartMatchGroup(normSub);
            if (videoGroup && subGroup && videoGroup === subGroup && tokenScore > 0.2) {
                score += 5.0;
            }
        }

        return score;
    }
}

// Instancia global — usa window.CONFIG si está disponible
window.openSubtitles = new OpenSubtitles();
