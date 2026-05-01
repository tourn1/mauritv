const movieInput = document.getElementById('movie-input');
const micBtn = document.getElementById('mic-btn');
const clearBtn = document.getElementById('clear-btn');
const resultsGrid = document.getElementById('results-grid');
const voiceIndicator = document.getElementById('voice-indicator');
const logoContainer = document.getElementById('logo-container');

// Registro de Service Worker para PWA/Android
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW registration failed:', err));
    });
}

let debounceTimer;
let currentResults = [];

// --- Configuración y Caché ---
const AVAILABILITY_CACHE_KEY = 'movie_availability_cache_v12';
let availabilityCache = JSON.parse(localStorage.getItem(AVAILABILITY_CACHE_KEY) || '{}');

function saveToCache(id, status) {
    availabilityCache[id] = { status, timestamp: Date.now() };
    // Limpieza básica si el caché es muy grande
    if (Object.keys(availabilityCache).length > 500) availabilityCache = {};
    localStorage.setItem(AVAILABILITY_CACHE_KEY, JSON.stringify(availabilityCache));
}

function getFromCache(id) {
    const entry = availabilityCache[id];
    if (entry && (Date.now() - entry.timestamp < 1000 * 60 * 60 * 24)) { // 24 horas
        return entry.status;
    }
    return null;
}

// --- Control de Concurrencia y Lazy Loading ---
const checkQueue = [];
let activeChecks = 0;
const MAX_CONCURRENT = 3; // Aumentado ligeramente para mayor velocidad

const availabilityObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const card = entry.target;
            // Solo encolar si no se está verificando o ya se verificó
            if (!card.dataset.checkingStarted) {
                card.dataset.checkingStarted = "true";
                checkQueue.push(() => checkAvailability(card));
                processQueue();
                availabilityObserver.unobserve(card); // Dejar de observar una vez encolado
            }
        }
    });
}, { threshold: 0.1 });

function processQueue() {
    while (activeChecks < MAX_CONCURRENT && checkQueue.length > 0) {
        const task = checkQueue.shift();
        activeChecks++;
        task().finally(() => {
            activeChecks--;
            processQueue();
        });
    }
}

function showLogo() {
    if (logoContainer) logoContainer.classList.remove('hidden');
}

function hideLogo() {
    if (logoContainer) logoContainer.classList.add('hidden');
}

// --- Búsqueda Autocomplete ---

movieInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const query = e.target.value.trim();

    // Mostrar/ocultar botón de limpiar
    if (query.length > 0) {
        clearBtn.classList.remove('hidden');
    } else {
        clearBtn.classList.add('hidden');
    }

    if (query.length < 2) {
        resultsGrid.innerHTML = '<div class="empty-state"><p>Empieza a escribir para buscar películas...</p></div>';
        showLogo();
        return;
    }

    debounceTimer = setTimeout(() => {
        searchMovies(query);
    }, 400);
});

// --- Botón Limpiar Búsqueda ---
clearBtn.addEventListener('click', () => {
    movieInput.value = '';
    clearBtn.classList.add('hidden');
    resultsGrid.innerHTML = '<div class="empty-state"><p>Empieza a escribir para buscar películas...</p></div>';
    showLogo();
    checkQueue.length = 0;
    availabilityObserver.disconnect();
    movieInput.focus();
});

function showLoading() {
    resultsGrid.innerHTML = `
        <div class="spinner-container">
            <div class="spinner"></div>
            <p class="loading-text">Buscando películas...</p>
        </div>
    `;
}

const TMDB_API_KEY = '12916916a032ac4a2da17601cbc119bd'; // <-- REEMPLAZAR CON TU API KEY DE TMDB (v3 auth)
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

async function fetchTMDB(endpoint, params = {}) {
    const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
    url.searchParams.append('api_key', TMDB_API_KEY);
    url.searchParams.append('v', new Date().getTime()); // Cache busting para API
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.append(key, value);
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`TMDb API Error: ${response.status}`);
    return response.json();
}

async function getExternalIds(id, type) {
    try {
        const endpoint = type === 'tvSeries' ? `/tv/${id}/external_ids` : `/movie/${id}/external_ids`;
        const data = await fetchTMDB(endpoint);
        return data.imdb_id; // Puede ser null
    } catch (e) {
        console.warn('Error obteniendo external IDs', e);
        return null;
    }
}

async function searchMovies(query) {
    console.log('Iniciando búsqueda TMDb para:', query);
    showLoading();

    // Limpiar cola y observador anterior
    checkQueue.length = 0;
    availabilityObserver.disconnect();

    if (TMDB_API_KEY === 'TU_API_KEY_AQUI') {
        console.warn("ATENCIÓN: Debes reemplazar 'TU_API_KEY_AQUI' con una clave real de TMDb.");
    }

    try {
        // 1. Buscar en español latino primero
        let data = await fetchTMDB('/search/multi', {
            query: query,
            language: 'es-MX',
            page: 1,
            include_adult: false
        });

        let results = data.results || [];

        // 2. Si no hay resultados en español, hacer fallback a inglés
        if (results.length === 0) {
            console.log('Sin resultados en español, buscando en inglés...');
            data = await fetchTMDB('/search/multi', {
                query: query,
                language: 'en-US',
                page: 1,
                include_adult: false
            });
            results = data.results || [];
        }

        // Filtrar solo películas y series que tengan póster y una calificación válida (mayor a 0)
        results = results.filter(item => 
            (item.media_type === 'movie' || item.media_type === 'tv') && 
            item.poster_path && 
            item.vote_average > 0
        );

        if (results.length > 0) {
            // Limitar a los 15 mejores resultados para no saturar con peticiones de external_ids
            const topResults = results.slice(0, 15);

            const mappedResultsPromises = topResults.map(async (item) => {
                const type = item.media_type === 'tv' ? 'tvSeries' : 'movie';

                // 3. Obtener el IMDb ID para mayor compatibilidad con vaplayer.ru
                const imdbId = await getExternalIds(item.id, type);

                const finalId = imdbId || item.id; // Fallback al ID de TMDb si no hay IMDb ID

                return {
                    id: finalId,
                    l: item.title || item.name,
                    y: item.release_date ? item.release_date.substring(0, 4) : (item.first_air_date ? item.first_air_date.substring(0, 4) : ''),
                    releaseDate: item.release_date || item.first_air_date || '',
                    qid: type,
                    i: { imageUrl: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null },
                    rating: item.vote_average ? item.vote_average.toFixed(1) : 'N/A'
                };
            });

            currentResults = await Promise.all(mappedResultsPromises);

            if (currentResults.length > 0) {
                renderResults(currentResults);
            } else {
                resultsGrid.innerHTML = '<div class="empty-state"><p>No se encontraron resultados válidos para esta búsqueda.</p></div>';
                showLogo();
            }
        } else {
            resultsGrid.innerHTML = '<div class="empty-state"><p>No se encontraron resultados para esta búsqueda.</p></div>';
            showLogo();
        }
    } catch (error) {
        console.error('Error en búsqueda TMDb:', error);
        resultsGrid.innerHTML = '<div class="empty-state"><p>Error de conexión o API Key inválida. Revisa la consola.</p></div>';
    }
}

function renderResults(results) {
    console.log('Renderizando resultados...', results.length);
    if (results.length === 0) {
        resultsGrid.innerHTML = '<div class="empty-state"><p>No se encontraron resultados para esta búsqueda.</p></div>';
        showLogo();
        return;
    }
    hideLogo();

    resultsGrid.innerHTML = results.map((movie, index) => {
        let imageUrl = 'https://via.placeholder.com/300x450?text=No+Image';
        if (movie.i) {
            imageUrl = Array.isArray(movie.i) ? movie.i[0] : movie.i.imageUrl || imageUrl;
        }

        const title = movie.l || 'Sin título';
        const year = movie.y || movie.yr || '';
        const releaseDate = movie.releaseDate || '';
        const type = movie.qid === 'tvSeries' ? 'tv' : 'movie';
        const typeDisplay = type === 'tv' ? 'SERIE' : 'PELÍCULA';

        return `
            <div class="movie-card navigable" tabindex="${index + 3}" data-index="${index}" data-id="${movie.id}" data-type="${type}" data-year="${year}" data-release-date="${releaseDate}">
                <div class="type-badge">${typeDisplay}</div>
                <div class="checking-overlay">
                    <div class="mini-spinner"></div>
                    <span class="checking-text">Verificando<br>si el contenido<br>esta disponible...</span>
                </div>
                <div class="status-badge">NO DISPONIBLE</div>
                <img src="${imageUrl}" class="movie-poster" alt="${title}" loading="lazy">
                <div class="movie-info">
                    <h3 class="movie-title">${title}</h3>
                    <div class="movie-meta">
                        <span class="movie-year">${year}</span>
                        <span class="movie-rating">★ ${movie.rating || 'N/A'}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Iniciar observación para lazy checking
    document.querySelectorAll('.movie-card').forEach(card => {
        availabilityObserver.observe(card);
    });
}

async function checkAvailability(card) {
    const id = card.dataset.id;
    const type = card.dataset.type;
    const yearText = card.querySelector('.movie-year').textContent;
    const year = parseInt(yearText);
    const currentYear = new Date().getFullYear();

    // 1. Verificar Caché
    const cachedStatus = getFromCache(id);
    if (cachedStatus !== null) {
        const overlay = card.querySelector('.checking-overlay');
        if (overlay) overlay.classList.add('hidden');
        if (cachedStatus === 'unavailable') {
            markAsUnavailable(card);
        }
        return;
    }

    // 2. Heurística de año/fecha: Si la película es del futuro o muy reciente, no está disponible
    const releaseDateStr = card.dataset.releaseDate;
    if (releaseDateStr) {
        const rDate = new Date(releaseDateStr);
        const now = new Date();
        // Si sale en el futuro o acaba de salir hoy, es casi seguro que no hay video pirateado en HD
        // Agregamos un margen de un par de días para asegurar.
        const marginDate = new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000));
        if (rDate > marginDate) {
            markAsUnavailable(card);
            saveToCache(id, 'unavailable');
            const overlay = card.querySelector('.checking-overlay');
            if (overlay) overlay.classList.add('hidden');
            return;
        }
    } else {
        const movieYear = parseInt(card.dataset.year || year);
        if (movieYear > currentYear) {
            markAsUnavailable(card);
            saveToCache(id, 'unavailable');
            const overlay = card.querySelector('.checking-overlay');
            if (overlay) overlay.classList.add('hidden');
            return;
        }
    }

    const checkUrl = `https://vaplayer.ru/embed/${type}/${id}?v=${new Date().getTime()}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // Aumentado a 20s para dar tiempo a ambos chequeos

    try {
        // Usamos allorigins/get para detectar redirecciones vía data.url
        const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(checkUrl)}&v=${new Date().getTime()}`, { signal: controller.signal });

        if (!response.ok) throw new Error('Proxy error');

        const data = await response.json();
        const content = (data.contents || '').toLowerCase();
        const finalUrl = (data.url || '').toLowerCase();

        // --- Heurísticas de "No Disponible" ---

        const isHomeRedirect = finalUrl.endsWith('vaplayer.ru/') || finalUrl.endsWith('vaplayer.ru') || finalUrl === 'https://vaplayer.ru';

        const isLandingPage = content.includes('playbox') || 
            content.includes('stream & share videos') ||
            content.includes('free cloud movie storage') ||
            content.includes('fastest way to upload');

        let isExplicit404 = content.includes('404 not found') ||
            content.includes('video no encontrado') ||
            content.includes('cannot find') ||
            content.includes('no disponible') ||
            content.includes('error 404') ||
            content.includes('file not found');

        let isDefinitelyNotFound = isHomeRedirect || isLandingPage || isExplicit404;

        // --- VALIDACIÓN SECUNDARIA ---
        // Si vaplayer devuelve el shell 200 pero no estamos seguros, vidsrc.me es el desempate
        if (!isDefinitelyNotFound) {
            try {
                const vidsrcUrl = `https://vidsrc.me/embed/${id}?v=${Date.now()}`;
                const vResp = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(vidsrcUrl)}`, { signal: controller.signal });
                
                if (vResp.ok) {
                    const vData = await vResp.json();
                    const vContent = (vData.contents || '').toLowerCase();
                    const vFinalUrl = (vData.url || '').toLowerCase();
                    
                    // vidsrc.me suele redirigir a una página de error o mostrar "404"
                    if (vFinalUrl.includes('error') || vFinalUrl.includes('404') || 
                        vContent.includes('404') || vContent.includes('not found') || 
                        vContent.includes('video not found')) {
                        console.log(`[Validation] vidsrc.me confirma que ${id} no existe.`);
                        isDefinitelyNotFound = true;
                    }
                } else if (vResp.status === 404) {
                    isDefinitelyNotFound = true;
                }
            } catch (secError) {
                console.warn('Error en chequeo secundario:', secError);
            }
        }

        clearTimeout(timeoutId);
        console.log(`Chequeo ${id}:`, { isHomeRedirect, isLandingPage, isExplicit404, isDefinitelyNotFound });

        const overlay = card.querySelector('.checking-overlay');
        if (overlay) overlay.classList.add('hidden');

        if (isDefinitelyNotFound) {
            markAsUnavailable(card);
            saveToCache(id, 'unavailable');
        } else {
            saveToCache(id, 'available');
        }
    } catch (error) {
        console.warn('Error verificando (usando optimismo):', id, error);
        // EN CASO DE ERROR DE PROXY: Somos optimistas y lo dejamos como disponible
        // para que el usuario pueda intentar abrirlo (por si el proxy falla pero el sitio real no)
        const overlay = card.querySelector('.checking-overlay');
        if (overlay) overlay.classList.add('hidden');
    }
}

function markAsUnavailable(card) {
    card.classList.add('unavailable');
    card.style.pointerEvents = 'none';
    card.removeAttribute('tabindex');
}

// --- Reproducción ---

const playerModal = document.getElementById('player-modal');
const playerIframe = document.getElementById('player-iframe');
const closePlayerBtn = document.getElementById('close-player');
const playerLoader = document.getElementById('player-loader');
// const serverButtons = document.querySelectorAll('.server-btn'); // No longer needed

let currentMovieId = '';
let currentMovieType = '';
let controlsTimeout;

function resetControlsTimer() {
    const controls = document.querySelector('.player-controls');
    if (!controls) return;

    controls.classList.remove('hidden-controls');
    document.body.style.cursor = 'default';

    clearTimeout(controlsTimeout);

    if (!playerModal.classList.contains('hidden')) {
        controlsTimeout = setTimeout(() => {
            controls.classList.add('hidden-controls');
            document.body.style.cursor = 'none';
        }, 2000);
    }
}

function getPlayerUrl(id, type) {
    // We now only use vaplayer with Spanish subtitles by default
    // Agregamos v=random para evitar cache del reproductor
    return `https://vaplayer.ru/embed/${type}/${id}?ds_lang=es&v=${new Date().getTime()}`;
}

function playMovie(id, type) {
    if (!id) return;
    currentMovieId = id;
    currentMovieType = type;

    console.log(`Reproduciendo ${type} con ID:`, id);

    const playUrl = getPlayerUrl(id, type);

    // Mostrar loader y modal
    playerLoader.classList.remove('hidden');
    playerIframe.classList.add('hidden');
    playerModal.classList.remove('hidden');

    // Configurar iframe
    playerIframe.src = playUrl;

    playerIframe.onload = () => {
        playerLoader.classList.add('hidden');
        playerIframe.classList.remove('hidden');

        // === BLOQUEO DE POPUPS Y NAVEGACIÓN EXTERNA ===
        // Sobreescribimos window.open en el contexto del iframe para evitar
        // que cualquier anuncio o enlace abra una ventana nueva
        try {
            const iframeWin = playerIframe.contentWindow;
            if (iframeWin) {
                // Bloquear window.open (abre nuevas pestañas/ventanas)
                iframeWin.open = function () {
                    console.warn('[Player Guard] window.open() bloqueado');
                    return null;
                };
                // Bloquear navegación de la ventana principal desde el iframe
                Object.defineProperty(iframeWin, 'top', {
                    get: function () { return iframeWin; }
                });
                Object.defineProperty(iframeWin, 'parent', {
                    get: function () { return iframeWin; }
                });
            }
        } catch (e) {
            // Si el iframe es cross-origin estricto, el sandbox ya lo maneja
            console.log('[Player Guard] Protección JS aplicada vía sandbox (cross-origin)');
        }
    };

    setTimeout(() => {
        closePlayerBtn.focus();
        resetControlsTimer();
    }, 100);
    document.body.style.overflow = 'hidden';

    // Sensor de movimiento para mostrar controles
    const sensor = document.getElementById('controls-sensor');
    if (sensor) {
        sensor.addEventListener('mousemove', resetControlsTimer);
        sensor.addEventListener('touchstart', resetControlsTimer);
    }

    // Listeners generales
    window.addEventListener('mousemove', resetControlsTimer);
    window.addEventListener('keydown', resetControlsTimer);
    window.addEventListener('touchstart', resetControlsTimer);
    window.addEventListener('mousedown', resetControlsTimer);
}

// Server button listeners removed as the buttons were deleted from HTML

closePlayerBtn.addEventListener('click', () => {
    playerIframe.src = '';
    playerModal.classList.add('hidden');
    document.body.style.overflow = '';

    // Limpiar listeners y timer
    const sensor = document.getElementById('controls-sensor');
    if (sensor) {
        sensor.removeEventListener('mousemove', resetControlsTimer);
        sensor.removeEventListener('touchstart', resetControlsTimer);
    }

    window.removeEventListener('mousemove', resetControlsTimer);
    window.removeEventListener('keydown', resetControlsTimer);
    window.removeEventListener('touchstart', resetControlsTimer);
    window.removeEventListener('mousedown', resetControlsTimer);
    clearTimeout(controlsTimeout);
    document.body.style.cursor = 'default';

    movieInput.focus();
});

resultsGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.movie-card');
    if (card && !card.classList.contains('unavailable')) {
        const overlay = card.querySelector('.checking-overlay');
        if (overlay && !overlay.classList.contains('hidden')) return;

        const id = card.dataset.id;
        const type = card.dataset.type;
        playMovie(id, type);
    }
});

// --- Control por Voz (Web Speech API) ---

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.interimResults = false;

    micBtn.addEventListener('click', () => {
        recognition.start();
        voiceIndicator.classList.remove('hidden');
    });

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        movieInput.value = transcript;
        searchMovies(transcript);
        voiceIndicator.classList.add('hidden');
    };

    recognition.onerror = () => {
        voiceIndicator.classList.add('hidden');
    };

    recognition.onend = () => {
        voiceIndicator.classList.add('hidden');
    };
} else {
    micBtn.style.display = 'none';
    console.warn('Speech recognition not supported in this browser.');
}

// --- Navegación Espacial (D-Pad / Teclado) ---

document.addEventListener('keydown', (e) => {
    const active = document.activeElement;

    if (active === movieInput && e.key === 'Enter') {
        searchMovies(movieInput.value);
        return;
    }

    if (active.classList.contains('movie-card') && (e.key === 'Enter' || e.key === 'Select' || e.keyCode === 23)) {
        if (!active.classList.contains('unavailable')) {
            const overlay = active.querySelector('.checking-overlay');
            if (overlay && !overlay.classList.contains('hidden')) return;

            const id = active.dataset.id;
            const type = active.dataset.type;
            playMovie(id, type);
        }
        return;
    }

    const navigables = Array.from(document.querySelectorAll('.navigable, #movie-input')).filter(el =>
        el.id === 'movie-input' || (el.classList.contains('navigable') && !el.classList.contains('unavailable'))
    );

    const currentIndex = navigables.indexOf(active);

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();

        const rect = active.getBoundingClientRect();
        let closest = null;
        let minDistance = Infinity;

        navigables.forEach((el) => {
            if (el === active) return;
            const elRect = el.getBoundingClientRect();

            let isCandidate = false;
            let dist = 0;

            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const elCenterX = elRect.left + elRect.width / 2;
            const elCenterY = elRect.top + elRect.height / 2;

            if (e.key === 'ArrowUp' && elCenterY < centerY) {
                isCandidate = true;
            } else if (e.key === 'ArrowDown' && elCenterY > centerY) {
                isCandidate = true;
            } else if (e.key === 'ArrowLeft' && elCenterX < centerX) {
                isCandidate = true;
            } else if (e.key === 'ArrowRight' && elCenterX > centerX) {
                isCandidate = true;
            }

            if (isCandidate) {
                dist = Math.pow(elCenterX - centerX, 2) + Math.pow(elCenterY - centerY, 2);
                if (dist < minDistance) {
                    minDistance = dist;
                    closest = el;
                }
            }
        });

        if (closest) {
            closest.focus();
            closest.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
});

window.onload = () => {
    movieInput.focus();
};

