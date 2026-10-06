/**
 * config.js — Constantes y configuraciones globales para MauriTV
 */
const CONFIG = {
    // TMDb API
    TMDB_API_KEY: '12916916a032ac4a2da17601cbc119bd',
    TMDB_BASE_URL: 'https://api.themoviedb.org/3',
    TMDB_POSTER_SIZE: 'w300',
    TMDB_BACKDROP_SIZE: 'original',

    // OpenSubtitles API
    OPENSUBTITLES_API_KEY: 'SQMOf8KwHb06tmTZjKFAOEACEbKSQ25G',
    OPENSUBTITLES_BASE_URL: 'https://api.opensubtitles.com/api/v1',

    // Default Fallbacks
    DEFAULT_PLAYER_URL: 'https://vaplayer.ru',
    DEFAULT_VERIFY_API_URL: 'https://imobiledeals.com/service/v',

    // App configurations
    HISTORY_KEY: 'movie_history_v1',
    HIDDEN_RESOLUTIONS: ['CAM', 'TS', 'TC', 'TELESYNC', 'Telesync'],
    DEFAULT_EXCLUDED_GENRES: 'Talk Show, Documental, Reality, News, Política, Telenovela',
    DEFAULT_EXCLUDED_COUNTRIES: 'India,Hong Kong, Thailand, South Korea, China',
    ONE_DAY_MS: 24 * 60 * 60 * 1000,

    // Diccionario canónico de géneros TMDb (ID -> Nombre en español e inglés común)
    TMDB_GENRES: {
        28: 'Acción', 12: 'Aventura', 16: 'Animación', 35: 'Comedia',
        80: 'Crimen', 99: 'Documental', 18: 'Drama', 10751: 'Familia',
        14: 'Fantasía', 36: 'Historia', 27: 'Terror', 10402: 'Música',
        9648: 'Misterio', 10749: 'Romance', 878: 'Ciencia Ficción',
        10770: 'Película de TV', 53: 'Suspenso', 10752: 'Bélica', 37: 'Western',
        10759: 'Acción', 10762: 'Niños', 10763: 'Noticias', 10764: 'Reality',
        10765: 'Sci-Fi', 10766: 'Telenovela', 10767: 'Talk Show', 10768: 'Política'
    }
};

// Exponer en window
window.CONFIG = CONFIG;
