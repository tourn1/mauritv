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
    DEFAULT_VERIFY_API_URL: 'https://streamdata.vaplayer.ru/api.php',

    // App configurations
    HISTORY_KEY: 'movie_history_v1',
    HIDDEN_RESOLUTIONS: ['CAM', 'TS', 'TC'],
    ONE_DAY_MS: 24 * 60 * 60 * 1000
};

// Exponer en window
window.CONFIG = CONFIG;
