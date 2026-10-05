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
     * @returns {Promise<{imdbId: string|null, digitalReleaseDate: string|null, platform: string|null}>}
     */
    async getExternalIds(id, type) {
        try {
            const normalizedType = (type === 'tvSeries') ? 'tv' : type;
            const append = normalizedType === 'tv' ? 'external_ids,watch/providers' : 'external_ids,release_dates,watch/providers';
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

            let platform = null;
            if (normalizedType === 'tv' && data.networks && data.networks.length > 0) {
                platform = data.networks[0].name;
            } else if (data['watch/providers']?.results) {
                const providers = data['watch/providers'].results['MX'] || data['watch/providers'].results['US'] || data['watch/providers'].results['ES'] || Object.values(data['watch/providers'].results)[0];
                if (providers && providers.flatrate && providers.flatrate.length > 0) {
                    platform = providers.flatrate[0].provider_name;
                }
            }

            return {
                imdbId: data.external_ids?.imdb_id || null,
                digitalReleaseDate,
                platform
            };
        } catch (e) {
            console.warn('TMDb: Error obteniendo IDs externos para', id, e);
            return { imdbId: null, digitalReleaseDate: null, platform: null };
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

    // ========== PLATAFORMAS ==========

    /**
     * Obtiene el contenido (películas y series) filtrado por plataforma / proveedor.
     * @param {string|number} platformId  ID de proveedor en TMDB (watch_provider)
     * @param {string|number} networkId   ID de cadena/red en TMDB (network)
     * @param {number} page
     * @param {string} language
     * @returns {Promise<{movies: Array, tv: Array}>}
     */
    async getPlatformContent(platformId, networkId = null, page = 1, language = 'es-MX') {
        const fetchMovies = async () => {
            if (!platformId) return [];
            const paramsWithRegion = { language, page, sort_by: 'primary_release_date.desc', include_adult: false, with_watch_providers: platformId, watch_region: 'MX' };
            const resWithRegion = await this.fetch('/discover/movie', paramsWithRegion).catch(() => ({ results: [] }));
            if (resWithRegion.results && resWithRegion.results.length > 0) {
                return resWithRegion.results;
            }
            const paramsNoRegion = { language, page, sort_by: 'primary_release_date.desc', include_adult: false, with_watch_providers: platformId };
            const resNoRegion = await this.fetch('/discover/movie', paramsNoRegion).catch(() => ({ results: [] }));
            return resNoRegion.results || [];
        };

        const fetchTv = async () => {
            let results = [];
            if (networkId) {
                const paramsNet = { language, page, sort_by: 'first_air_date.desc', include_adult: false, with_networks: networkId };
                const resNet = await this.fetch('/discover/tv', paramsNet).catch(() => ({ results: [] }));
                results = resNet.results || [];
            }
            if (results.length === 0 && platformId) {
                const paramsProvRegion = { language, page, sort_by: 'first_air_date.desc', include_adult: false, with_watch_providers: platformId, watch_region: 'MX' };
                const resProvRegion = await this.fetch('/discover/tv', paramsProvRegion).catch(() => ({ results: [] }));
                if (resProvRegion.results && resProvRegion.results.length > 0) {
                    results = resProvRegion.results;
                } else {
                    const paramsProvNoRegion = { language, page, sort_by: 'first_air_date.desc', include_adult: false, with_watch_providers: platformId };
                    const resProvNoRegion = await this.fetch('/discover/tv', paramsProvNoRegion).catch(() => ({ results: [] }));
                    results = resProvNoRegion.results || [];
                }
            }
            return results;
        };

        const [movies, tv] = await Promise.all([fetchMovies(), fetchTv()]);

        return {
            movies: movies.map(item => ({ ...item, media_type: 'movie' })),
            tv: tv.map(item => ({ ...item, media_type: 'tv' }))
        };
    }

    /**
     * Busca películas y series de una plataforma específica.
     * Alias de getPlatformContent.
     */
    async findByPlatform(platformId, networkId = null, page = 1, language = 'es-MX') {
        return this.getPlatformContent(platformId, networkId, page, language);
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
    // ========== HELPERS DE PLATAFORMA ==========

    /**
     * Devuelve una clase CSS o slug normalizado para la plataforma
     * @param {string} platformName
     * @returns {string}
     */
    getPlatformClass(platformName) {
        if (!platformName) return '';
        const name = platformName.toLowerCase();
        if (name.includes('netflix')) return 'platform-netflix';
        if (name.includes('prime') || name.includes('amazon')) return 'platform-prime';
        if (name.includes('disney')) return 'platform-disney';
        if (name.includes('hbo') || name.includes('max')) return 'platform-max';
        if (name.includes('hulu')) return 'platform-hulu';
        if (name.includes('apple')) return 'platform-apple';
        if (name.includes('paramount')) return 'platform-paramount';
        if (name.includes('star+') || name.includes('star plus') || name.includes('star+')) return 'platform-star';
        if (name.includes('peacock')) return 'platform-peacock';
        if (name.includes('crunchyroll')) return 'platform-crunchyroll';
        return 'platform-default';
    }

    // ========== HELPERS DE GÉNEROS ==========

    /**
     * Obtiene el listado de nombres de géneros excluidos desde localStorage o configuración por defecto.
     * @returns {string[]}
     */
    getExcludedGenreNames() {
        const cfg = window.CONFIG || {};
        const saved = localStorage.getItem('excluded_genres');
        const raw = (saved !== null) ? saved : (cfg.DEFAULT_EXCLUDED_GENRES || 'Talk Show, Documental');
        return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    }

    /**
     * Obtiene los IDs de géneros excluidos resolviendo nombres con TMDB_GENRES y alias en inglés.
     * @returns {Set<number>}
     */
    getExcludedGenreIds() {
        const names = this.getExcludedGenreNames();
        const genreMap = (window.CONFIG && window.CONFIG.TMDB_GENRES) || {};
        const englishAliases = {
            'talk show': 10767,
            'talkshow': 10767,
            'documentary': 99,
            'documental': 99,
            'news': 10763,
            'noticias': 10763,
            'reality': 10764,
            'soap': 10766,
            'telenovela': 10766,
            'war': 10752,
            'bélica': 10752,
            'belica': 10752,
            'animation': 16,
            'animación': 16,
            'animacion': 16,
            'comedy': 35,
            'comedia': 35,
            'action': 28,
            'acción': 28,
            'accion': 28,
            'action & adventure': 10759,
            'adventure': 12,
            'aventura': 12,
            'crime': 80,
            'crimen': 80,
            'drama': 18,
            'family': 10751,
            'familia': 10751,
            'fantasy': 14,
            'fantasía': 14,
            'fantasia': 14,
            'history': 36,
            'historia': 36,
            'horror': 27,
            'terror': 27,
            'music': 10402,
            'música': 10402,
            'musica': 10402,
            'mystery': 9648,
            'misterio': 9648,
            'romance': 10749,
            'science fiction': 878,
            'ciencia ficción': 878,
            'ciencia ficcion': 878,
            'sci-fi': 10765,
            'sci-fi & fantasy': 10765,
            'tv movie': 10770,
            'película de tv': 10770,
            'pelicula de tv': 10770,
            'thriller': 53,
            'suspenso': 53,
            'western': 37,
            'kids': 10762,
            'niños': 10762,
            'ninos': 10762,
            'politics': 10768,
            'política': 10768,
            'politica': 10768,
            'war & politics': 10768
        };

        const ids = new Set();
        names.forEach(name => {
            const clean = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            // Buscar por ID si el usuario ingresó un número
            const num = parseInt(name, 10);
            if (!isNaN(num) && num > 0) {
                ids.add(num);
                return;
            }
            // Buscar en alias en inglés / normalizados
            for (const [alias, id] of Object.entries(englishAliases)) {
                const cleanAlias = alias.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                if (clean === cleanAlias || cleanAlias.includes(clean) || clean.includes(cleanAlias)) {
                    ids.add(id);
                }
            }
            // Buscar en mapa oficial de TMDb
            for (const [idStr, genreName] of Object.entries(genreMap)) {
                const cleanGenre = genreName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                if (clean === cleanGenre || cleanGenre.includes(clean) || clean.includes(cleanGenre)) {
                    ids.add(Number(idStr));
                }
            }
        });
        return ids;
    }

    /**
     * Comprueba si un ítem debe ser excluido según sus géneros.
     * Soporta items con genre_ids (array de ints) o genres (array de objetos {id, name}).
     * @param {Object} item 
     * @returns {boolean} true si el contenido debe ser excluido
     */
    isGenreExcluded(item) {
        if (!item) return false;
        const excludedIds = this.getExcludedGenreIds();
        const excludedNames = this.getExcludedGenreNames();
        if (excludedIds.size === 0 && excludedNames.length === 0) return false;

        // Comprobar genre_ids
        const genreIds = item.genre_ids || [];
        for (const id of genreIds) {
            if (excludedIds.has(Number(id))) return true;
        }

        // Comprobar array de objetos genres [{id, name}]
        if (Array.isArray(item.genres)) {
            for (const g of item.genres) {
                if (g.id && excludedIds.has(Number(g.id))) return true;
                if (g.name) {
                    const cleanName = g.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    for (const exName of excludedNames) {
                        const cleanEx = exName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                        if (cleanName === cleanEx || cleanName.includes(cleanEx)) return true;
                    }
                }
            }
        }

        return false;
    }

    // ========== HELPERS DE PAÍSES ==========

    /**
     * Obtiene el listado de nombres de países excluidos desde localStorage o configuración por defecto.
     * @returns {string[]} lista de nombres en minúsculas normalizados
     */
    getExcludedCountries() {
        const cfg = window.CONFIG || {};
        const saved = localStorage.getItem('excluded_countries');
        const raw = (saved !== null) ? saved : (cfg.DEFAULT_EXCLUDED_COUNTRIES || 'India');
        return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    }

    /**
     * Comprueba si un ítem debe ser excluido por su país de origen.
     * Verifica origin_country (array de códigos ISO) y production_countries (array {iso_3166_1, name}).
     * @param {Object} item
     * @returns {boolean} true si el contenido debe ser excluido
     */
    isCountryExcluded(item) {
        if (!item) return false;
        const excluded = this.getExcludedCountries();
        if (excluded.length === 0) return false;

        // Mapa de nombres comunes → códigos ISO 3166-1 alpha-2
        const countryIsoMap = {
            'india': 'IN',
            'turquía': 'TR', 'turquia': 'TR', 'turkey': 'TR',
            'corea del sur': 'KR', 'corea': 'KR', 'korea': 'KR', 'south korea': 'KR',
            'china': 'CN',
            'hong kong': 'HK', 'hongkong': 'HK',
            'tailandia': 'TH', 'thailand': 'TH',
            'japón': 'JP', 'japon': 'JP', 'japan': 'JP',
            'indonesia': 'ID',
            'filipinas': 'PH', 'philippines': 'PH',
            'vietnam': 'VN',
            'pakistan': 'PK', 'pakistán': 'PK',
            'bangladesh': 'BD',
            'nigeria': 'NG',
            'brasil': 'BR', 'brazil': 'BR',
            'méxico': 'MX', 'mexico': 'MX',
            'argentina': 'AR',
            'colombia': 'CO',
            'españa': 'ES', 'espana': 'ES', 'spain': 'ES',
            'estados unidos': 'US', 'usa': 'US', 'united states': 'US',
            'reino unido': 'GB', 'uk': 'GB', 'united kingdom': 'GB',
            'francia': 'FR', 'france': 'FR',
            'alemania': 'DE', 'germany': 'DE',
            'italia': 'IT', 'italy': 'IT',
            'rusia': 'RU', 'russia': 'RU',
            'taiwán': 'TW', 'taiwan': 'TW',
            'malasia': 'MY', 'malaysia': 'MY',
            'egipto': 'EG', 'egypt': 'EG',
        };

        // ── Mapa de código de idioma → país(es) de origen ──────────────────────
        // CRÍTICO: Las respuestas de lista TMDB para PELÍCULAS no incluyen
        // origin_country ni production_countries. Solo tienen original_language.
        // Este mapa permite filtrar películas por su idioma original.
        const langToCountries = {
            // Idiomas predominantemente de India
            'hi': ['IN'],   // Hindi
            'ta': ['IN'],   // Tamil
            'te': ['IN'],   // Telugu
            'ml': ['IN'],   // Malayalam
            'kn': ['IN'],   // Kannada
            'mr': ['IN'],   // Marathi
            'pa': ['IN'],   // Punjabi
            'gu': ['IN'],   // Gujarati
            'bn': ['IN', 'BD'],  // Bengalí (India y Bangladesh)
            'or': ['IN'],   // Oriya
            'as': ['IN'],   // Asamés
            'mai': ['IN'],  // Maithili
            'ur': ['PK', 'IN'], // Urdu
            // Otros
            'tr': ['TR'],   // Turco
            'ko': ['KR'],   // Coreano
            'zh': ['CN', 'HK', 'TW'], // Chino
            'yue': ['HK'],  // Cantonés
            'th': ['TH'],   // Tailandés
            'ja': ['JP'],   // Japonés
            'id': ['ID'],   // Indonesio
            'vi': ['VN'],   // Vietnamita
            'ms': ['MY'],   // Malayo
            'tl': ['PH'],   // Filipino
            'ru': ['RU'],   // Ruso
            'ar': ['EG', 'SA', 'AE'], // Árabe
            'pt': ['BR', 'PT'], // Portugués
            'es': ['ES', 'MX', 'AR', 'CO'],
            'fr': ['FR'],
            'de': ['DE'],
            'it': ['IT'],
            'en': ['US', 'GB', 'AU', 'CA'],
        };

        const normalize = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        // Construir set de códigos ISO excluidos a partir de los nombres escritos por el usuario
        const excludedIso = new Set();
        for (const name of excluded) {
            const cleanName = normalize(name);
            // Si el usuario escribió un código ISO directamente (2 letras)
            if (/^[a-z]{2}$/i.test(name.trim())) {
                excludedIso.add(name.trim().toUpperCase());
                continue;
            }
            for (const [key, iso] of Object.entries(countryIsoMap)) {
                if (normalize(key) === cleanName || normalize(key).includes(cleanName) || cleanName.includes(normalize(key))) {
                    excludedIso.add(iso);
                }
            }
        }

        // 1. Comprobar origin_country (disponible en series TV de TMDB)
        if (Array.isArray(item.origin_country)) {
            for (const code of item.origin_country) {
                if (excludedIso.has(code.toUpperCase())) return true;
                for (const name of excluded) {
                    if (normalize(code) === normalize(name)) return true;
                }
            }
        }

        // 2. Comprobar production_countries (disponible en detalle de película)
        if (Array.isArray(item.production_countries)) {
            for (const pc of item.production_countries) {
                if (pc.iso_3166_1 && excludedIso.has(pc.iso_3166_1.toUpperCase())) return true;
                if (pc.name) {
                    const cleanPc = normalize(pc.name);
                    for (const name of excluded) {
                        if (cleanPc === normalize(name) || cleanPc.includes(normalize(name))) return true;
                    }
                }
            }
        }

        // 3. Fallback: usar original_language para películas (las listas TMDB no
        //    incluyen origin_country en respuestas de movies/popular, trending, etc.)
        if (item.original_language) {
            const lang = item.original_language.toLowerCase();
            const countriesForLang = langToCountries[lang] || [];
            for (const iso of countriesForLang) {
                if (excludedIso.has(iso)) return true;
            }
        }

        return false;
    }
}

// Instancia global — usa window.CONFIG si está disponible
window.tmdb = new TMDb();
