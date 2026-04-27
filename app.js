const movieInput = document.getElementById('movie-input');
const micBtn = document.getElementById('mic-btn');
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
const AVAILABILITY_CACHE_KEY = 'movie_availability_cache_v10';
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
    
    if (query.length < 2) {
        resultsGrid.innerHTML = '<div class="empty-state"><p>Empieza a escribir para buscar películas...</p></div>';
        showLogo();
        return;
    }

    debounceTimer = setTimeout(() => {
        searchMovies(query);
    }, 400);
});

function showLoading() {
    resultsGrid.innerHTML = `
        <div class="spinner-container">
            <div class="spinner"></div>
            <p class="loading-text">Buscando películas...</p>
        </div>
    `;
}

async function searchMovies(query) {
    console.log('Iniciando búsqueda JSONP para:', query);
    showLoading();
    
    // Limpiar cola y observador anterior
    checkQueue.length = 0;
    availabilityObserver.disconnect();

    const oldScript = document.getElementById('imdb-jsonp');
    if (oldScript) oldScript.remove();

    const firstLetter = query[0].toLowerCase();
    const sanitizedQuery = query.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const callbackName = `imdb$${sanitizedQuery}`;

    window[callbackName] = function(data) {
        console.log('Datos recibidos de IMDb:', data);
        if (data && data.d) {
            currentResults = data.d.filter(item => 
                item.qid === 'movie' || 
                item.qid === 'tvSeries' || 
                item.qid === 'tvMovie'
            );
            renderResults(currentResults);
        }
        delete window[callbackName];
    };

    const script = document.createElement('script');
    script.id = 'imdb-jsonp';
    script.src = `https://sg.media-imdb.com/suggests/${firstLetter}/${encodeURIComponent(query.toLowerCase())}.json`;
    
    script.onerror = function() {
        console.error('Error al cargar el script de IMDb');
        resultsGrid.innerHTML = `<div class="empty-state"><p>Error de conexión. Inténtalo de nuevo.</p></div>`;
    };

    document.body.appendChild(script);
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
        const type = movie.qid === 'tvSeries' ? 'tv' : 'movie';

        return `
            <div class="movie-card navigable" tabindex="${index + 3}" data-index="${index}" data-id="${movie.id}" data-type="${type}">
                <div class="checking-overlay">
                    <div class="mini-spinner"></div>
                    <span class="checking-text">Verificando...</span>
                </div>
                <div class="status-badge">NO DISPONIBLE</div>
                <img src="${imageUrl}" class="movie-poster" alt="${title}" loading="lazy">
                <div class="movie-info">
                    <h3 class="movie-title">${title}</h3>
                    <p class="movie-year">${year}</p>
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

    // 2. Heurística de año: Si la película es del futuro, no está disponible
    const movieYear = parseInt(card.dataset.year || year);
    if (movieYear > currentYear) {
        markAsUnavailable(card);
        saveToCache(id, 'unavailable');
        const overlay = card.querySelector('.checking-overlay');
        if (overlay) overlay.classList.add('hidden');
        return;
    }

    const checkUrl = `https://vaplayer.ru/embed/${type}/${id}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); 
    
    try {
        // Usamos allorigins/get para detectar redirecciones vía data.url
        const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(checkUrl)}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error('Proxy error');
        
        const data = await response.json();
        const content = (data.contents || '').toLowerCase();
        const finalUrl = (data.url || '').toLowerCase();
        
        // --- Heurísticas de "No Disponible" (Solo si estamos seguros) ---
        
        // 1. Redirección confirmada al home (vaplayer.ru/)
        const isHomeRedirect = finalUrl.endsWith('vaplayer.ru/') || finalUrl.endsWith('vaplayer.ru');

        // 2. Contenido de la Landing Page
        const isLandingPage = content.includes('playbox - stream & share videos') || 
                             content.includes('stream it. share it.') ||
                             content.includes('free cloud movie storage');

        // 3. Error explícito
        const isExplicit404 = content.includes('404 not found') || 
                             content.includes('video no encontrado');

        // Solo marcamos como no disponible si alguna de estas es cierta
        const isDefinitelyNotFound = isHomeRedirect || isLandingPage || isExplicit404;

        console.log(`Chequeo ${id}:`, { isHomeRedirect, isLandingPage, isExplicit404, isDefinitelyNotFound });

        const overlay = card.querySelector('.checking-overlay');
        if (overlay) overlay.classList.add('hidden');

        if (isDefinitelyNotFound) {
            markAsUnavailable(card);
            saveToCache(id, 'unavailable');
        } else {
            // Si el proxy responde y no parece ser un error, guardamos como disponible
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
const serverButtons = document.querySelectorAll('.server-btn');

let currentMovieId = '';
let currentMovieType = '';

function getPlayerUrl(id, type, server) {
    switch(server) {
        case 'vidsrc_me':
            return `https://vidsrc.me/embed/${id}`;
        case 'vidsrc_to':
            return `https://vidsrc.to/embed/${type}/${id}`;
        case 'vaplayer':
        default:
            return `https://vaplayer.ru/embed/${type}/${id}`;
    }
}

function playMovie(id, type, server = 'vaplayer') {
    if (!id) return;
    currentMovieId = id;
    currentMovieType = type;
    
    console.log(`Reproduciendo ${type} en servidor ${server} con ID:`, id);
    
    const playUrl = getPlayerUrl(id, type, server);
    
    // Mostrar loader y modal
    playerLoader.classList.remove('hidden');
    playerIframe.classList.add('hidden');
    playerModal.classList.remove('hidden');
    
    // Configurar iframe
    playerIframe.src = playUrl;
    
    playerIframe.onload = () => {
        playerLoader.classList.add('hidden');
        playerIframe.classList.remove('hidden');
    };
    
    // Actualizar botones de servidor
    serverButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.server === server);
    });
    
    setTimeout(() => closePlayerBtn.focus(), 100);
    document.body.style.overflow = 'hidden';
}

serverButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const server = btn.dataset.server;
        playMovie(currentMovieId, currentMovieType, server);
    });
});

closePlayerBtn.addEventListener('click', () => {
    playerIframe.src = '';
    playerModal.classList.add('hidden');
    document.body.style.overflow = '';
    movieInput.focus();
});

resultsGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.movie-card');
    if (card && !card.classList.contains('unavailable')) {
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

