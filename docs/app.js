const movieInput = document.getElementById('movie-input');
const micBtn = document.getElementById('mic-btn');
const clearBtn = document.getElementById('clear-btn');
const resultsGrid = document.getElementById('results-grid');
const voiceIndicator = document.getElementById('voice-indicator');
const logoContainer = document.getElementById('logo-container');
const sectionTitle = document.getElementById('section-title');
const historySection = document.getElementById('history-section');
const historyGrid = document.getElementById('history-grid');

// Registro de Service Worker para PWA/Android
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW registration failed:', err));
    });
}

let debounceTimer;
let currentResults = [];
let trendingMoviesCache = null;
let trendingSeriesCache = null;

const tabsContainer = document.getElementById('tabs-container');
const tabMovies = document.getElementById('tab-movies');
const tabSeries = document.getElementById('tab-series');

if (tabMovies && tabSeries) {
    tabMovies.addEventListener('click', () => {
        tabMovies.classList.add('active');
        tabSeries.classList.remove('active');
        loadTrendingMovies();
    });

    tabSeries.addEventListener('click', () => {
        tabSeries.classList.add('active');
        tabMovies.classList.remove('active');
        loadTrendingSeries();
    });
}

const HISTORY_KEY = 'movie_history_v1';


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
        loadTrendingMovies();
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
    loadTrendingMovies();
    loadHistory();
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

async function getMovieDetails(id, type) {
    try {
        const endpoint = type === 'tvSeries' || type === 'tv' ? `/tv/${id}` : `/movie/${id}`;
        // Para series no solemos tener 'release_dates' con tipos (digital, etc) de la misma forma que peliculas
        const append = type === 'tvSeries' || type === 'tv' ? 'external_ids' : 'external_ids,release_dates';
        const data = await fetchTMDB(endpoint, { append_to_response: append });

        let digitalReleaseDate = null;
        if (data.release_dates && data.release_dates.results) {
            // Intentar encontrar lanzamiento digital (tipo 4)
            for (const res of data.release_dates.results) {
                const digital = res.release_dates.find(rd => rd.type === 4);
                if (digital) {
                    digitalReleaseDate = digital.release_date.split('T')[0];
                    break;
                }
            }
        }

        return {
            imdbId: data.external_ids ? data.external_ids.imdb_id : null,
            digitalReleaseDate: digitalReleaseDate
        };
    } catch (e) {
        console.warn('Error obteniendo detalles del contenido', e);
        return { imdbId: null, digitalReleaseDate: null };
    }
}

async function searchMovies(query) {
    console.log('Iniciando búsqueda TMDb para:', query);
    hideLogo(); // Ocultar logo al buscar
    showLoading();
    if (sectionTitle) sectionTitle.classList.add('hidden');
    if (tabsContainer) tabsContainer.classList.add('hidden');
    if (historySection) historySection.classList.add('hidden');


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

                // 3. Obtener el IMDb ID y fecha digital para mayor compatibilidad y detalle
                const details = await getMovieDetails(item.id, type);

                const finalId = details.imdbId || item.id; // Fallback al ID de TMDb si no hay IMDb ID
                const validationData = await validarPeliculaFinal(finalId);

                return {
                    id: finalId,
                    tmdbId: item.id,
                    l: item.title || item.name,
                    disponible: validationData.disponible,
                    resolution: validationData.resolution,
                    source: validationData.source,
                    y: item.release_date ? item.release_date.substring(0, 4) : (item.first_air_date ? item.first_air_date.substring(0, 4) : ''),
                    releaseDate: item.release_date || item.first_air_date || '',
                    digitalReleaseDate: details.digitalReleaseDate || '',
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

async function loadTrendingMovies() {
    showLogo(); // Asegurar que el logo sea visible en trending
    if (sectionTitle) sectionTitle.classList.add('hidden');
    if (tabsContainer) tabsContainer.classList.remove('hidden');
    if (tabMovies) {
        tabMovies.classList.add('active');
        if (tabSeries) tabSeries.classList.remove('active');
    }
    loadHistory(); // Cargar historial al mismo tiempo
    
    const CACHE_KEY = 'trendingMoviesCache_v1';
    const CACHE_TIME_KEY = 'trendingMoviesCacheTime_v1';
    const ONE_DAY = 24 * 60 * 60 * 1000;

    if (!trendingMoviesCache) {
        const storedCache = localStorage.getItem(CACHE_KEY);
        const storedTime = localStorage.getItem(CACHE_TIME_KEY);
        if (storedCache && storedTime) {
            if (new Date().getTime() - parseInt(storedTime) < ONE_DAY) {
                try {
                    trendingMoviesCache = JSON.parse(storedCache);
                } catch (e) {
                    console.warn('Error parsing cache', e);
                }
            } else {
                localStorage.removeItem(CACHE_KEY);
                localStorage.removeItem(CACHE_TIME_KEY);
            }
        }
    }

    if (trendingMoviesCache) {
        renderResults(trendingMoviesCache);
        return;
    }

    console.log('Cargando películas trending en streaming...');
    showLoading();


    try {
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        const dateStr = sixtyDaysAgo.toISOString().split('T')[0];

        let validMovies = [];
        let page = 1;
        const maxPages = 3;

        while (validMovies.length < 10 && page <= maxPages) {
            // Intentamos buscar películas que hayan salido en formato digital (streaming) recientemente
            let data = await fetchTMDB('/discover/movie', {
                sort_by: 'popularity.desc',
                'primary_release_date.gte': dateStr,
                with_release_type: '4', // 4 = Digital
                language: 'es-MX',
                page: page
            });

            let results = data.results || [];

            // Si no hay suficientes con el filtro de Digital, usamos las populares generales como fallback
            if (page === 1 && results.length < 5) {
                console.log('Pocos resultados con release_type=4, usando populares generales...');
                const fallbackData = await fetchTMDB('/movie/popular', {
                    language: 'es-MX',
                    page: 1
                });
                results = fallbackData.results || [];
            } else if (results.length === 0 && page > 1) {
                const fallbackData = await fetchTMDB('/movie/popular', {
                    language: 'es-MX',
                    page: page
                });
                results = fallbackData.results || [];
            }

            if (results.length === 0) break;

            // Filtrar candidatos iniciales
            results = results.filter(item => item.poster_path && item.vote_average > 0);

            // Procesar en lotes de 5 para un buen balance de rendimiento y orden de popularidad
            for (let i = 0; i < results.length && validMovies.length < 10; i += 5) {
                const batch = results.slice(i, i + 5);
                const batchPromises = batch.map(async (item) => {
                    const details = await getMovieDetails(item.id, 'movie');
                    const finalId = details.imdbId || item.id;
                    const validationData = await validarPeliculaFinal(finalId);

                    if (validationData.disponible) {
                        return {
                            id: finalId,
                            tmdbId: item.id,
                            l: item.title,
                            disponible: true,
                            resolution: validationData.resolution,
                            source: validationData.source,
                            y: item.release_date ? item.release_date.substring(0, 4) : '',
                            releaseDate: item.release_date || '',
                            digitalReleaseDate: details.digitalReleaseDate || '',
                            qid: 'movie',
                            i: { imageUrl: `https://image.tmdb.org/t/p/w500${item.poster_path}` },
                            rating: item.vote_average ? item.vote_average.toFixed(1) : 'N/A'
                        };
                    }
                    return null;
                });

                const batchResults = await Promise.all(batchPromises);

                for (const res of batchResults) {
                    if (res && validMovies.length < 10) {
                        // Verificamos que no esté duplicado por id
                        if (!validMovies.some(v => v.id === res.id)) {
                            validMovies.push(res);
                        }
                    }
                }
            }

            page++;
        }

        trendingMoviesCache = validMovies;
        
        try {
            localStorage.setItem('trendingMoviesCache_v1', JSON.stringify(trendingMoviesCache));
            localStorage.setItem('trendingMoviesCacheTime_v1', new Date().getTime().toString());
        } catch (e) {
            console.warn('Error saving to local storage', e);
        }

        if (trendingMoviesCache.length > 0) {
            renderResults(trendingMoviesCache);
        } else {
            resultsGrid.innerHTML = '<div class="empty-state"><p>No hay estrenos disponibles en este momento.</p></div>';
            showLogo();
        }
    } catch (error) {
        console.error('Error cargando trending movies:', error);
        resultsGrid.innerHTML = '<div class="empty-state"><p>Error al cargar las películas sugeridas.</p></div>';
        showLogo();
    }
}

async function loadTrendingSeries() {
    showLogo(); // Asegurar que el logo sea visible en trending
    if (sectionTitle) sectionTitle.classList.add('hidden');
    if (tabsContainer) tabsContainer.classList.remove('hidden');
    if (tabSeries) {
        tabSeries.classList.add('active');
        if (tabMovies) tabMovies.classList.remove('active');
    }
    loadHistory(); // Cargar historial al mismo tiempo
    
    const CACHE_KEY = 'trendingSeriesCache_v1';
    const CACHE_TIME_KEY = 'trendingSeriesCacheTime_v1';
    const ONE_DAY = 24 * 60 * 60 * 1000;

    if (!trendingSeriesCache) {
        const storedCache = localStorage.getItem(CACHE_KEY);
        const storedTime = localStorage.getItem(CACHE_TIME_KEY);
        if (storedCache && storedTime) {
            if (new Date().getTime() - parseInt(storedTime) < ONE_DAY) {
                try {
                    trendingSeriesCache = JSON.parse(storedCache);
                } catch (e) {
                    console.warn('Error parsing cache', e);
                }
            } else {
                localStorage.removeItem(CACHE_KEY);
                localStorage.removeItem(CACHE_TIME_KEY);
            }
        }
    }

    if (trendingSeriesCache) {
        renderResults(trendingSeriesCache);
        return;
    }

    console.log('Cargando series trending...');
    showLoading();

    try {
        let validSeries = [];
        let page = 1;
        const maxPages = 3;

        while (validSeries.length < 10 && page <= maxPages) {
            let data = await fetchTMDB('/tv/popular', {
                language: 'es-MX',
                page: page
            });

            let results = data.results || [];

            if (results.length === 0) break;

            results = results.filter(item => item.poster_path && item.vote_average > 0);

            for (let i = 0; i < results.length && validSeries.length < 10; i += 5) {
                const batch = results.slice(i, i + 5);
                const batchPromises = batch.map(async (item) => {
                    const details = await getMovieDetails(item.id, 'tv');
                    const finalId = details.imdbId || item.id;
                    const validationData = await validarPeliculaFinal(finalId);

                    if (validationData.disponible) {
                        return {
                            id: finalId,
                            tmdbId: item.id,
                            l: item.name,
                            disponible: true,
                            resolution: validationData.resolution,
                            source: validationData.source,
                            y: item.first_air_date ? item.first_air_date.substring(0, 4) : '',
                            releaseDate: item.first_air_date || '',
                            digitalReleaseDate: details.digitalReleaseDate || '',
                            qid: 'tvSeries',
                            i: { imageUrl: `https://image.tmdb.org/t/p/w500${item.poster_path}` },
                            rating: item.vote_average ? item.vote_average.toFixed(1) : 'N/A'
                        };
                    }
                    return null;
                });

                const batchResults = await Promise.all(batchPromises);

                for (const res of batchResults) {
                    if (res && validSeries.length < 10) {
                        if (!validSeries.some(v => v.id === res.id)) {
                            validSeries.push(res);
                        }
                    }
                }
            }

            page++;
        }

        trendingSeriesCache = validSeries;
        
        try {
            localStorage.setItem('trendingSeriesCache_v1', JSON.stringify(trendingSeriesCache));
            localStorage.setItem('trendingSeriesCacheTime_v1', new Date().getTime().toString());
        } catch (e) {
            console.warn('Error saving to local storage', e);
        }

        if (trendingSeriesCache.length > 0) {
            renderResults(trendingSeriesCache);
        } else {
            resultsGrid.innerHTML = '<div class="empty-state"><p>No hay series nuevas disponibles en este momento.</p></div>';
            showLogo();
        }
    } catch (error) {
        console.error('Error cargando trending series:', error);
        resultsGrid.innerHTML = '<div class="empty-state"><p>Error al cargar las series sugeridas.</p></div>';
        showLogo();
    }
}

// --- Gestión de Historial ---

function saveToHistory(movie) {
    let history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    // Evitar duplicados: eliminar si ya existe
    history = history.filter(item => String(item.id) !== String(movie.id) && !(item.tmdbId && String(item.tmdbId) === String(movie.tmdbId)));
    // Agregar al inicio
    history.unshift(movie);
    // Limitar a 10
    history = history.slice(0, 10);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function loadHistory() {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (history.length > 0) {
        historySection.classList.remove('hidden');
        renderToGrid(history, historyGrid, 100); // Offset de tabindex para no chocar
    } else {
        historySection.classList.add('hidden');
    }
}

// --- Limpieza de historial y cookies relacionadas ---
function clearHistory() {
    try {
        // Borrar historial en localStorage
        localStorage.removeItem(HISTORY_KEY);

        // Borrar cookies que posiblemente guarden información de 'watched' o 'movie'
        const cookies = document.cookie ? document.cookie.split(';').map(c => c.trim()) : [];
        cookies.forEach(c => {
            const eq = c.indexOf('=');
            const name = eq > -1 ? c.substring(0, eq) : c;
            if (/movie|watched/i.test(name)) {
                document.cookie = `${name}=; Max-Age=0; path=/;`;
            }
        });

        // Recargar la sección de historial en la UI
        loadHistory();
    } catch (e) {
        console.error('Error al borrar historial:', e);
    }
}

function renderResults(results) {
    renderToGrid(results, resultsGrid, 0);
}

function renderToGrid(results, gridElement, tabindexOffset) {
    console.log('Renderizando resultados en grid...', results.length);
    if (results.length === 0) {
        if (gridElement === resultsGrid) {
            gridElement.innerHTML = '<div class="empty-state"><p>No se encontraron resultados.</p></div>';
            showLogo();
        }
        return;
    }
    // Ya no ocultamos el logo automáticamente al renderizar resultados genéricos

    gridElement.innerHTML = results.map((movie, index) => {
        let imageUrl = 'https://via.placeholder.com/300x450?text=No+Image';
        if (movie.i) {
            imageUrl = Array.isArray(movie.i) ? movie.i[0].imageUrl : movie.i.imageUrl || imageUrl;
        }

        const title = movie.l || 'Sin título';
        const year = movie.y || movie.yr || '';
        const releaseDate = movie.releaseDate || '';
        const type = movie.qid === 'tvSeries' ? 'tv' : 'movie';
        const typeDisplay = type === 'tv' ? 'SERIE' : 'PELÍCULA';

        const disponibleBadge = movie.disponible === false ? '<div class="availability-badge unavailable">No disponible</div>' : '';
        const unavailableClass = movie.disponible === false ? ' unavailable' : '';

        // Badge de información (Fuente y Resolución combinadas)
        let extraBadges = '';
        if (movie.disponible !== false) {
            if (movie.source || movie.resolution) {
                const badgeText = [movie.source, movie.resolution].filter(Boolean).join(' ');
                extraBadges = `<div class="info-badge">${badgeText}</div>`;
            }
        }

        return `
            <div class="movie-card navigable${unavailableClass}" tabindex="${index + 3 + tabindexOffset}" data-index="${index}" data-id="${movie.id}" data-type="${type}" data-year="${year}" data-release-date="${releaseDate}" data-release-digital="${movie.digitalReleaseDate || ''}" release-date="${releaseDate}" data-movie-obj='${JSON.stringify(movie).replace(/'/g, "&apos;")}'>
                <div class="type-badge">${typeDisplay}</div>
                ${extraBadges}
                ${disponibleBadge}
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

}


// --- Reproducción ---

const prePlayOverlay = document.getElementById('pre-play-overlay');

let currentMovieId = '';
let currentMovieType = '';

function getPlayerUrl(id, type) {
    return `https://vaplayer.ru/embed/${type}/${id}?sub_lang=es&v=${new Date().getTime()}`;
}

async function playWithDelay(id, type, movieObj) {
    if (!id) return;

    // Guardar en historial
    if (movieObj) {
        saveToHistory(movieObj);
        loadHistory();
    }

    // Mostrar overlay con el logo y spinner
    const statusText = document.getElementById('pre-play-status');
    if (prePlayOverlay) {
        if (statusText) {
            statusText.textContent = 'Verificando disponibilidad...';
            statusText.style.color = 'var(--text-secondary)';
        }
        prePlayOverlay.classList.remove('hidden');
    }

    // Forzar un retraso de 2 segundos para mostrar el logo y spinner
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Iniciar verificación
    try {
        let available = true;
        if (movieObj && movieObj.disponible !== undefined) {
            available = movieObj.disponible;
        } else {
            const vData = await validarPeliculaFinal(id);
            available = vData.disponible;
        }

        if (!available) {
            if (statusText) {
                statusText.textContent = 'Contenido no disponible en este momento';
                statusText.style.color = '#ff4444';
            }
            setTimeout(() => {
                if (prePlayOverlay) prePlayOverlay.classList.add('hidden');
            }, 2500);
            return;
        }
    } catch (e) {
        console.error('Error validando:', e);
    }

    if (prePlayOverlay) prePlayOverlay.classList.add('hidden');
    playMovie(id, type);
}

function playMovie(id, type) {
    if (!id) return;
    currentMovieId = id;
    currentMovieType = type;

    console.log(`Reproduciendo ${type} con ID:`, id);
    window.location.href = `player.html?id=${id}&type=${type}`;
}

function openContentPage(movieObj) {
    saveToHistory(movieObj);
    const type = movieObj.qid === 'tvSeries' ? 'tv' : 'movie';
    const id = movieObj.tmdbId || movieObj.id;
    window.location.href = `content.html?id=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}`;
}

resultsGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.movie-card');
    if (card) {
        const movieObj = JSON.parse(card.dataset.movieObj);
        openContentPage(movieObj);
    }
});

if (historyGrid) {
    historyGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.movie-card');
        if (card) {
            const movieObj = JSON.parse(card.dataset.movieObj);
            openContentPage(movieObj);
        }
    });
}

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
        const movieObj = JSON.parse(active.dataset.movieObj);
        openContentPage(movieObj);
        return;
    }

    if (active.classList.contains('tab-btn') && (e.key === 'Enter' || e.key === 'Select' || e.keyCode === 23)) {
        active.click();
        return;
    }

    // Cerrar reproductor eliminado (ahora en player.html)

    const navigables = Array.from(document.querySelectorAll('.navigable, #movie-input')).filter(el => {
        if (el.id !== 'movie-input' && (!el.classList.contains('navigable') || el.classList.contains('unavailable'))) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    });

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
                const dx = Math.abs(elCenterX - centerX);
                const dy = Math.abs(elCenterY - centerY);
                
                // Penalizar el eje opuesto para evitar saltos diagonales
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    dist = dy + (dx * 5);
                } else {
                    dist = dx + (dy * 5);
                }

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
    loadTrendingMovies();
};

// Al volver a la página (por ejemplo desde content.html o player.html) actualizar historial
window.addEventListener('pageshow', () => {
    loadHistory();
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadHistory();
});

// Conectar el botón de borrar historial (si está presente)
const clearHistoryBtn = document.getElementById('clear-history-btn');
if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
        // Borrar directamente sin pedir confirmación
        clearHistory();
    });
}

// --- Configuración del reproductor movida a player.html ---


// --- Validación de disponibilidad ---
function isValidMovie(id, options = {}) {
    return validarPeliculaFinal(id);
}
/**
 * Módulo de Validación de Películas - MauriTV
 * Centraliza la lógica para verificar si un contenido está disponible.
 */

/**
 * Valida la disponibilidad de la película consultando al servicio de imobiledeals.
 */
async function validarPeliculaFinal(id) {
    if (!id) return { disponible: false };
    
    try {
        // Usar verify.php local con cache busting
        const url = `verify.php?id=${encodeURIComponent(id)}&v=${Date.now()}`;
        
        const response = await fetch(url, {
            method: 'GET',
            cache: 'no-store',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        return data; 
    } catch (error) {
        console.warn(`Verificación local fallida para ${id}, intentando fallback...`);
        
        try {
            // Intentar con el servicio externo si el local falla
            const fallbackUrl = `https://imobiledeals.com/service/verify?id=${encodeURIComponent(id)}`;
            const fbResponse = await fetch(fallbackUrl);
            
            if (fbResponse.ok) {
                const fbData = await fbResponse.json();
                const q = fbData.quality_info || {};
                return {
                    disponible: fbData.disponible === true,
                    resolution: q.resolucion || fbData.resolution || "HD",
                    source: q.fuente || fbData.source || "EXT"
                };
            }
        } catch (fbError) {
            console.error(`Error total en validación para ${id}:`, fbError);
        }
        
        return { disponible: false };
    }
}
