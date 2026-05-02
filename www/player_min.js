/**
 * Video Player JavaScript
 * Modular player with HLS support, subtitles, and ads integration
 */

const _DBG = location.search.includes('debug');
const _log = _DBG ? console.log.bind(console) : () => {};

// ============================================
// Base Path - API files are always in /vaplayer/embed/
// ============================================
const API_BASE = '/embed';

// ============================================
// Cross-domain Storage Proxy
// Only active when CONFIG.useParentStorage is true (iframe architecture).
// In that mode, localStorage/cookies must not be touched on the iframe
// domain. All values live on the parent (wrapper) domain via postMessage.
// On init the proxy requests data from the parent, populates an in-memory
// cache, then fires onInit callbacks so settings can be re-applied.
// Falls back to direct localStorage when NOT in iframe-architecture mode.
// ============================================
const parentStorage = (function() {
    const useProxy = CONFIG.useParentStorage && window.parent !== window;
    const cache = {};
    const initCallbacks = [];
    let inited = false;

    if (useProxy) {
        window.addEventListener('message', function(e) {
            if (!e.data || e.data.type !== 'STORAGE_INIT') return;
            var d = e.data.data;
            if (d && typeof d === 'object') {
                for (var k in d) {
                    if (d.hasOwnProperty(k)) cache[k] = d[k];
                }
            }
            inited = true;
            for (var i = 0; i < initCallbacks.length; i++) {
                try { initCallbacks[i](); } catch(ex) {}
            }
        });
        window.parent.postMessage({ type: 'STORAGE_GET_ALL' }, '*');
    }

    return {
        getItem: function(key) {
            if (!useProxy) return localStorage.getItem(key);
            return cache.hasOwnProperty(key) ? cache[key] : null;
        },
        setItem: function(key, value) {
            if (!useProxy) { localStorage.setItem(key, value); return; }
            cache[key] = String(value);
            window.parent.postMessage({ type: 'STORAGE_SET', key: key, value: String(value) }, '*');
        },
        removeItem: function(key) {
            if (!useProxy) { localStorage.removeItem(key); return; }
            delete cache[key];
            window.parent.postMessage({ type: 'STORAGE_REMOVE', key: key }, '*');
        },
        onInit: function(fn) {
            if (!useProxy) return;
            if (inited) { try { fn(); } catch(ex) {} return; }
            initCallbacks.push(fn);
        }
    };
})();

// ============================================
// iOS HLS Subtitle Proxy
// ============================================

// Check if running on iOS (defined early for use in proxy functions)
function isIOSDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Check if running on Android
function isAndroidDevice() {
    return /Android/i.test(navigator.userAgent);
}

// Check if running on a touch device (iOS, Android, tablets, etc.)
// These devices should use native subtitle rendering instead of custom overlay
function isTouchDevice() {
    return (
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        navigator.msMaxTouchPoints > 0 ||
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    );
}

// Log device detection on page load
_log('📱 Device Detection:', {
    isIOS: isIOSDevice(),
    isAndroid: isAndroidDevice(),
    isTouchDevice: isTouchDevice(),
    userAgent: navigator.userAgent.substring(0, 80),
    hasTouch: 'ontouchstart' in window,
    maxTouchPoints: navigator.maxTouchPoints
});

/**
 * For iOS Safari fullscreen, subtitles must be embedded in the HLS manifest.
 * This function builds a proxy URL that injects subtitle tracks into the manifest.
 * 
 * @param {string} hlsUrl - Original HLS manifest URL
 * @param {Array} subtitles - Array of subtitle objects [{url, lang, label, default}]
 * @returns {string} - Proxied URL with subtitles injected
 */
function buildIOSHlsUrl(hlsUrl, subtitles = []) {
    if (!subtitles || subtitles.length === 0) {
        return hlsUrl;
    }
    
    const proxyUrl = API_BASE + '/hls-proxy.php';
    const subsJson = JSON.stringify(subtitles.map(sub => {
        let vttUrl = sub.cachedVttUrl || sub.url;
        
        // CRITICAL: Ensure absolute HTTPS URL for iOS
        if (vttUrl && vttUrl.startsWith('/')) {
            vttUrl = window.location.origin + vttUrl;
        }
        
        return {
            url: vttUrl,
            lang: sub.langCode || sub.lang || 'en',
            label: sub.langName || sub.label || 'Unknown',
            default: sub.default || false
        };
    }));
    
    return proxyUrl + '?url=' + encodeURIComponent(hlsUrl) + '&subs=' + encodeURIComponent(subsJson);
}

/**
 * Check if we should use HLS proxy for iOS only
 * Android uses normal track elements
 */
function shouldUseIOSHlsProxy() {
    if (!isIOSDevice()) {
        return false; // Not iOS
    }
    
    // Check if HLS.js is actually being used
    const usingHlsJs = state.hls !== undefined && state.hls !== null;
    
    // Also check if current source is HLS
    const isHls = state.currentVideoUrl && state.currentVideoUrl.includes('.m3u8');
    
    // Use proxy if: iOS + NOT using HLS.js + is HLS stream
    const shouldUse = !usingHlsJs && isHls;
    
    _log('shouldUseIOSHlsProxy:', {
        isIOS: true,
        usingHlsJs: usingHlsJs,
        currentUrl: state.currentVideoUrl,
        isHls: isHls,
        result: shouldUse
    });
    
    return shouldUse;
}

/**
 * Reload video with subtitles embedded in manifest for iOS
 * Call this after subtitles are loaded/selected
 */
function reloadWithEmbeddedSubtitles() {
    _log('🔄 reloadWithEmbeddedSubtitles called');
    
    if (!shouldUseIOSHlsProxy()) {
        _log('❌ iOS HLS Proxy: Not using (HLS.js detected or not iOS)');
        return;
    }
    if (state.subtitles.length === 0) {
        _log('❌ iOS HLS Proxy: No subtitles loaded');
        return;
    }
    if (state.allStreams.length === 0) {
        _log('❌ iOS HLS Proxy: No streams available');
        return;
    }
    
    const currentTime = video.currentTime;
    const wasPlaying = !video.paused;
    const originalUrl = state.allStreams[state.currentStreamIdx];
    
    // Build subtitle info for ALL available subtitles
    // This allows iOS native CC menu to show all languages
    const allSubs = state.subtitles
        .filter(sub => sub.cachedVttUrl) // Only include subs with server URLs
        .map((sub, idx) => ({
            url: sub.cachedVttUrl,
            lang: sub.langCode || 'en',
            label: sub.langName || sub.label,
            default: idx === state.activeSubIdx // Mark active as default
        }));
    
    _log('📊 Subtitle filter results:', {
        totalSubtitles: state.subtitles.length,
        subsWithCachedUrl: allSubs.length,
        filteredSubs: state.subtitles.map(s => ({
            label: s.label,
            hasCachedUrl: !!s.cachedVttUrl,
            cachedUrl: s.cachedVttUrl
        }))
    });
    
    if (allSubs.length === 0) {
        _log('❌ iOS HLS Proxy: No subs with server URLs');
        _log('Debug: Subtitles state:', state.subtitles.map(s => ({
            label: s.label,
            cachedVttUrl: s.cachedVttUrl,
            trackSrc: s.track ? s.track.src : null
        })));
        return;
    }
    
    _log('✅ iOS HLS Proxy: Injecting', allSubs.length, 'subtitle(s) into manifest');
    _log('✅ iOS HLS Proxy: Active subtitle index:', state.activeSubIdx);
    _log('✅ Subtitles to inject:', allSubs);
    
    // Build proxied URL with all subtitles
    const proxiedUrl = buildIOSHlsUrl(originalUrl, allSubs);
    
    _log('🔗 iOS HLS Proxy: Original URL:', originalUrl);
    _log('🔗 iOS HLS Proxy: Proxied URL:', proxiedUrl);
    
    // Show visual feedback
    showToast('Loading subtitles for fullscreen...', 2000);
    
    // Reload video
    video.src = proxiedUrl;
    video.load();
    
    video.addEventListener('loadedmetadata', function onLoaded() {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.currentTime = currentTime;
        if (wasPlaying) {
            video.play().catch(() => {});
        }
        _log('✅ iOS HLS Proxy: Video reloaded successfully');
        showToast('Subtitles ready! Select in fullscreen CC menu.', 3000);
    });
}

// ============================================
// State Management
// ============================================
const state = {
    subtitles: [],
    activeSubIdx: -1,
    currentCues: [],
    searchResults: [],
    qualities: [],
    thumbnailCues: [],
    hls: null,
    lastProgressUpdate: 0,
    billableViewSent: false,
    isIOSFullscreen: false,
    currentStreamIdx: 0,
    allStreams: [],
    apiData: null,
    fileName: '',
    videoInfo: null,
    episodeData: null,
    subtitleLoadingLock: false,
    currentSource: parentStorage.getItem('va_preferred_source') || 'justhd',
    segments: [],
    activeSegment: null,
    adState: {
        prerollPlayed: false,
        midrollTriggers: [],
        postrollPlayed: false,
        bannerShown: false,
        pauseAdShown: false,
        popupShown: false,
    }
};

// ============================================
// Element References
// ============================================
const $id = id => document.getElementById(id);
const wrapper = $id('playerWrapper');
const video = $id('video');

// Set media type on body for CSS targeting (hide episode nav on movies)
document.body.setAttribute('data-media-type', CONFIG.mediaType);

const posterOverlay = $id('posterOverlay');
const castingOverlay = $id('castingOverlay');
const castingDevice = $id('castingDevice');
const errorOverlay = $id('errorOverlay');
const errorText = $id('errorText');
const bigPlay = $id('bigPlay');
const playBtn = $id('playBtn');
const playIcon = $id('playIcon');
const pauseIcon = $id('pauseIcon');
const nextBtn = $id('nextBtn');
const muteBtn = $id('muteBtn');
const volumeHigh = $id('volumeHigh');
const volumeMuted = $id('volumeMuted');
const volumeSlider = $id('volumeSlider');
const currentTimeEl = $id('currentTime');
const durationEl = $id('duration');
const progressContainer = $id('progressContainer');
const progressCurrent = $id('progressCurrent');
const progressBuffered = $id('progressBuffered');
const progressHandle = $id('progressHandle');
const progressPreview = $id('progressPreview');
const progressTooltip = $id('progressTooltip');
const thumbnailPreview = $id('thumbnailPreview');
const thumbnailImage = $id('thumbnailImage');
const thumbnailTime = $id('thumbnailTime');
const fullscreenBtn = $id('fullscreenBtn');
const enterFs = $id('enterFs');
const exitFs = $id('exitFs');
const pipBtn = $id('pipBtn');
const castBtn = $id('castBtn');
const airplayBtn = $id('airplayBtn');
const ccBtn = $id('ccBtn');
const ccMenu = $id('ccMenu');
const settingsBtn = $id('settingsBtn');
const settingsMenu = $id('settingsMenu');
const settingsContent = $id('settingsContent');
const qualityMenu = $id('qualityMenu');

// Hide PiP button on iOS
if (pipBtn && isIOSDevice()) {
    pipBtn.style.display = 'none';
}

// ============================================
// Toast Notification System
// ============================================
let currentToast = null;
let toastTimeout = null;

function showToast(message, duration = 3000) {
    // Remove existing toast
    dismissToast();
    
    // Create new toast
    const toast = document.createElement('div');
    toast.className = 'player-toast';
    toast.textContent = message;
    wrapper.appendChild(toast);
    currentToast = toast;
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Auto-dismiss (unless duration is 0)
    if (duration > 0) {
        toastTimeout = setTimeout(() => dismissToast(), duration);
    }
}

function dismissToast() {
    if (toastTimeout) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
    }
    
    if (currentToast) {
        currentToast.classList.remove('show');
        setTimeout(() => {
            if (currentToast && currentToast.parentNode) {
                currentToast.parentNode.removeChild(currentToast);
            }
            currentToast = null;
        }, 300);
    }
}
const speedMenu = $id('speedMenu');
const subtitleText = $id('subtitleText');
const subtitles = $id('subtitles');
const subList = $id('subList');
const langSelect = $id('langSelect');
const searchBtn = $id('searchBtn');
const searchResults = $id('searchResults');

// ============================================
// PostMessage - Send events to parent
// ============================================
function getCurrentQualityInfo() {
    if (!state.hls || !state.qualities.length) return null;
    const lvl = state.hls.currentLevel;
    if (lvl < 0 || lvl >= state.qualities.length) return { label: 'Auto', width: null, height: null };
    const q = state.qualities[lvl];
    return { label: getQualityLabel(q), width: q.width || null, height: q.height || null };
}

function getAvailableQualities() {
    if (!state.qualities.length) return [];
    return state.qualities.map(q => getQualityLabel(q));
}

function buildPlayerInfo() {
    return {
        imdb: CONFIG.idType === 'imdb' ? CONFIG.mediaId : null,
        tmdb: CONFIG.idType === 'tmdb' ? CONFIG.mediaId : null,
        mediaType: CONFIG.mediaType,
        season: CONFIG.season || null,
        episode: CONFIG.episode || null,
        title: CONFIG.title || null,
        poster: CONFIG.poster || null,
    };
}

function postEvent(eventName, extra = {}) {
    if (window.parent === window) return;

    const statusMap = { play: 'playing', pause: 'paused', ended: 'completed', seeked: 'seeked', ready: 'ready' };
    
    const data = {
        type: 'PLAYER_EVENT',
        data: {
            player_info: buildPlayerInfo(),
            player_status: statusMap[eventName] || eventName,
            player_progress: video.currentTime || 0,
            player_duration: video.duration || 0,
            quality: getCurrentQualityInfo(),
            availableQualities: getAvailableQualities(),
            ...extra
        }
    };
    
    window.parent.postMessage(data, '*');
}

function postProgress() {
    if (window.parent === window) return;
    if (!video.duration) return;
    
    const percent = Math.round((video.currentTime / video.duration) * 100);
    
    if (!state.billableViewSent && percent >= 5) {
        state.billableViewSent = true;
        postBillableView();
    }
    
    const now = Date.now();
    if (now - state.lastProgressUpdate < 5000) return;
    state.lastProgressUpdate = now;
    
    const data = {
        type: 'PLAYER_EVENT',
        data: {
            player_info: buildPlayerInfo(),
            player_status: 'playing',
            player_progress: video.currentTime,
            player_duration: video.duration,
            percent: percent,
            quality: getCurrentQualityInfo(),
        }
    };
    
    window.parent.postMessage(data, '*');
}

function postBillableView() {
    if (window.parent === window) return;
    
    const data = {
        type: 'PLAYER_BILLABLE_VIEW',
        data: {
            id: CONFIG.mediaId,
            mediaType: CONFIG.mediaType,
            season: CONFIG.season,
            episode: CONFIG.episode,
            duration: video.duration,
            timestamp: Date.now()
        }
    };
    
    window.parent.postMessage(data, '*');
    _log('Billable view triggered');
}

function setPlayerTitle(title) {
    document.title = title;
    if (window.parent !== window) {
        window.parent.postMessage({ type: 'PLAYER_TITLE', title: title }, '*');
    }
}

// ============================================
// Utility Functions
// ============================================
function formatTime(sec) {
    if (isNaN(sec)) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
    return `${m}:${s.toString().padStart(2,'0')}`;
}

function parseTime(str) {
    const parts = str.split(':');
    let sec = 0;
    if (parts.length === 3) {
        sec = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2].replace(',', '.'));
    } else {
        sec = parseFloat(parts[0]) * 60 + parseFloat(parts[1].replace(',', '.'));
    }
    return sec;
}

// ============================================
// Autoplay Helper
// ============================================
function dismissPoster() {
    if (posterOverlay) {
        if (posterOverlay.classList.contains('autoplay-pending')) {
            posterOverlay.classList.add('fade-out');
            setTimeout(function() { posterOverlay.classList.add('hidden'); }, 400);
        } else {
            posterOverlay.classList.add('hidden');
        }
    }
}

function showUnmuteHint() {
    if (document.getElementById('unmuteHint')) return;
    var el = document.createElement('div');
    el.id = 'unmuteHint';
    el.setAttribute('style', 'position:absolute;bottom:80px;left:50%;transform:translateX(-50%);z-index:60;background:rgba(0,0,0,0.85);color:#fff;padding:10px 22px;border-radius:8px;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,0.15)');
    el.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0014 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg> Click to unmute';
    function dismissUnmute() {
        video.muted = false;
        var s = document.getElementById('volumeSlider');
        if (s) s.value = 1;
        var h = document.getElementById('volumeHigh');
        var m = document.getElementById('volumeMuted');
        if (h) h.classList.remove('hidden');
        if (m) m.classList.add('hidden');
        el.remove();
    }
    el.onclick = dismissUnmute;
    el.addEventListener('touchend', function(e) {
        e.preventDefault();
        e.stopPropagation();
        dismissUnmute();
    });
    wrapper.appendChild(el);
    setTimeout(function() { if (el.parentNode) el.style.opacity = '0.5'; }, 6000);
}

function tryAutoplay() {
    // Try unmuted autoplay first — desktop browsers allow it when the user
    // has sufficient engagement history (Chrome MEI). Fall back to muted + hint.
    video.muted = false;

    var p = video.play();
    if (p && p.then) {
        p.then(function() {
            // Unmuted autoplay succeeded (typically desktop with engagement history)
            wrapper.classList.remove('paused');
            dismissPoster();
        }).catch(function() {
            // Unmuted autoplay blocked — fall back to muted playback + hint
            video.muted = true;
            var p2 = video.play();
            if (p2 && p2.then) {
                p2.then(function() {
                    wrapper.classList.remove('paused');
                    dismissPoster();
                    showUnmuteHint();
                }).catch(function() {
                    // Even muted autoplay blocked (very strict iframe policy)
                    wrapper.classList.add('paused');
                });
            }
        });
    }
}

// ============================================
// HLS Setup
// ============================================
function initHLS(url, isRetry = false) {
    // ✅ Force native HLS ONLY on iOS for fullscreen subtitle support
    // Android works fine with HLS.js + track elements
    if (isIOSDevice() && video.canPlayType('application/vnd.apple.mpegurl')) {
        _log('🍎 iOS detected: Using native HLS (required for fullscreen subtitles)');
        
        // Destroy any existing HLS.js instance
        if (state.hls) {
            state.hls.destroy();
            state.hls = null;
        }
        
        wrapper.classList.add('loading');
        
        video.src = url;
        video.addEventListener('loadedmetadata', () => {
            wrapper.classList.remove('loading');
            
            if (CONFIG.startAt > 0 && !isRetry) {
                video.currentTime = CONFIG.startAt;
            } else if (!isRetry) {
                if (CONFIG.autoplay) {
                    autoResumeWatchProgress();
                } else {
                    promptContinueWatching();
                }
            }
            
            if (CONFIG.autoplay) {
                tryAutoplay();
            } else {
                wrapper.classList.add('paused');
            }
            
            postEvent('ready');
            
            if (!isRetry) {
                setTimeout(() => loadSubtitlesAuto(), 500);
            }
        }, { once: true });
        
        video.addEventListener('error', () => {
            if (tryNextServer()) {
                _log('Switching to fallback server...');
            } else {
                showError('Failed to load video');
            }
        }, { once: true });
        
        return;
    }
    
    // Android and Desktop: use HLS.js if supported
    if (state.hls) {
        state.hls.destroy();
    }
    
    wrapper.classList.add('loading');
    
    if (Hls.isSupported()) {
        state.hls = new Hls({
            maxBufferLength: 30,
            maxMaxBufferLength: 60
        });
        
        state.hls.loadSource(url);
        state.hls.attachMedia(video);
        
        state.hls.on(Hls.Events.MANIFEST_PARSED, (e, data) => {
            state.qualities = data.levels;
            buildQualityMenu();
            wrapper.classList.remove('loading');
            
            if (CONFIG.startAt > 0 && !isRetry) {
                video.currentTime = CONFIG.startAt;
            } else if (!isRetry) {
                if (CONFIG.autoplay) {
                    autoResumeWatchProgress();
                } else {
                    promptContinueWatching();
                }
            }
            
            if (CONFIG.autoplay) {
                tryAutoplay();
            } else {
                wrapper.classList.add('paused');
            }
            
            postEvent('ready');
            
            if (!isRetry) {
                setTimeout(() => loadSubtitlesAuto(), 500);
            }
        });
        
        state.hls.on(Hls.Events.ERROR, (e, data) => {
            if (data.fatal) {
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    if (tryNextServer()) {
                        _log('Network error, trying next server...');
                    } else {
                        showError('Network error - all servers failed');
                    }
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    state.hls.recoverMediaError();
                } else {
                    showError('Fatal playback error');
                }
            }
        });
        
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.addEventListener('loadedmetadata', () => {
            wrapper.classList.remove('loading');
            
            if (CONFIG.startAt > 0 && !isRetry) {
                video.currentTime = CONFIG.startAt;
            } else if (!isRetry) {
                if (CONFIG.autoplay) {
                    autoResumeWatchProgress();
                } else {
                    promptContinueWatching();
                }
            }
            
            if (CONFIG.autoplay) {
                tryAutoplay();
            } else {
                wrapper.classList.add('paused');
            }
            
            postEvent('ready');
            
            if (!isRetry) {
                setTimeout(() => loadSubtitlesAuto(), 500);
            }
        }, { once: true });
        
        video.addEventListener('error', () => {
            if (tryNextServer()) {
                _log('Switching to fallback server...');
            } else {
                showError('Failed to load video');
            }
        }, { once: true });
    }
}

function tryNextServer() {
    if (state.currentStreamIdx < state.allStreams.length - 1) {
        state.currentStreamIdx++;
        const nextUrl = state.allStreams[state.currentStreamIdx];
        _log(`Auto-switching to server ${state.currentStreamIdx + 1}/${state.allStreams.length}`);
        initHLS(nextUrl, true);
        return true;
    }
    // All streams for this source failed - try alternative source
    const sources = CONFIG.availableSources || ['justhd'];
    if (sources.length > 1) {
        const altSource = sources.find(s => s !== state.currentSource);
        if (altSource) {
            _log('All streams failed, auto-switching to source:', altSource);
            switchSource(altSource);
            return true;
        }
    }
    return false;
}

function showError(msg, code = null) {
    wrapper.innerHTML = `
        <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:#000;display:flex;align-items:center;justify-content:center;">
            <div style="text-align:center;padding:40px;">
                <div style="font-size:72px;font-weight:700;color:#3ea6ff;margin-bottom:16px;">${code || 'Error'}</div>
                <div style="font-size:24px;color:#aaa;margin-bottom:24px;">${msg}</div>
                <div style="font-size:14px;color:#666;">${CONFIG.idType.toUpperCase()}: ${CONFIG.mediaId}</div>
            </div>
        </div>
    `;
}

// ============================================
// PTT (Parse Torrent Title)
// ============================================
const PTT = {
    qualities: {
        '2160p': /2160p|4k|uhd/i,
        '1080p': /1080p|1080i/i,
        '720p': /720p/i,
        '480p': /480p/i,
        'HDRip': /hdrip/i,
        'BDRip': /bdrip|brrip/i,
        'DVDRip': /dvdrip/i,
        'WEBRip': /webrip/i,
        'WEB-DL': /web-?dl/i,
        'HDTV': /hdtv/i,
        'BluRay': /blu-?ray|bdremux/i,
        'CAM': /cam|camrip|hdcam/i,
        'TS': /\bts\b|telesync|hdts/i,
        'SCR': /scr|screener|dvdscr/i
    },
    
    releaseGroups: /[-\[]([A-Za-z0-9]+)(?:\])?$/,
    yearPattern: /(?:19|20)\d{2}/,
    seasonEpisode: /S(\d{1,2})E(\d{1,2})/i,
    
    codecs: {
        'x264': /x264|h\.?264/i,
        'x265': /x265|h\.?265|hevc/i,
        'XviD': /xvid/i,
        'DivX': /divx/i,
        'AV1': /\bav1\b/i
    },
    
    audio: {
        'DTS': /\bdts\b/i,
        'AC3': /ac3|dd5\.?1/i,
        'AAC': /\baac\b/i,
        'FLAC': /flac/i,
        'Atmos': /atmos/i,
        'TrueHD': /truehd/i
    },
    
    parse(filename) {
        if (!filename) return null;
        
        const result = {
            original: filename,
            title: '',
            year: null,
            quality: null,
            resolution: null,
            codec: null,
            audio: null,
            releaseGroup: null,
            season: null,
            episode: null
        };
        
        let clean = filename.replace(/\.(mkv|mp4|avi|mov|wmv|flv|webm|srt|sub|ass|vtt)$/i, '');
        
        const yearMatch = clean.match(this.yearPattern);
        if (yearMatch) result.year = parseInt(yearMatch[0]);
        
        const seMatch = clean.match(this.seasonEpisode);
        if (seMatch) {
            result.season = parseInt(seMatch[1]);
            result.episode = parseInt(seMatch[2]);
        }
        
        for (const [quality, pattern] of Object.entries(this.qualities)) {
            if (pattern.test(clean)) {
                if (['2160p', '1080p', '720p', '480p'].includes(quality)) {
                    result.resolution = quality;
                } else {
                    result.quality = quality;
                }
                break;
            }
        }
        
        for (const [codec, pattern] of Object.entries(this.codecs)) {
            if (pattern.test(clean)) {
                result.codec = codec;
                break;
            }
        }
        
        for (const [audio, pattern] of Object.entries(this.audio)) {
            if (pattern.test(clean)) {
                result.audio = audio;
                break;
            }
        }
        
        const groupMatch = clean.match(this.releaseGroups);
        if (groupMatch) result.releaseGroup = groupMatch[1];
        
        let titleEnd = clean.length;
        if (yearMatch) titleEnd = Math.min(titleEnd, yearMatch.index);
        
        for (const pattern of Object.values(this.qualities)) {
            const match = clean.match(pattern);
            if (match) titleEnd = Math.min(titleEnd, match.index);
        }
        
        result.title = clean.substring(0, titleEnd)
            .replace(/[._-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
        
        return result;
    },
    
    matchScore(videoInfo, subtitleFilename) {
        if (!videoInfo || !subtitleFilename) return 0;
        
        const subInfo = this.parse(subtitleFilename);
        if (!subInfo) return 0;
        
        let score = 0;
        
        if (videoInfo.title && subInfo.title) {
            const videoWords = videoInfo.title.toLowerCase().split(/\s+/);
            const subWords = subInfo.title.toLowerCase().split(/\s+/);
            const matchedWords = videoWords.filter(w => subWords.includes(w));
            score += (matchedWords.length / Math.max(videoWords.length, 1)) * 40;
        }
        
        if (videoInfo.year && subInfo.year && videoInfo.year === subInfo.year) {
            score += 15;
        }
        
        if (videoInfo.season && videoInfo.episode) {
            if (subInfo.season === videoInfo.season && subInfo.episode === videoInfo.episode) {
                score += 20;
            }
        }
        
        if (videoInfo.resolution && subInfo.resolution && videoInfo.resolution === subInfo.resolution) {
            score += 10;
        }
        
        if (videoInfo.releaseGroup && subInfo.releaseGroup) {
            if (videoInfo.releaseGroup.toLowerCase() === subInfo.releaseGroup.toLowerCase()) {
                score += 15;
            }
        }
        
        return Math.round(score);
    },
    
    findBestMatch(videoInfo, subtitles) {
        if (!videoInfo || !subtitles || subtitles.length === 0) return null;
        
        let bestMatch = null;
        let bestScore = 0;
        
        for (const sub of subtitles) {
            const filename = sub.SubFileName || sub.MovieReleaseName || '';
            const score = this.matchScore(videoInfo, filename);
            const downloads = parseInt(sub.SubDownloadsCnt) || 0;
            const adjustedScore = score + (downloads > 1000 ? 2 : downloads > 100 ? 1 : 0);
            
            if (adjustedScore > bestScore) {
                bestScore = adjustedScore;
                bestMatch = { subtitle: sub, score: adjustedScore, index: subtitles.indexOf(sub) };
            }
        }
        
        return bestScore >= 50 ? bestMatch : null;
    }
};

// ============================================
// Fetch Stream Data
// ============================================
function buildStreamApiUrl(source) {
    if (source && source !== 'justhd' && CONFIG.sourceApiUrl) {
        let url = CONFIG.sourceApiUrl + '?source=' + encodeURIComponent(source) + '&';
        if (CONFIG.idType === 'imdb') {
            url += 'imdb=' + encodeURIComponent(CONFIG.mediaId);
        } else {
            url += 'tmdb=' + encodeURIComponent(CONFIG.mediaId);
        }
        url += '&type=' + CONFIG.mediaType;
        if (CONFIG.mediaType === 'tv' && CONFIG.season && CONFIG.episode) {
            url += '&season=' + CONFIG.season + '&episode=' + CONFIG.episode;
        }
        return url;
    }
    let url = CONFIG.streamDataApiUrl + '?';
    if (CONFIG.idType === 'imdb') {
        url += 'imdb=' + encodeURIComponent(CONFIG.mediaId);
    } else {
        url += 'tmdb=' + encodeURIComponent(CONFIG.mediaId);
    }
    url += '&type=' + CONFIG.mediaType;
    if (CONFIG.mediaType === 'tv' && CONFIG.season && CONFIG.episode) {
        url += '&season=' + CONFIG.season + '&episode=' + CONFIG.episode;
    }
    return url;
}

function fetchStreamData(forceSource) {
    wrapper.classList.add('loading');
    
    const source = forceSource || state.currentSource || 'justhd';
    let apiUrl = buildStreamApiUrl(source);
    
    _log('Fetching stream data:', apiUrl, '(source:', source, ')');
    
    $.get(apiUrl)
        .done(function(response) {
            // Parse JSON if response is a string
            if (typeof response === 'string') {
                try {
                    response = JSON.parse(response);
                } catch (e) {
                    console.error('Failed to parse response:', e);
                    showError('Invalid API response', 500);
                    return;
                }
            }
            
            // Handle both string and number status_code
            const isSuccess = response.status_code === '200' || response.status_code === 200;
            
            if (isSuccess && response.data) {
                state.apiData = response.data;
                
                // Store episode data for navigation if available
                if (response.data.eps) {
                    state.episodeData = response.data.eps;
                }
                
                if (CONFIG.mediaType === 'tv' && response.data.eps && (!CONFIG.season || !CONFIG.episode)) {
                    if (response.data.title && !CONFIG.title) {
                        const titleTextEl = $id('titleText');
                        if (titleTextEl) titleTextEl.textContent = response.data.title;
                        setPlayerTitle(response.data.title);
                    }
                    
                    if (response.data.backdrop && !CONFIG.poster && CONFIG.showBackdrop !== false) {
                        if (posterOverlay) {
                            posterOverlay.style.backgroundImage = 'url(' + response.data.backdrop + ')';
                        }
                        if (response.data.backdrop.indexOf('image.tmdb.org') === -1) {
                            video.poster = response.data.backdrop;
                        }
                    }
                    
                    initEpisodeSelector(response.data.eps);
                    initEpisodeNavigation();
                    wrapper.classList.remove('loading');
                    return;
                }
                
                state.allStreams = response.data.stream_urls || [];
                state.fileName = response.data.file_name || '';
                state.videoInfo = PTT.parse(state.fileName);
                state.defaultSubs = response.default_subs || [];
                
                if (state.allStreams.length === 0) {
                    showError('No streams available', 404);
                    return;
                }
                
                if (response.data.title && !CONFIG.title) {
                    const titleTextEl = $id('titleText');
                    if (CONFIG.mediaType === 'tv' && CONFIG.season && CONFIG.episode) {
                        const seLabel = ' ' + CONFIG.season + '-' + CONFIG.episode;
                        if (titleTextEl) titleTextEl.textContent = response.data.title + seLabel;
                        setPlayerTitle(response.data.title + seLabel);
                    } else {
                        if (titleTextEl) titleTextEl.textContent = response.data.title;
                        setPlayerTitle(response.data.title);
                    }
                }
                
                if (response.data.backdrop && !CONFIG.poster && CONFIG.showBackdrop !== false) {
                    if (posterOverlay) {
                        posterOverlay.style.backgroundImage = 'url(' + response.data.backdrop + ')';
                    }
                    if (response.data.backdrop.indexOf('image.tmdb.org') === -1) {
                        video.poster = response.data.backdrop;
                    }
                }
                
                initHLS(state.allStreams[0]);
                
                // Initialize episode navigation for TV shows
                if (CONFIG.mediaType === 'tv') {
                    initEpisodeNavigation();
                }

                fetchSegments();

                if (response.thumbnails_url && !CONFIG.thumbnails) {
                    loadThumbnails(response.thumbnails_url);
                }
                
            } else {
                // Source returned no data - try alternative source
                const sources = CONFIG.availableSources || ['justhd'];
                const altSource = sources.find(s => s !== source);
                if (altSource && !state._sourceFallbackAttempted) {
                    state._sourceFallbackAttempted = true;
                    _log('Source', source, 'returned no data, trying', altSource);
                    switchSource(altSource);
                } else {
                    showError('Content not found', response.status_code || 404);
                }
            }
        })
        .fail(function(xhr) {
            console.error('API request failed:', xhr);
            const sources = CONFIG.availableSources || ['justhd'];
            const altSource = sources.find(s => s !== source);
            if (altSource && !state._sourceFallbackAttempted) {
                state._sourceFallbackAttempted = true;
                _log('Source', source, 'failed, trying', altSource);
                switchSource(altSource);
            } else {
                showError('Failed to load content', xhr.status || 500);
            }
        });
}

// ============================================
// Touch Helper (needed before episode selector)
// ============================================
let touchTimeout;
function keepTouched() {
    wrapper.classList.add('touched');
    clearTimeout(touchTimeout);
    touchTimeout = setTimeout(() => wrapper.classList.remove('touched'), 8000);
}

// ============================================
// Episode Selector
// ============================================
function initEpisodeSelector(eps) {
    const selectorEl = $id('episodeSelector');
    const seasonMenu = $id('seasonMenu');
    const episodeMenu = $id('episodeMenu');
    const seasonLabel = $id('seasonLabel');
    const episodeLabel = $id('episodeLabel');
    const seasonDropdown = $id('seasonDropdown');
    const episodeDropdown = $id('episodeDropdown');
    const seasonBtn = $id('seasonBtn');
    const episodeBtn = $id('episodeBtn');
    
    if (!selectorEl || !eps || !seasonMenu || !episodeMenu) return;
    
    const seasons = Object.keys(eps).sort((a, b) => parseInt(a) - parseInt(b));
    if (seasons.length === 0) return;
    
    let currentSeason = seasons[0];
    let currentEpisode = null;
    
    function stopEvent(e) {
        e.stopPropagation();
    }
    
    function stopEventFull(e) {
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (e.cancelable) e.preventDefault();
    }
    
    function closeAllDropdowns() {
        seasonDropdown.classList.remove('open');
        episodeDropdown.classList.remove('open');
    }
    
    function buildSeasonMenu() {
        seasonMenu.innerHTML = seasons.map(s => `
            <div class="ep-dropdown-item${s === currentSeason ? ' active' : ''}" data-season="${s}">
                S${String(s).padStart(2, '0')}
            </div>
        `).join('');
    }

    seasonMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.ep-dropdown-item');
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        const s = item.dataset.season;
        if (s !== currentSeason) {
            currentSeason = s;
            seasonLabel.textContent = 'S' + String(s).padStart(2, '0');
            currentEpisode = null;
            episodeLabel.textContent = 'E--';
            buildSeasonMenu();
            buildEpisodeMenu();
        }
        closeAllDropdowns();
    });
    
    function buildEpisodeMenu() {
        const episodes = eps[currentSeason] || [];
        episodeMenu.innerHTML = episodes.map(e => `
            <div class="ep-dropdown-item${e === currentEpisode ? ' active' : ''}" data-episode="${e}">
                E${String(e).padStart(2, '0')}
            </div>
        `).join('');
    }

    episodeMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.ep-dropdown-item');
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        const ep = item.dataset.episode;
        currentEpisode = ep;
        episodeLabel.textContent = 'E' + String(ep).padStart(2, '0');
        buildEpisodeMenu();
        closeAllDropdowns();
        loadEpisode(parseInt(currentSeason), parseInt(ep));
    });
    
    function loadEpisode(season, episode) {
        wrapper.classList.add('loading');
        
        // Clear old subtitles before loading new episode
        clearAllSubtitles();
        
        let apiUrl = CONFIG.streamDataApiUrl + '?';
        if (CONFIG.idType === 'imdb') {
            apiUrl += 'imdb=' + encodeURIComponent(CONFIG.mediaId);
        } else {
            apiUrl += 'tmdb=' + encodeURIComponent(CONFIG.mediaId);
        }
        apiUrl += '&type=tv&season=' + season + '&episode=' + episode;
        
        $.get(apiUrl)
            .done(function(response) {
                // Parse JSON if response is a string
                if (typeof response === 'string') {
                    try { response = JSON.parse(response); } catch (e) { return; }
                }
                if ((response.status_code === '200' || response.status_code === 200) && response.data && response.data.stream_urls) {
                    state.apiData = response.data;
                    state.allStreams = response.data.stream_urls;
                    state.currentStreamIdx = 0;
                    state.fileName = response.data.file_name || '';
                    state.videoInfo = PTT.parse(state.fileName);
                    state.defaultSubs = response.default_subs || [];
                    
                    CONFIG.season = season;
                    CONFIG.episode = episode;
                    
                    saveLastWatchedEpisode(season, episode);
                    
                    seasonLabel.textContent = 'S' + String(season).padStart(2, '0');
                    episodeLabel.textContent = 'E' + String(episode).padStart(2, '0');
                    
                    const titleEl = $id('titleText');
                    if (titleEl && state.apiData && state.apiData.title) {
                        const seLabel = ' ' + season + '-' + episode;
                        titleEl.textContent = state.apiData.title + seLabel;
                        setPlayerTitle(state.apiData.title + seLabel);
                    }
                    
                    initHLS(state.allStreams[0]);
                    
                    if (typeof window.updateEpisodeNavButtons === 'function') {
                        window.updateEpisodeNavButtons();
                    }
                    
                    setTimeout(() => loadSubtitlesAuto(), 500);
                } else {
                    wrapper.classList.remove('loading');
                    console.error('Failed to load episode:', response);
                }
            })
            .fail(function(xhr) {
                wrapper.classList.remove('loading');
                console.error('API request failed:', xhr);
            });
    }
    
seasonBtn.addEventListener('click', (e) => {
    _log('🎯 SEASON BUTTON CLICKED!', e);
    _log('   - seasonDropdown element:', seasonDropdown);
    _log('   - classList:', seasonDropdown.classList);
    
    stopEvent(e);
    keepTouched();
    
    const wasOpen = seasonDropdown.classList.contains('open');
    _log('   - wasOpen:', wasOpen);
    
    closeAllDropdowns();
    _log('   - After closeAllDropdowns');
    
    if (!wasOpen) {
        seasonDropdown.classList.add('open');
        _log('   - Added "open" class');
        _log('   - New classList:', seasonDropdown.classList);
    }
});

// Do the same for episodeBtn
episodeBtn.addEventListener('click', (e) => {
    _log('🎯 EPISODE BUTTON CLICKED!', e);
    
    stopEvent(e);
    keepTouched();
    
    const wasOpen = episodeDropdown.classList.contains('open');
    _log('   - wasOpen:', wasOpen);
    
    closeAllDropdowns();
    
    if (!wasOpen) {
        episodeDropdown.classList.add('open');
        _log('   - Added "open" class');
    }
});
    
    // Add touchend for mobile
    episodeBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        keepTouched();
        const wasOpen = episodeDropdown.classList.contains('open');
        closeAllDropdowns();
        if (!wasOpen) episodeDropdown.classList.add('open');
    });
    
    [seasonMenu, episodeMenu, seasonDropdown, episodeDropdown, selectorEl].forEach(el => {
        el.addEventListener('click', stopEvent);
        el.addEventListener('mousedown', stopEvent);
        el.addEventListener('touchstart', (e) => { stopEvent(e); keepTouched(); }, { passive: true });
        el.addEventListener('touchend', stopEvent, { passive: true });
    });
    
    document.addEventListener('click', (e) => {
        if (!selectorEl.contains(e.target)) closeAllDropdowns();
    });
    
    // Check for last watched episode
    const lastWatched = getLastWatchedEpisode();
    
    if (lastWatched && eps[lastWatched.season]) {
        // Restore last watched season/episode
        currentSeason = lastWatched.season;
        const episodesInSeason = eps[currentSeason] || [];
        if (episodesInSeason.includes(lastWatched.episode) || episodesInSeason.includes(String(lastWatched.episode))) {
            currentEpisode = lastWatched.episode;
        } else {
            currentEpisode = episodesInSeason[0] || null;
        }
    } else {
        // Default to first episode
        const firstEpisodes = eps[currentSeason] || [];
        currentEpisode = firstEpisodes.length > 0 ? firstEpisodes[0] : null;
    }
    
    seasonLabel.textContent = 'S' + String(currentSeason).padStart(2, '0');
    buildSeasonMenu();
    buildEpisodeMenu();
    selectorEl.classList.remove('hidden');
    
    if (currentEpisode) {
        episodeLabel.textContent = 'E' + String(currentEpisode).padStart(2, '0');
        buildEpisodeMenu();
        
        if (lastWatched) {
            showLastWatchedIndicator(lastWatched.season, lastWatched.episode);
        }
        
        loadEpisode(parseInt(currentSeason), parseInt(currentEpisode));
    } else {
        episodeLabel.textContent = 'E--';
    }
}

// ============================================
// Last Watched Episode Memory
// ============================================
function getLastWatchedEpisodeKey() {
    return 'last_ep_' + CONFIG.mediaId;
}

function saveLastWatchedEpisode(season, episode) {
    const key = getLastWatchedEpisodeKey();
    const data = {
        season: parseInt(season),
        episode: parseInt(episode),
        timestamp: Date.now()
    };
    try {
        parentStorage.setItem(key, JSON.stringify(data));
    } catch (e) {}
}

function getLastWatchedEpisode() {
    const key = getLastWatchedEpisodeKey();
    try {
        const data = parentStorage.getItem(key);
        if (data) {
            const parsed = JSON.parse(data);
            // Only return if within last 90 days
            if (Date.now() - parsed.timestamp < 90 * 24 * 60 * 60 * 1000) {
                return parsed;
            }
        }
    } catch (e) {}
    return null;
}

function showLastWatchedIndicator(season, episode) {
    // Brief toast notification
    const toast = document.createElement('div');
    toast.className = 'last-watched-toast';
    toast.innerHTML = `Resuming from S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
    wrapper.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// Episode Navigation (Prev/Next)
// ============================================
function initEpisodeNavigation() {
    const prevBtnDesktop = $id('prevEpBtn');
    const nextBtnDesktop = $id('nextEpBtn');
    const prevBtnMobile = $id('mobilePrevEp');
    const nextBtnMobile = $id('mobileNextEp');
    
    function updateNavButtons() {
        if (CONFIG.mediaType !== 'tv' || !state.episodeData) {
            // Hide all nav buttons
            [prevBtnDesktop, nextBtnDesktop, prevBtnMobile, nextBtnMobile].forEach(btn => {
                if (btn) btn.classList.add('hidden');
            });
            return;
        }
        
        const nav = getEpisodeNavigation();
        
        // Update prev buttons
        [prevBtnDesktop, prevBtnMobile].forEach(btn => {
            if (btn) {
                if (nav.prev) {
                    btn.classList.remove('hidden');
                    btn.title = 'Previous: S' + String(nav.prev.season).padStart(2, '0') + 'E' + String(nav.prev.episode).padStart(2, '0');
                } else {
                    btn.classList.add('hidden');
                }
            }
        });
        
        // Update next buttons
        [nextBtnDesktop, nextBtnMobile].forEach(btn => {
            if (btn) {
                if (nav.next) {
                    btn.classList.remove('hidden');
                    btn.title = 'Next: S' + String(nav.next.season).padStart(2, '0') + 'E' + String(nav.next.episode).padStart(2, '0');
                } else {
                    btn.classList.add('hidden');
                }
            }
        });
    }
    
    function getEpisodeNavigation() {
        if (!state.episodeData) return { prev: null, next: null };
        
        const currentSeason = CONFIG.season;
        const currentEpisode = CONFIG.episode;
        
        if (!currentSeason || !currentEpisode) return { prev: null, next: null };
        
        const seasons = Object.keys(state.episodeData).map(Number).sort((a, b) => a - b);
        const seasonIdx = seasons.indexOf(currentSeason);
        
        if (seasonIdx === -1) return { prev: null, next: null };
        
        const episodes = (state.episodeData[currentSeason] || []).map(Number).sort((a, b) => a - b);
        const epIdx = episodes.indexOf(currentEpisode);
        
        let prev = null;
        let next = null;
        
        // Previous episode
        if (epIdx > 0) {
            prev = { season: currentSeason, episode: episodes[epIdx - 1] };
        } else if (seasonIdx > 0) {
            const prevSeason = seasons[seasonIdx - 1];
            const prevEps = (state.episodeData[prevSeason] || []).map(Number).sort((a, b) => a - b);
            if (prevEps.length > 0) {
                prev = { season: prevSeason, episode: prevEps[prevEps.length - 1] };
            }
        }
        
        // Next episode
        if (epIdx < episodes.length - 1) {
            next = { season: currentSeason, episode: episodes[epIdx + 1] };
        } else if (seasonIdx < seasons.length - 1) {
            const nextSeason = seasons[seasonIdx + 1];
            const nextEps = (state.episodeData[nextSeason] || []).map(Number).sort((a, b) => a - b);
            if (nextEps.length > 0) {
                next = { season: nextSeason, episode: nextEps[0] };
            }
        }
        
        return { prev, next };
    }
    
    function navigateEpisode(direction) {
        const nav = getEpisodeNavigation();
        const target = direction === 'prev' ? nav.prev : nav.next;
        
        if (!target) return;
        
        // Load the episode
        loadEpisodeGlobal(target.season, target.episode);
    }
    
    // Global episode loader (used by nav buttons)
    window.loadEpisodeGlobal = function(season, episode) {
        wrapper.classList.add('loading');
        clearAllSubtitles();
        state.segments = [];
        hideSkipButton();
        
        let apiUrl = CONFIG.streamDataApiUrl + '?';
        if (CONFIG.idType === 'imdb') {
            apiUrl += 'imdb=' + encodeURIComponent(CONFIG.mediaId);
        } else {
            apiUrl += 'tmdb=' + encodeURIComponent(CONFIG.mediaId);
        }
        apiUrl += '&type=tv&season=' + season + '&episode=' + episode;
        
        $.get(apiUrl).done(function(response) {
            if (typeof response === 'string') {
                try { response = JSON.parse(response); } catch (e) { return; }
            }
            if ((response.status_code === '200' || response.status_code === 200) && response.data && response.data.stream_urls) {
                state.apiData = response.data;
                state.allStreams = response.data.stream_urls;
                state.currentStreamIdx = 0;
                state.fileName = response.data.file_name || '';
                state.videoInfo = PTT.parse(state.fileName);
                state.defaultSubs = response.default_subs || [];
                CONFIG.season = season;
                CONFIG.episode = episode;
                
                saveLastWatchedEpisode(season, episode);
                
                const seasonLabel = $id('seasonLabel');
                const episodeLabel = $id('episodeLabel');
                if (seasonLabel) seasonLabel.textContent = 'S' + String(season).padStart(2, '0');
                if (episodeLabel) episodeLabel.textContent = 'E' + String(episode).padStart(2, '0');
                
                setPlayerTitle((state.apiData?.title || '') + ' S' + String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0'));
                
                initHLS(state.allStreams[0]);
                setTimeout(() => loadSubtitlesAuto(), 500);
                
                updateNavButtons();
                fetchSegments();
                
                sendPlayerEvent('episode_change', { season, episode });
            } else {
                wrapper.classList.remove('loading');
            }
        }).fail(function() {
            wrapper.classList.remove('loading');
        });
    };
    
    // Bind click handlers
    [prevBtnDesktop, prevBtnMobile].forEach(btn => {
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigateEpisode('prev');
            });
        }
    });
    
    [nextBtnDesktop, nextBtnMobile].forEach(btn => {
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigateEpisode('next');
            });
            btn.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                navigateEpisode('next');
                keepTouched();
            });
        }
    });
    
    // Add touchend for prev buttons
    [prevBtnDesktop, prevBtnMobile].forEach(btn => {
        if (btn) {
            btn.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                navigateEpisode('prev');
                keepTouched();
            });
        }
    });
    
    // Auto next episode on video end (premium feature)
    if (CONFIG.autoNext && CONFIG.mediaType === 'tv') {
        video.addEventListener('ended', () => {
            const nav = getEpisodeNavigation();
            if (nav.next) {
                navigateEpisode('next');
            }
        });
    }
    
    // Expose update function globally
    window.updateEpisodeNavButtons = updateNavButtons;
    
    // Initial update
    updateNavButtons();
}

// ============================================
// Playback Controls
// ============================================

// Check if we need to load first episode before playing
function tryPlay() {
    // If TV show without episode loaded, start from last watched or S01E01
    if (CONFIG.mediaType === 'tv' && state.episodeData && state.allStreams.length === 0) {
        const seasons = Object.keys(state.episodeData).sort((a, b) => parseInt(a) - parseInt(b));
        if (seasons.length > 0) {
            // Check for last watched episode
            const lastWatched = getLastWatchedEpisode();
            let targetSeason, targetEp;
            
            if (lastWatched && state.episodeData[lastWatched.season]) {
                // Resume from last watched
                targetSeason = lastWatched.season;
                const episodesInSeason = state.episodeData[targetSeason] || [];
                if (episodesInSeason.includes(lastWatched.episode) || episodesInSeason.includes(String(lastWatched.episode))) {
                    targetEp = lastWatched.episode;
                } else {
                    targetEp = episodesInSeason[0];
                }
            } else {
                // Start from first episode
                targetSeason = seasons[0];
                const episodes = state.episodeData[targetSeason] || [];
                targetEp = episodes[0];
            }
            
            if (targetSeason && targetEp) {
                const selectorEl = $id('episodeSelector');
                const seasonLabel = $id('seasonLabel');
                const episodeLabel = $id('episodeLabel');
                
                if (selectorEl && seasonLabel && episodeLabel) {
                    // Update labels
                    seasonLabel.textContent = 'S' + String(targetSeason).padStart(2, '0');
                    episodeLabel.textContent = 'E' + String(targetEp).padStart(2, '0');
                    
                    // Load the episode via API
                    wrapper.classList.add('loading');
                    let apiUrl = CONFIG.streamDataApiUrl + '?';
                    if (CONFIG.idType === 'imdb') {
                        apiUrl += 'imdb=' + encodeURIComponent(CONFIG.mediaId);
                    } else {
                        apiUrl += 'tmdb=' + encodeURIComponent(CONFIG.mediaId);
                    }
                    apiUrl += '&type=tv&season=' + targetSeason + '&episode=' + targetEp;
                    
                    $.get(apiUrl).done(function(response) {
                        // Parse JSON if response is a string
                        if (typeof response === 'string') {
                            try { response = JSON.parse(response); } catch (e) { return; }
                        }
                        if ((response.status_code === '200' || response.status_code === 200) && response.data && response.data.stream_urls) {
                            state.apiData = response.data;
                            state.allStreams = response.data.stream_urls;
                            state.currentStreamIdx = 0;
                            state.fileName = response.data.file_name || '';
                            state.videoInfo = PTT.parse(state.fileName);
                            state.defaultSubs = response.default_subs || [];
                            CONFIG.season = parseInt(targetSeason);
                            CONFIG.episode = parseInt(targetEp);
                            
                            saveLastWatchedEpisode(targetSeason, targetEp);
                            
                            setPlayerTitle((state.apiData?.title || '') + ' S' + String(targetSeason).padStart(2, '0') + 'E' + String(targetEp).padStart(2, '0'));
                            
                            initHLS(state.allStreams[0]);
                            setTimeout(() => loadSubtitlesAuto(), 500);
                            
                            if (typeof window.updateEpisodeNavButtons === 'function') {
                                window.updateEpisodeNavButtons();
                            }
                        } else {
                            wrapper.classList.remove('loading');
                        }
                    }).fail(function() {
                        wrapper.classList.remove('loading');
                    });
                }
                return;
            }
        }
    }
    
    // Normal play
    if (video.paused) {
        video.play();
    } else {
        video.pause();
    }
}

function togglePlay() {
    if (video.paused) {
        video.play();
    } else {
        video.pause();
    }
}

function updatePlayState() {
    const paused = video.paused;
    wrapper.classList.toggle('paused', paused);
    playIcon.classList.toggle('hidden', !paused);
    pauseIcon.classList.toggle('hidden', paused);
}

video.addEventListener('play', () => { 
    updatePlayState(); 
    postEvent('play');
    // Auto-hide controls after video starts playing (only for touch devices)
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        clearTimeout(touchTimeout);
        touchTimeout = setTimeout(() => wrapper.classList.remove('touched'), 5000);
    }
});
video.addEventListener('pause', () => { 
    updatePlayState(); 
    postEvent('pause');
    // Save progress when paused
    saveWatchProgress();
});
video.addEventListener('ended', () => { 
    postEvent('ended');
    clearWatchProgress();
});
video.addEventListener('seeked', () => { postEvent('seeked'); });
video.addEventListener('timeupdate', () => { 
    postProgress();
    // Save progress periodically (every 5 seconds)
    saveWatchProgressThrottled();
});

// ============================================
// Continue Watching Feature
// ============================================
let lastSaveTime = 0;

function getWatchProgressKey() {
    // Create unique key based on media ID and episode
    let key = 'watch_' + CONFIG.mediaId;
    if (CONFIG.mediaType === 'tv' && CONFIG.season && CONFIG.episode) {
        key += '_s' + CONFIG.season + 'e' + CONFIG.episode;
    }
    return key;
}

function saveWatchProgress() {
    if (!video.duration || video.duration < 60) return;
    if (video.currentTime < 10) return;
    if (video.currentTime > video.duration - 30) return;

    const key = getWatchProgressKey();
    const titleEl = document.getElementById('titleText');
    const savedTitle = CONFIG.title || (titleEl && titleEl.textContent.trim()) || document.title;
    const savedPoster = getCwPoster();
    const data = {
        time: video.currentTime,
        duration: video.duration,
        percent: (video.currentTime / video.duration) * 100,
        title: savedTitle,
        poster: savedPoster,
        timestamp: Date.now()
    };
    
    try {
        parentStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
        console.warn('Could not save watch progress:', e);
    }
}

function saveWatchProgressThrottled() {
    const now = Date.now();
    if (now - lastSaveTime > 5000) { // Save every 5 seconds
        lastSaveTime = now;
        saveWatchProgress();
    }
}

function loadWatchProgress() {
    const key = getWatchProgressKey();
    try {
        const data = parentStorage.getItem(key);
        if (data) {
            const parsed = JSON.parse(data);
            // Only restore if saved within last 30 days
            if (Date.now() - parsed.timestamp < 30 * 24 * 60 * 60 * 1000) {
                return parsed;
            }
        }
    } catch (e) {
        console.warn('Could not load watch progress:', e);
    }
    return null;
}

function clearWatchProgress() {
    const key = getWatchProgressKey();
    try {
        parentStorage.removeItem(key);
    } catch (e) {}
}

function promptContinueWatching() {
    if (document.getElementById('continueOverlay')) return false;
    const progress = loadWatchProgress();
    if (!progress || progress.time < 30) return false;

    const percent = Math.round(progress.percent);
    const timeStr = formatTime(progress.time);

    showContinuePrompt(progress.time, timeStr, percent, progress.title || '', progress.poster || '');
    return true;
}

function autoResumeWatchProgress() {
    const progress = loadWatchProgress();
    if (!progress || progress.time < 30) return false;
    video.currentTime = progress.time;
    return true;
}

function getCwTitle(savedTitle) {
    if (CONFIG.title) return CONFIG.title;
    const titleEl = document.getElementById('titleText');
    if (titleEl && titleEl.textContent.trim()) return titleEl.textContent.trim();
    if (savedTitle) return savedTitle;
    return '';
}

function getCwPoster() {
    if (CONFIG.poster) return CONFIG.poster;
    const posterEl = document.getElementById('posterOverlay') || document.querySelector('.poster-overlay');
    if (posterEl) {
        const bg = posterEl.style.backgroundImage || '';
        const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (m && m[1]) return m[1];
        try {
            const computed = window.getComputedStyle(posterEl).backgroundImage || '';
            const mc = computed.match(/url\(["']?([^"')]+)["']?\)/);
            if (mc && mc[1] && mc[1] !== 'none') return mc[1];
        } catch(e) {}
    }
    if (video && video.poster) return video.poster;
    return '';
}

function getContinueWatchingHTML(skin, timeStr, percent, savedTitle, savedPoster) {
    const title = getCwTitle(savedTitle);
    const displayTitle = title || 'Your Video';
    const poster = getCwPoster() || savedPoster || '';
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const posterStyle = poster ? `background-image:url('${esc(poster)}')` : '';
    const circumference = Math.round(2 * Math.PI * 35);
    const offset = Math.round(circumference * (1 - percent / 100));

    switch (skin) {
        case 'netflix':
            return `<div class="cw-netflix-card${poster ? '' : ' cw-netflix-no-poster'}">
                ${poster ? `<div class="cw-netflix-poster" style="${posterStyle}">
                    <div class="cw-netflix-bar" style="width:${percent}%"></div>
                    <div class="cw-netflix-play-icon"><svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></div>
                </div>` : ''}
                <div class="cw-netflix-info">
                    <div class="cw-netflix-title">${esc(displayTitle)}</div>
                    <div class="cw-netflix-meta">Resume from ${timeStr} &middot; ${percent}%</div>
                    <div class="continue-buttons">
                        <button class="continue-btn continue-restart">Start Over</button>
                        <button class="continue-btn continue-resume">&#9654; Resume</button>
                    </div>
                </div>
            </div>`;

        case 'vidzilla':
            return `<div class="cw-vz-card">
                <div class="cw-vz-ring">
                    <svg viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="35" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="4"/>
                        <circle cx="40" cy="40" r="35" fill="none" stroke="var(--primary,#4a9eff)" stroke-width="4" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" class="cw-vz-ring-prog"/>
                    </svg>
                    <div class="cw-vz-ring-label">${percent}%</div>
                </div>
                <div class="cw-vz-title">${esc(displayTitle)}</div>
                <div class="cw-vz-meta">${timeStr} remaining</div>
                <div class="continue-buttons">
                    <button class="continue-btn continue-restart">Start Over</button>
                    <button class="continue-btn continue-resume">&#9654; Resume</button>
                </div>
            </div>`;

        case 'cinematic':
            return `<div class="cw-cine-card">
                <div class="cw-cine-icon"><svg viewBox="0 0 24 24" fill="var(--primary,#1a8fff)"><path d="M8 5v14l11-7z"/></svg></div>
                <div class="cw-cine-heading">Continue Watching</div>
                <div class="cw-cine-meta">${esc(displayTitle)} &middot; ${timeStr}</div>
                <div class="cw-cine-bar"><div class="cw-cine-bar-fill" style="width:${percent}%"></div></div>
                <div class="continue-buttons">
                    <button class="continue-btn continue-restart">Start Over</button>
                    <button class="continue-btn continue-resume">&#9654; Resume</button>
                </div>
            </div>`;

        case 'disney':
            return `<div class="cw-disney-card">
                <button class="cw-disney-play continue-resume"><svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></button>
                <div class="cw-disney-title">${esc(displayTitle)}</div>
                <div class="cw-disney-meta">Resume from ${timeStr}</div>
                <div class="cw-disney-bar"><div class="cw-disney-bar-fill" style="width:${percent}%"></div></div>
                <div class="continue-buttons">
                    <button class="continue-btn continue-restart">Start Over</button>
                    <button class="continue-btn continue-resume">&#9654; Resume</button>
                </div>
            </div>`;

        case 'prime':
            return `<div class="cw-prime-card${poster ? '' : ' cw-prime-no-poster'}">
                ${poster ? `<div class="cw-prime-poster" style="${posterStyle}">
                    <span class="cw-prime-badge">Resume</span>
                </div>` : ''}
                <div class="cw-prime-info">
                    <div class="cw-prime-title">${esc(displayTitle)}</div>
                    <div class="cw-prime-meta">${timeStr} &middot; ${percent}% watched</div>
                    <div class="cw-prime-bar"><div class="cw-prime-bar-fill" style="width:${percent}%"></div></div>
                    <div class="continue-buttons">
                        <button class="continue-btn continue-resume">&#9654; Resume</button>
                        <button class="continue-btn continue-restart">Start Over</button>
                    </div>
                </div>
            </div>`;

        default:
            return `<div class="continue-box">
                <div class="continue-title">Continue Watching?</div>
                <div class="continue-info">Resume from ${timeStr} (${percent}%)</div>
                <div class="continue-buttons">
                    <button class="continue-btn continue-restart">Start Over</button>
                    <button class="continue-btn continue-resume primary">Resume</button>
                </div>
            </div>`;
    }
}

function showContinuePrompt(time, timeStr, percent, savedTitle, savedPoster) {
    const skin = (document.body.dataset.skin || '').toLowerCase();
    const overlay = document.createElement('div');
    overlay.className = 'continue-overlay';
    overlay.id = 'continueOverlay';
    if (skin) overlay.setAttribute('data-skin-cw', skin);
    overlay.innerHTML = getContinueWatchingHTML(skin, timeStr, percent, savedTitle || '', savedPoster || '');

    wrapper.appendChild(overlay);

    overlay.querySelectorAll('.continue-restart').forEach(btn => {
        btn.addEventListener('click', () => {
            overlay.remove();
            video.currentTime = 0;
            video.play().catch(() => {});
        });
    });

    overlay.querySelectorAll('.continue-resume').forEach(btn => {
        btn.addEventListener('click', () => {
            overlay.remove();
            video.currentTime = time;
            video.play().catch(() => {});
        });
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });
}

// Save progress when page unloads
window.addEventListener('beforeunload', () => {
    saveWatchProgress();
});

// Save progress when visibility changes (user switches tabs/apps)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        saveWatchProgress();
    }
});

// ============================================
// Skip Segment (Intro / Recap / Outro)
// ============================================
let skipBtn = null;

function createSkipButton() {
    if (skipBtn) return;
    skipBtn = document.createElement('button');
    skipBtn.className = 'skip-segment-btn';
    skipBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 5v14l11-7L5 5zm13 0v14h2V5h-2z"/></svg><span></span>';
    skipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.activeSegment && video.duration) {
            video.currentTime = state.activeSegment.end_ms / 1000;
            hideSkipButton();
        }
    });
    wrapper.appendChild(skipBtn);
}

function showSkipButton(segment) {
    createSkipButton();
    const labels = { intro: 'Skip Intro', recap: 'Skip Recap', outro: 'Skip Outro' };
    skipBtn.querySelector('span').textContent = labels[segment.type] || 'Skip';
    state.activeSegment = segment;
    skipBtn.classList.add('visible');
}

function hideSkipButton() {
    if (skipBtn) skipBtn.classList.remove('visible');
    state.activeSegment = null;
}

function fetchSegments() {
    if (CONFIG.skipIntro === false) return;
    if (CONFIG.mediaType !== 'tv' || !CONFIG.season || !CONFIG.episode) return;

    let url = API_BASE + '/segments.php?';
    if (CONFIG.idType === 'imdb') {
        url += 'imdb=' + encodeURIComponent(CONFIG.mediaId);
    } else {
        url += 'tmdb=' + encodeURIComponent(CONFIG.mediaId);
    }
    url += '&season=' + CONFIG.season + '&episode=' + CONFIG.episode;

    $.get(url).done(function(res) {
        if (typeof res === 'string') {
            try { res = JSON.parse(res); } catch (e) { return; }
        }
        state.segments = Array.isArray(res) ? res : [];
        _log('Segments loaded:', state.segments);
    }).fail(function() {
        state.segments = [];
    });
}

function checkSegments() {
    if (!state.segments.length || !video.duration) return;
    const ms = video.currentTime * 1000;
    for (let i = 0; i < state.segments.length; i++) {
        const seg = state.segments[i];
        if (ms >= seg.start_ms && ms < seg.end_ms) {
            if (!state.activeSegment || state.activeSegment.type !== seg.type) {
                showSkipButton(seg);
            }
            return;
        }
    }
    if (state.activeSegment) hideSkipButton();
}

video.addEventListener('timeupdate', checkSegments);

playBtn.addEventListener('click', tryPlay);
bigPlay.addEventListener('click', tryPlay);
video.addEventListener('click', (e) => {
    if (e.target.closest('.episode-selector') || e.target.closest('.video-title-area')) return;
    if (isTouchDevice()) return;
    tryPlay();
});

// Mobile seek buttons (±10 seconds)
const mobileSeekBack = $id('mobileSeekBack');
const mobileSeekForward = $id('mobileSeekForward');

// Desktop seek buttons (±10 seconds)
const seekBackBtn = $id('seekBackBtn');
const seekForwardBtn = $id('seekForwardBtn');

function seekBy(seconds) {
    if (!video.duration) return;
    const newTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
    video.currentTime = newTime;
}

if (mobileSeekBack) {
    mobileSeekBack.addEventListener('click', (e) => {
        e.stopPropagation();
        seekBy(-10);
        keepTouched();
    });
    mobileSeekBack.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        seekBy(-10);
        keepTouched();
    });
}

if (mobileSeekForward) {
    mobileSeekForward.addEventListener('click', (e) => {
        e.stopPropagation();
        seekBy(10);
        keepTouched();
    });
    mobileSeekForward.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        seekBy(10);
        keepTouched();
    });
}

// Desktop seek buttons
if (seekBackBtn) {
    seekBackBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        seekBy(-10);
    });
}

if (seekForwardBtn) {
    seekForwardBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        seekBy(10);
    });
}

if (nextBtn) {
    nextBtn.addEventListener('click', () => { postEvent('next'); });
}

if (posterOverlay) {
    posterOverlay.addEventListener('click', () => {
        dismissPoster();
        tryPlay();
    });
    video.addEventListener('play', () => dismissPoster(), { once: true });
}

video.addEventListener('waiting', () => wrapper.classList.add('loading'));
video.addEventListener('canplay', () => wrapper.classList.remove('loading'));
video.addEventListener('playing', () => wrapper.classList.remove('loading'));

// Track touch for tap-to-toggle (not drag)
let touchStartTime = 0;
let touchStartX = 0;
let touchStartY = 0;

wrapper.addEventListener('touchstart', (e) => {
    touchStartTime = Date.now();
    if (e.touches[0]) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }
    
    // If touching controls/menus/episode selector/mobile buttons, keep visible and don't toggle
    if (e.target.closest('.controls') || e.target.closest('.menu') || e.target.closest('.episode-selector') || e.target.closest('.video-title-area') || e.target.closest('.mobile-seek') || e.target.closest('.mobile-ep-nav') || e.target.closest('.big-play')) {
        wrapper.classList.add('touched');
        clearTimeout(touchTimeout);
        touchTimeout = setTimeout(() => wrapper.classList.remove('touched'), 8000);
    }
}, { passive: true });

wrapper.addEventListener('touchend', (e) => {
    // Ignore if touching controls/menus/interactive elements/mobile buttons
    if (e.target.closest('.controls') || e.target.closest('.menu') || e.target.closest('.episode-selector') || e.target.closest('.video-title-area') || e.target.closest('.poster-overlay') || e.target.closest('.mobile-seek') || e.target.closest('.mobile-ep-nav') || e.target.closest('.big-play')) {
        return;
    }
    
    // Check if it was a tap (short duration, small movement)
    const touchDuration = Date.now() - touchStartTime;
    let moveDistance = 0;
    if (e.changedTouches[0]) {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        moveDistance = Math.sqrt(dx * dx + dy * dy);
    }
    
    if (touchDuration < 300 && moveDistance < 20) {
        // If video is muted and unmute hint is showing, tap anywhere to unmute
        var unmuteEl = document.getElementById('unmuteHint');
        if (video.muted && unmuteEl) {
            video.muted = false;
            var vs = document.getElementById('volumeSlider');
            if (vs) vs.value = 1;
            var vh = document.getElementById('volumeHigh');
            var vm = document.getElementById('volumeMuted');
            if (vh) vh.classList.remove('hidden');
            if (vm) vm.classList.add('hidden');
            unmuteEl.remove();
            return;
        }
        
        clearTimeout(touchTimeout);
        
        if (wrapper.classList.contains('touched')) {
            wrapper.classList.remove('touched');
        } else {
            wrapper.classList.add('touched');
            touchTimeout = setTimeout(() => wrapper.classList.remove('touched'), 5000);
        }
    }
}, { passive: true });

// ============================================
// Desktop Mouse Idle Detection
// ============================================
let mouseIdleTimeout;
let isMouseIdle = false;

function _setCursorIdle(hide) {
    var c = hide ? 'none' : '';
    document.body.style.cursor = c;
    document.documentElement.style.cursor = c;
    try { window.parent.postMessage({ type: hide ? 'CURSOR_HIDE' : 'CURSOR_SHOW' }, '*'); } catch(e) {}
}

// Only for non-touch devices
if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) {
    let _idleRaf = false;
    
    function _resetIdle(delayMs) {
        clearTimeout(mouseIdleTimeout);
        var wasIdle = isMouseIdle;
        if (isMouseIdle) {
            isMouseIdle = false;
            wrapper.classList.remove('mouse-idle');
            _setCursorIdle(false);
        }
        if (delayMs > 0) {
            wrapper.classList.add('controls-visible');
        }
        if (!video.paused && delayMs > 0) {
            mouseIdleTimeout = setTimeout(() => {
                isMouseIdle = true;
                wrapper.classList.add('mouse-idle');
                wrapper.classList.remove('controls-visible');
                clearTimeout(_fsControlsTimer);
                _setCursorIdle(true);
            }, delayMs);
        }
    }
    
    wrapper.addEventListener('mousemove', () => {
        if (_idleRaf) return;
        _idleRaf = true;
        requestAnimationFrame(() => {
            _idleRaf = false;
            _resetIdle(3000);
        });
    }, { passive: true });
    
    // Clicks (without mouse movement) must also reset idle state
    wrapper.addEventListener('mousedown', (e) => {
        _resetIdle(3500);
    }, { passive: true });
    
    // Clear idle state when mouse leaves
    wrapper.addEventListener('mouseleave', () => {
        _resetIdle(0);
    });
    
    // Clear idle state when video pauses
    video.addEventListener('pause', () => {
        _resetIdle(0);
    });
    
    // Reset idle (show controls) when video plays, then start 3.5s timer
    video.addEventListener('play', () => {
        _resetIdle(3500);
    });
}



// ============================================
// Volume
// ============================================
function updateVolumeUI() {
    const muted = video.muted || video.volume === 0;
    volumeHigh.classList.toggle('hidden', muted);
    volumeMuted.classList.toggle('hidden', !muted);
    const vol = video.muted ? 0 : video.volume;
    volumeSlider.value = vol;
    volumeSlider.style.setProperty('--volume-pct', (vol * 100) + '%');
}

muteBtn.addEventListener('click', () => { video.muted = !video.muted; updateVolumeUI(); try { parentStorage.setItem('playerMuted', video.muted ? '1' : '0'); } catch(e){} });
volumeSlider.addEventListener('input', () => {
    video.volume = volumeSlider.value;
    video.muted = false;
    volumeSlider.style.setProperty('--volume-pct', (volumeSlider.value * 100) + '%');
    try { parentStorage.setItem('playerVolume', volumeSlider.value); parentStorage.setItem('playerMuted', '0'); } catch(e){}
    updateVolumeUI();
});
video.addEventListener('volumechange', updateVolumeUI);
try {
    const savedVol = parentStorage.getItem('playerVolume');
    const savedMuted = parentStorage.getItem('playerMuted');
    if (savedVol !== null) { video.volume = parseFloat(savedVol); }
    if (savedMuted === '1') { video.muted = true; }
} catch(e){}
updateVolumeUI();
volumeSlider.style.setProperty('--volume-pct', ((video.muted ? 0 : video.volume) * 100) + '%');

// ============================================
// Progress Bar
// ============================================
function updateProgress() {
    const pct = (video.currentTime / video.duration) * 100 || 0;
    progressCurrent.style.width = pct + '%';
    progressHandle.style.left = pct + '%';
    currentTimeEl.textContent = formatTime(video.currentTime);
}

function updateBuffered() {
    if (video.buffered.length > 0) {
        const buffered = (video.buffered.end(video.buffered.length - 1) / video.duration) * 100;
        progressBuffered.style.width = buffered + '%';
    }
}

video.addEventListener('timeupdate', updateProgress);
video.addEventListener('progress', updateBuffered);
video.addEventListener('loadedmetadata', () => { durationEl.textContent = formatTime(video.duration); });

let isSeeking = false;
let seekPosition = 0;

function getSeekPosition(e) {
    const rect = progressContainer.getBoundingClientRect();
    let clientX = e.touches && e.touches[0] ? e.touches[0].clientX : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : e.clientX);
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

function updateSeekPreview(pct) {
    seekPosition = pct;
    const time = pct * video.duration;
    progressPreview.style.width = (pct * 100) + '%';
    
    if (state.thumbnailCues.length > 0) {
        showThumbnailAt(time, pct);
    } else {
        progressTooltip.textContent = formatTime(time);
        progressTooltip.style.left = (pct * 100) + '%';
    }
}

function startSeek(e) {
    e.preventDefault();
    isSeeking = true;
    progressContainer.classList.add('dragging');
    updateSeekPreview(getSeekPosition(e));
}

function moveSeek(e) {
    if (!isSeeking) return;
    e.preventDefault();
    updateSeekPreview(getSeekPosition(e));
}

function endSeek(e) {
    if (!isSeeking) return;
    e.preventDefault();
    isSeeking = false;
    progressContainer.classList.remove('dragging');
    video.currentTime = seekPosition * video.duration;
    progressPreview.style.width = '0%';
    thumbnailPreview.classList.remove('visible');
}

progressContainer.addEventListener('mousedown', startSeek);
document.addEventListener('mousemove', moveSeek);
document.addEventListener('mouseup', endSeek);
progressContainer.addEventListener('touchstart', startSeek, { passive: false });
document.addEventListener('touchmove', moveSeek, { passive: false });
document.addEventListener('touchend', endSeek, { passive: false });
document.addEventListener('touchcancel', endSeek, { passive: false });

let _progRaf = false;
progressContainer.addEventListener('mousemove', (e) => {
    if (isSeeking || _progRaf) return;
    _progRaf = true;
    requestAnimationFrame(() => {
        _progRaf = false;
        const rect = progressContainer.getBoundingClientRect();
        if (e.clientY < rect.top || e.clientY > rect.bottom) {
            thumbnailPreview.classList.remove('visible');
            return;
        }
        const pct = getSeekPosition(e);
        const time = pct * video.duration;
        if (state.thumbnailCues.length > 0) {
            showThumbnailAt(time, pct);
        } else {
            progressTooltip.textContent = formatTime(time);
            progressTooltip.style.left = (pct * 100) + '%';
        }
    });
}, { passive: true });

progressContainer.addEventListener('mouseleave', () => {
    if (!isSeeking) thumbnailPreview.classList.remove('visible');
});

// Hide thumbnail when cursor drifts above/below progress bar bounds.
// Needed because thumbnail is a child of progressContainer, so mouseleave
// doesn't fire when cursor moves onto the thumbnail (still "inside" parent).
wrapper.addEventListener('mousemove', (e) => {
    if (!thumbnailPreview.classList.contains('visible') || isSeeking) return;
    const rect = progressContainer.getBoundingClientRect();
    if (e.clientY < rect.top - 5 || e.clientY > rect.bottom + 5 ||
        e.clientX < rect.left || e.clientX > rect.right) {
        thumbnailPreview.classList.remove('visible');
    }
}, { passive: true });

// ============================================
// Thumbnails
// ============================================
async function loadThumbnails(url) {
    if (!url) return;
    try {
        state.thumbnailCues = [];
        const vttBaseUrl = url.substring(0, url.lastIndexOf('/') + 1);
        const vttOrigin = new URL(url).origin;
        const res = await fetch(url);
        const text = await res.text();
        parseThumbnailVTT(text, vttBaseUrl, vttOrigin);
        if (state.thumbnailCues.length > 0) {
            progressTooltip.classList.add('hidden');
        }
    } catch (e) {
        console.error('Failed to load thumbnails:', e);
    }
}

function parseThumbnailVTT(vtt, vttBaseUrl, vttOrigin) {
    const lines = vtt.split('\n');
    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();
        if (line.includes('-->')) {
            const parts = line.split('-->').map(s => s.trim());
            const start = parseTime(parts[0]);
            const end = parseTime(parts[1]);
            i++;
            if (i < lines.length) {
                const urlLine = lines[i].trim();
                if (urlLine) {
                    const cue = parseThumbnailUrl(urlLine, start, end, vttBaseUrl, vttOrigin);
                    if (cue) state.thumbnailCues.push(cue);
                }
            }
        }
        i++;
    }
}

function parseThumbnailUrl(urlLine, start, end, vttBaseUrl, vttOrigin) {
    const hashIdx = urlLine.indexOf('#xywh=');
    let rawUrl = hashIdx === -1 ? urlLine : urlLine.substring(0, hashIdx);
    
    if (rawUrl.startsWith('//')) {
        rawUrl = location.protocol + rawUrl;
    } else if (rawUrl.startsWith('/')) {
        rawUrl = vttOrigin + rawUrl;
    } else if (!rawUrl.startsWith('http')) {
        rawUrl = vttBaseUrl + rawUrl;
    }
    
    if (hashIdx === -1) {
        return { start: start, end: end, url: rawUrl, x: 0, y: 0, w: 160, h: 90 };
    }
    const coords = urlLine.substring(hashIdx + 6).split(',').map(Number);
    if (coords.length >= 4) {
        return {
            start: start, 
            end: end,
            url: rawUrl,
            x: coords[0], 
            y: coords[1], 
            w: coords[2], 
            h: coords[3]
        };
    }
    return null;
}

function showThumbnailAt(time, pct) {
    let cue = null;
    for (const c of state.thumbnailCues) {
        if (time >= c.start && time < c.end) { 
            cue = c; 
            break; 
        }
    }
    if (!cue) {
        thumbnailPreview.classList.remove('visible');
        return;
    }
    const containerRect = progressContainer.getBoundingClientRect();
    const halfWidth = cue.w / 2;
    let leftPos = pct * 100;
    const minPct = (halfWidth / containerRect.width) * 100;
    const maxPct = 100 - minPct;
    leftPos = Math.max(minPct, Math.min(maxPct, leftPos));
    
    thumbnailPreview.style.left = leftPos + '%';
    thumbnailPreview.style.width = cue.w + 'px';
    thumbnailPreview.style.height = (cue.h + 24) + 'px';
    thumbnailImage.style.width = cue.w + 'px';
    thumbnailImage.style.height = cue.h + 'px';
    thumbnailImage.style.backgroundImage = 'url(' + cue.url + ')';
    thumbnailImage.style.backgroundSize = 'auto';
    thumbnailImage.style.backgroundPosition = '-' + cue.x + 'px -' + cue.y + 'px';
    thumbnailImage.style.backgroundRepeat = 'no-repeat';
    thumbnailTime.textContent = formatTime(time);
    thumbnailPreview.classList.add('visible');
}

if (CONFIG.thumbnails) loadThumbnails(CONFIG.thumbnails);

// ============================================
// Fullscreen
// ============================================

// iOS fake fullscreen state (fallback if native doesn't work)
let isFakeFullscreen = false;
let _fsRequested = false;

function toggleFullscreen() {
    // iOS: Always use native video fullscreen
    if (isIOSDevice()) {
        tryVideoFullscreen();
        return;
    }
    
    // Non-iOS: Try standard Fullscreen API on wrapper
    if (document.fullscreenElement) {
        _fsRequested = false;
        document.exitFullscreen();
        return;
    } else if (document.webkitFullscreenElement) {
        _fsRequested = false;
        document.webkitExitFullscreen();
        return;
    }
    
    if (wrapper.requestFullscreen) {
        _fsRequested = true;
        wrapper.requestFullscreen().catch(err => {
            _log('Fullscreen API failed, trying video fullscreen:', err);
            _fsRequested = false;
            tryVideoFullscreen();
        });
        return;
    } else if (wrapper.webkitRequestFullscreen) {
        _fsRequested = true;
        wrapper.webkitRequestFullscreen();
        return;
    }
    
    tryVideoFullscreen();
}

function tryVideoFullscreen() {
    if (video.webkitSupportsFullscreen && video.webkitEnterFullscreen) {
        if (video.webkitDisplayingFullscreen) {
            video.webkitExitFullscreen();
        } else {
            if (isIOSDevice() && state.activeSubIdx >= 0 && !shouldUseIOSHlsProxy()) {
                _log('iOS: Preparing subtitle track for native fullscreen...');
                prepareTrackForIOSFullscreen();
            }
            
            video.webkitEnterFullscreen();
            
            video.addEventListener('webkitendfullscreen', () => {
                _log('iOS: Exited native fullscreen');
            }, { once: true });
        }
        return;
    }
    
    _log('Using fake fullscreen as last resort');
    toggleFakeFullscreen();
}

// Fake fullscreen for iOS - keeps DOM overlay visible
function toggleFakeFullscreen() {
    if (isFakeFullscreen) {
        exitFakeFullscreen();
    } else {
        enterFakeFullscreen();
    }
}

function enterFakeFullscreen() {
    _log('Entering fake fullscreen');
    isFakeFullscreen = true;
    wrapper.classList.add('fake-fullscreen');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    window.scrollTo(0, 0);
    
    enterFs.classList.add('hidden');
    exitFs.classList.remove('hidden');
    
    // Request landscape on mobile if available
    if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
    }
    
    // Ensure subtitles stay visible in fake fullscreen
    subtitles.classList.remove('sub-hidden');
    
    _log('Fake fullscreen active');
}

function exitFakeFullscreen() {
    _log('Exiting fake fullscreen');
    isFakeFullscreen = false;
    wrapper.classList.remove('fake-fullscreen');
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    
    enterFs.classList.remove('hidden');
    exitFs.classList.add('hidden');
    
    if (screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock();
    }
}

function _detectFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement || video.webkitDisplayingFullscreen || isFakeFullscreen) return true;
    if (_fsRequested) {
        var ww = window.innerWidth || document.documentElement.clientWidth;
        var wh = window.innerHeight || document.documentElement.clientHeight;
        if (ww >= screen.width - 1 && wh >= screen.height - 1) return true;
    }
    return false;
}

var _fsControlsTimer = null;
function updateFullscreenUI() {
    const isFs = _detectFullscreen();
    if (!isFs) _fsRequested = false;
    enterFs.classList.toggle('hidden', isFs);
    exitFs.classList.toggle('hidden', !isFs);
    wrapper.classList.toggle('is-fullscreen', isFs);
    
    // Keep controls visible during fullscreen transition.
    // Browsers reset :hover on fullscreen enter, causing controls to vanish instantly.
    clearTimeout(_fsControlsTimer);
    if (isFs) {
        wrapper.classList.add('controls-visible');
        _fsControlsTimer = setTimeout(function() {
            wrapper.classList.remove('controls-visible');
        }, 3500);
    } else {
        wrapper.classList.remove('controls-visible');
    }
    
    // Reset touch state on fullscreen change (only for touch devices)
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        clearTimeout(touchTimeout);
        wrapper.classList.remove('touched');
    }
}

// ============================================
// iOS Subtitle Helpers
// ============================================

// isIOSDevice() is defined at the top of the file

// Helper: Get the actual textTracks index for a subtitle entry
// CRITICAL: Always use this instead of assuming array positions
// iOS can reorder tracks, so video.textTracks.length-1 is WRONG
function getTrackIndexForSubtitle(sub) {
    if (!sub || !sub.track) return -1;
    const trackElements = Array.from(video.querySelectorAll('track'));
    return trackElements.indexOf(sub.track);
}

// Get or create a server VTT URL
// iOS REQUIRES server URLs for native fullscreen, data URLs don't work
async function getOrCreateVttUrlForIOS(vttContent, meta = {}) {
    try {
        const formData = new FormData();
        formData.append('action', 'cache_vtt');
        formData.append('vtt', vttContent);
        formData.append('filename', meta.filename || 'subtitle.vtt');
        formData.append('imdb', meta.imdb || CONFIG.mediaId || '');
        formData.append('lang', meta.lang || 'en');
        
        const response = await fetch(API_BASE + '/cache.php', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.vtt_url) {
                let vttUrl = data.vtt_url;
                // MUST be absolute URL for iOS
                if (vttUrl.startsWith('/')) {
                    vttUrl = window.location.origin + vttUrl;
                }
                return vttUrl;
            }
        }
    } catch (e) {
        console.warn('Failed to create VTT URL:', e);
    }
    return null;
}

// Enable a track at specific index, hide all others
// Uses DOM-resolved index, not state index
function enableTrackAtIndex(trackIdx) {
    const tracks = video.textTracks;
    const trackElements = video.querySelectorAll('track');
    
    // Clear all defaults first
    trackElements.forEach(t => t.default = false);
    
    // iOS: 'showing' needed for native fullscreen subtitle rendering
    // Desktop/Android: 'hidden' — custom overlay handles rendering.
    // 'showing' on desktop causes native ::cue to render, which Chrome
    // hides/shows with controls in fullscreen (the bug).
    const activeMode = isIOSDevice() ? 'showing' : 'hidden';
    for (let i = 0; i < tracks.length; i++) {
        tracks[i].mode = (i === trackIdx) ? activeMode : 'hidden';
    }
    
    // Set default on active track element
    if (trackElements[trackIdx]) {
        trackElements[trackIdx].default = true;
    }
}

// Replace a subtitle track element on iOS
// iOS doesn't recognize src changes on existing tracks during playback
// Must remove old track and create new one
async function replaceSubtitleTrackIOS(sub, newVttUrl) {
    if (!sub || !sub.track) return false;
    
    const wasActive = (state.subtitles[state.activeSubIdx] === sub);
    const oldTrack = sub.track;
    
    // Remove old track from DOM
    if (oldTrack.parentNode) {
        oldTrack.parentNode.removeChild(oldTrack);
    }
    
    // Create new track element
    const newTrack = document.createElement('track');
    newTrack.kind = 'subtitles';
    newTrack.label = sub.langName || sub.label;
    newTrack.srclang = sub.langCode || 'en';
    newTrack.src = newVttUrl;
    
    if (wasActive) {
        newTrack.default = true;
    }
    
    // Append new track
    video.appendChild(newTrack);
    
    // Update references
    sub.track = newTrack;
    sub.cachedVttUrl = newVttUrl;
    
    // Wait for track to be recognized
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Get new TextTrack reference
    const newTrackIdx = getTrackIndexForSubtitle(sub);
    if (newTrackIdx >= 0) {
        sub.textTrack = video.textTracks[newTrackIdx];
        
        // Re-enable if it was active
        if (wasActive) {
            enableTrackAtIndex(newTrackIdx);
        }
    }
    
    _log('iOS: Track replaced:', sub.label, 'newIdx:', newTrackIdx);
    return true;
}

// Prepare active subtitle track for iOS fullscreen
// PlayerJS approach: Remove all tracks and re-add the active one with proper attributes
function prepareTrackForIOSFullscreen() {
    if (state.activeSubIdx < 0 || !state.subtitles[state.activeSubIdx]) {
        _log('iOS Fullscreen: No active subtitle');
        return;
    }
    
    const sub = state.subtitles[state.activeSubIdx];
    
    // Get the VTT URL - must be a server URL, not data URL
    let vttUrl = sub.cachedVttUrl;
    if (!vttUrl || vttUrl.startsWith('data:')) {
        console.warn('iOS Fullscreen: No server VTT URL available');
        return;
    }
    
    // Ensure absolute URL
    if (vttUrl.startsWith('/')) {
        vttUrl = window.location.origin + vttUrl;
    }
    
    _log('iOS Fullscreen: Preparing track with URL:', vttUrl);
    
    // PlayerJS approach: Remove ALL existing tracks first
    const existingTracks = video.querySelectorAll('track');
    existingTracks.forEach(t => {
        video.removeChild(t);
    });
    _log('iOS Fullscreen: Removed', existingTracks.length, 'existing tracks');
    
    // Create fresh track with setAttribute (PlayerJS style)
    const track = document.createElement('track');
    track.setAttribute('src', vttUrl);
    track.setAttribute('label', sub.langName || sub.label || 'English');
    track.setAttribute('kind', 'subtitles');
    track.setAttribute('srclang', sub.langCode || 'en');
    track.setAttribute('default', '');  // Mark as default
    
    // Add to video
    video.appendChild(track);
    
    // Update subtitle entry reference
    sub.track = track;
    
    // Set mode to showing on the TextTrack
    // Need to wait a tick for textTracks to update
    const textTrack = video.textTracks[0];
    if (textTrack) {
        textTrack.mode = 'showing';
        _log('iOS Fullscreen: Track ready, mode:', textTrack.mode, 'cues:', textTrack.cues?.length || 0);
    }
    
    // Listen for track load
    track.addEventListener('load', () => {
        _log('iOS Fullscreen: Track loaded successfully');
        if (video.textTracks[0]) {
            video.textTracks[0].mode = 'showing';
        }
    });
}

// Show pre-fullscreen toast on iOS
function showIOSPreFullscreenToast() {
    if (!isIOSDevice()) return;
    if (state.activeSubIdx < 0) return;
    
    // Only show once per page load
    if (window._iosToastShown) return;
    window._iosToastShown = true;
    
    const toast = document.createElement('div');
    toast.className = 'ios-prefullscreen-toast';
    toast.innerHTML = 'In fullscreen, tap <b>⋯</b> → <b>Subtitles</b> → <b>' + 
        (state.subtitles[state.activeSubIdx].langName || 'English') + '</b>';
    wrapper.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// iOS Fullscreen Event Handlers
// ============================================

video.addEventListener('webkitbeginfullscreen', () => {
    _log('iOS fullscreen started');
    state.isIOSFullscreen = true;
    
    // Custom subtitle overlay is already hidden by updateSubtitleDisplay()
    // Native text tracks will render automatically in fullscreen
    
    // Re-assert track state (handles fullscreen triggered by external means)
    // Note: This is after fullscreen started, so it may not work
    // The prepareTrackForIOSFullscreen() call before fullscreen is more important
    if (state.activeSubIdx >= 0 && state.subtitles[state.activeSubIdx]) {
        const sub = state.subtitles[state.activeSubIdx];
        const trackIdx = getTrackIndexForSubtitle(sub);
        
        if (trackIdx >= 0) {
            sub.track.default = true;
            video.textTracks[trackIdx].mode = 'showing';
            _log('iOS fullscreen: Track re-asserted, trackIdx:', trackIdx);
        }
    }
});

video.addEventListener('webkitendfullscreen', () => {
    _log('iOS fullscreen ended');
    state.isIOSFullscreen = false;
    
    // Tracks stay 'showing' on iOS (needed for next fullscreen entry).
    // Custom overlay resumes rendering outside fullscreen via updateSubtitleDisplay().
    updateSubtitleDisplay();
});

// ============================================
// Fullscreen Button Handlers
// Single handler for each - no duplicates
// ============================================

fullscreenBtn.addEventListener('click', (e) => {
    e.preventDefault();
    
    if (isIOSDevice()) {
        _log('iOS fullscreen requested');
        _log('  activeSubIdx:', state.activeSubIdx);
        _log('  shouldUseIOSHlsProxy:', shouldUseIOSHlsProxy());
        
        // HLS PROXY METHOD: Ensure video is loaded with proxied URL before fullscreen
        if (shouldUseIOSHlsProxy() && state.activeSubIdx >= 0) {
            const currentSrc = video.src || video.currentSrc || '';
            const isProxied = currentSrc.includes('hls-proxy.php') && currentSrc.includes('subs=');
            
            if (!isProxied) {
                _log('iOS: Reloading with proxy before fullscreen...');
                showToast('Loading subtitles...', 2000);
                reloadWithEmbeddedSubtitles();
                
                const waitForReload = () => {
                    if ((video.src || video.currentSrc || '').includes('hls-proxy.php')) {
                        _log('iOS: Proxy reload complete, entering fullscreen');
                        setTimeout(() => toggleFullscreen(), 100);
                    } else {
                        setTimeout(waitForReload, 50);
                    }
                };
                setTimeout(waitForReload, 100);
                return;
            }
        }
        
        // For track-based method (fallback), prepare track before fullscreen
        if (!shouldUseIOSHlsProxy() && state.activeSubIdx >= 0) {
            _log('iOS: Using track element method (fallback)');
            showIOSPreFullscreenToast();
            prepareTrackForIOSFullscreen();
        }
    }
    
    toggleFullscreen();
});

document.addEventListener('fullscreenchange', updateFullscreenUI);
document.addEventListener('webkitfullscreenchange', updateFullscreenUI);
window.addEventListener('resize', updateFullscreenUI);

video.addEventListener('dblclick', (e) => {
    e.preventDefault();
    
    if (isIOSDevice()) {
        if (shouldUseIOSHlsProxy() && state.activeSubIdx >= 0) {
            const currentSrc = video.src || video.currentSrc || '';
            const isProxied = currentSrc.includes('hls-proxy.php') && currentSrc.includes('subs=');
            
            if (!isProxied) {
                _log('iOS dblclick: Reloading with proxy before fullscreen...');
                reloadWithEmbeddedSubtitles();
                setTimeout(() => toggleFullscreen(), 150);
                return;
            }
        }
        
        if (!shouldUseIOSHlsProxy() && state.activeSubIdx >= 0) {
            prepareTrackForIOSFullscreen();
        }
    }
    
    toggleFullscreen();
});

// ============================================
// PiP
// ============================================
if (pipBtn) {
    pipBtn.addEventListener('click', async () => {
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                await video.requestPictureInPicture();
            }
        } catch (e) {
            console.error('PiP error:', e);
        }
    });
}

// ============================================
// Chromecast
// ============================================
let castSession = null;

window['__onGCastApiAvailable'] = function(isAvailable) {
    if (isAvailable && castBtn && typeof cast !== 'undefined' && cast.framework) {
        try {
            const castContext = cast.framework.CastContext.getInstance();
            castContext.setOptions({
                receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
                autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
            });
            castBtn.style.display = 'flex';
            
            castContext.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, (event) => {
                if (event.sessionState === cast.framework.SessionState.SESSION_STARTED ||
                    event.sessionState === cast.framework.SessionState.SESSION_RESUMED) {
                    castSession = castContext.getCurrentSession();
                    castBtn.classList.add('active');
                    castingOverlay.classList.add('active');
                    castingDevice.textContent = castSession.getCastDevice().friendlyName || 'Device';
                    
                    if (state.allStreams.length > 0) {
                        const mediaInfo = new chrome.cast.media.MediaInfo(state.allStreams[0], 'application/x-mpegurl');
                        
                        // Add subtitle tracks for Chromecast
                        if (state.subtitles.length > 0) {
                            const tracks = [];
                            state.subtitles.forEach((sub, idx) => {
                                if (sub.cachedVttUrl) {
                                    const track = new chrome.cast.media.Track(idx, chrome.cast.media.TrackType.TEXT);
                                    track.trackContentId = sub.cachedVttUrl;
                                    track.trackContentType = 'text/vtt';
                                    track.subtype = chrome.cast.media.TextTrackType.SUBTITLES;
                                    track.name = sub.langName || sub.label;
                                    track.language = sub.langCode || 'en';
                                    tracks.push(track);
                                }
                            });
                            
                            if (tracks.length > 0) {
                                mediaInfo.tracks = tracks;
                            }
                        }
                        
                        const request = new chrome.cast.media.LoadRequest(mediaInfo);
                        request.currentTime = video.currentTime;
                        
                        // Enable active subtitle track on cast
                        if (state.activeSubIdx >= 0 && state.activeSubIdx < state.subtitles.length) {
                            request.activeTrackIds = [state.activeSubIdx];
                        }
                        
                        castSession.loadMedia(request);
                    }
                    video.pause();
                } else if (event.sessionState === cast.framework.SessionState.SESSION_ENDED) {
                    castSession = null;
                    castBtn.classList.remove('active');
                    castingOverlay.classList.remove('active');
                }
            });
        } catch (e) {
            console.warn('Cast init skipped:', e.message);
        }
    }
};

// Fallback: Show cast button on Android even if Chromecast SDK not loaded
if (castBtn && isAndroidDevice()) {
    castBtn.style.display = 'flex';
}

if (castBtn) {
    castBtn.addEventListener('click', () => {
        if (typeof cast === 'undefined' || !cast.framework) {
            _log('Chromecast SDK not loaded');
            return;
        }
        const castContext = cast.framework.CastContext.getInstance();
        if (castSession) {
            castSession.endSession(true);
        } else {
            castContext.requestSession().catch(() => {});
        }
    });
}

// ============================================
// AirPlay
// ============================================
if (airplayBtn && window.WebKitPlaybackTargetAvailabilityEvent) {
    // Always show AirPlay button on iOS
    if (isIOSDevice()) {
        airplayBtn.style.display = 'flex';
    } else {
        video.addEventListener('webkitplaybacktargetavailabilitychanged', (e) => {
            airplayBtn.style.display = e.availability === 'available' ? 'flex' : 'none';
        });
    }
    airplayBtn.addEventListener('click', () => video.webkitShowPlaybackTargetPicker());
} else if (isIOSDevice() && airplayBtn) {
    // Fallback: Show AirPlay even if event not supported
    airplayBtn.style.display = 'flex';
}

// ============================================
// Keyboard Shortcuts
// ============================================
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    
    switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
            e.preventDefault();
            tryPlay();
            break;
        case 'f':
            toggleFullscreen();
            break;
        case 'm':
            video.muted = !video.muted;
            break;
        case 'arrowleft':
            e.preventDefault();
            seekBy(-10);
            break;
        case 'arrowright':
            e.preventDefault();
            seekBy(10);
            break;
        case 'arrowup':
            e.preventDefault();
            video.volume = Math.min(1, video.volume + 0.1);
            break;
        case 'arrowdown':
            e.preventDefault();
            video.volume = Math.max(0, video.volume - 0.1);
            break;
    }
});

// ============================================
// Menus
// ============================================
function closeAllMenus() {
    ccMenu.classList.remove('open');
    settingsMenu.classList.remove('open');
    const srcMenu = $id('sourceMenu');
    if (srcMenu) srcMenu.style.display = 'none';
}

ccBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenu.classList.remove('open');
    ccMenu.classList.toggle('open');
});

settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ccMenu.classList.remove('open');
    settingsMenu.classList.toggle('open');
    showSettingsMain();
});

$id('ccMenuClose').addEventListener('click', () => ccMenu.classList.remove('open'));
$id('settingsMenuClose').addEventListener('click', () => settingsMenu.classList.remove('open'));

document.addEventListener('click', (e) => {
    if (!ccMenu.contains(e.target) && e.target !== ccBtn) ccMenu.classList.remove('open');
    if (!settingsMenu.contains(e.target) && e.target !== settingsBtn) settingsMenu.classList.remove('open');
});

document.querySelectorAll('.menu-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const parent = tab.closest('.menu');
        parent.querySelectorAll('.menu-tab').forEach(t => t.classList.remove('active'));
        parent.querySelectorAll('.menu-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        $id(tab.dataset.tab + 'Panel').classList.add('active');
    });
});

function showSettingsMain() {
    settingsContent.classList.remove('hidden');
    qualityMenu.classList.add('hidden');
    speedMenu.classList.add('hidden');
}

$id('qualityItem').addEventListener('click', () => {
    settingsContent.classList.add('hidden');
    qualityMenu.classList.remove('hidden');
});

$id('speedItem').addEventListener('click', () => {
    settingsContent.classList.add('hidden');
    speedMenu.classList.remove('hidden');
});

$id('qualityBack').addEventListener('click', showSettingsMain);
$id('speedBack').addEventListener('click', showSettingsMain);

// Map actual pixel width to standard quality label (rounded to nearest)
function getQualityLabel(level) {
    const width = level.width || 0;
    
    // Standard widths: 3840 (4K), 2560 (1440p), 1920 (1080p), 1280 (720p), 854 (480p), 640 (360p), 426 (240p)
    const standards = [
        { w: 3840, label: '4K' },
        { w: 2560, label: '1440p' },
        { w: 1920, label: '1080p' },
        { w: 1280, label: '720p' },
        { w: 854, label: '480p' },
        { w: 640, label: '360p' },
        { w: 426, label: '240p' }
    ];
    
    // Find the closest standard width
    let closest = standards[standards.length - 1]; // default to lowest
    let minDiff = Math.abs(width - closest.w);
    
    for (const std of standards) {
        const diff = Math.abs(width - std.w);
        if (diff < minDiff) {
            minDiff = diff;
            closest = std;
        }
    }
    
    return closest.label;
}

function buildQualityMenu() {
    const list = $id('qualityList');
    let html = '<div class="menu-item active" data-quality="-1"><div class="menu-item-radio"></div><span class="menu-item-label">Auto</span></div>';
    
    // Create array with original indices and sort by width descending
    const sortedQualities = state.qualities
        .map((q, i) => ({ quality: q, index: i }))
        .sort((a, b) => (b.quality.width || 0) - (a.quality.width || 0));
    
    sortedQualities.forEach(({ quality, index }) => {
        const label = getQualityLabel(quality);
        html += '<div class="menu-item" data-quality="' + index + '"><div class="menu-item-radio"></div><span class="menu-item-label">' + label + '</span></div>';
    });
    
    list.innerHTML = html;
    
    list.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const q = parseInt(item.dataset.quality);
            if (state.hls) state.hls.currentLevel = q;
            list.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            $id('currentQuality').textContent = q === -1 ? 'Auto' : getQualityLabel(state.qualities[q]);
            showSettingsMain();
        });
    });
}

const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const speedList = $id('speedList');
const savedSpeed = (function() { try { const v = parentStorage.getItem('playerSpeed'); return v ? parseFloat(v) : 1; } catch(e) { return 1; } })();
speedList.innerHTML = speeds.map(s => 
    '<div class="menu-item ' + (s === savedSpeed ? 'active' : '') + '" data-speed="' + s + '"><div class="menu-item-radio"></div><span class="menu-item-label">' + (s === 1 ? 'Normal' : s + 'x') + '</span></div>'
).join('');
if (savedSpeed !== 1) { video.playbackRate = savedSpeed; $id('currentSpeed').textContent = savedSpeed + 'x'; }

speedList.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => {
        const s = parseFloat(item.dataset.speed);
        video.playbackRate = s;
        speedList.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        $id('currentSpeed').textContent = s === 1 ? '1x' : s + 'x';
        try { parentStorage.setItem('playerSpeed', s); } catch(e){}
        showSettingsMain();
    });
});

// ============================================
// Subtitles
// ============================================
function srtToVtt(srt) {
    let vtt = 'WEBVTT\n\n';
    srt.replace(/\r\n/g, '\n').split('\n').forEach(line => {
        if (/^\d+$/.test(line.trim())) return;
        if (line.includes('-->')) {
            line = line.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
        }
        vtt += line + '\n';
    });
    return vtt;
}

function parseVTT(vtt) {
    const cues = [];
    const lines = vtt.split('\n');
    let i = 0;
    
    while (i < lines.length) {
        const line = lines[i].trim();
        if (line.includes('-->')) {
            const parts = line.split('-->').map(s => s.trim());
            const start = parseTime(parts[0]);
            const end = parseTime(parts[1]);
            let text = '';
            i++;
            while (i < lines.length && lines[i].trim() !== '') {
                text += lines[i] + '\n';
                i++;
            }
            cues.push({ start: start, end: end, text: text.trim() });
        }
        i++;
    }
    return cues;
}

async function addSubtitle(label, cues, isDefault, langName, langCode, downloadLink, cachedVttUrl) {
    if (isDefault === undefined) isDefault = false;
    if (langName === undefined) langName = '';
    if (langCode === undefined) langCode = 'en';
    if (downloadLink === undefined) downloadLink = null;
    if (cachedVttUrl === undefined) cachedVttUrl = null;
    
    // Check for duplicates first
    const existingIdx = state.subtitles.findIndex(s => 
        s.label === label || 
        (downloadLink && s.downloadLink === downloadLink)
    );
    
    if (existingIdx >= 0) {
        _log('Subtitle already exists, activating:', label);
        setActiveSubtitle(existingIdx);
        return;
    }
    
    // Store original cues and apply current offset
    const originalCues = cues.map(cue => ({ ...cue }));
    const offsetCues = cues.map(cue => ({
        start: cue.start + subtitleOffset,
        end: cue.end + subtitleOffset,
        text: cue.text
    }));
    
    const vttContent = cuesToVTT(offsetCues);
    const isiOS = isIOSDevice();
    
    // For iOS: ALWAYS use server URL (data URLs don't work in native fullscreen)
    if (isiOS && !cachedVttUrl) {
        cachedVttUrl = await getOrCreateVttUrlForIOS(vttContent, {
            filename: label,
            imdb: CONFIG.mediaId,
            lang: langCode
        });
    }
    
    // PlayerJS-style track creation for iOS compatibility
    // Key: Use setAttribute instead of property assignment
    const track = document.createElement('track');
    track.setAttribute('kind', 'subtitles');
    track.setAttribute('label', langName || label);
    track.setAttribute('srclang', langCode || 'en');
    
    if (cachedVttUrl) {
        // Ensure absolute URL for iOS
        if (cachedVttUrl.startsWith('/')) {
            cachedVttUrl = window.location.origin + cachedVttUrl;
        }
        track.setAttribute('src', cachedVttUrl);
        _log('Using server VTT URL:', cachedVttUrl);
    } else {
        track.setAttribute('src', createVTTDataUrl(vttContent));
        console.warn('iOS: Using data URL (may not work in fullscreen)');
    }
    
    // Append track to video
    video.appendChild(track);
    
    // Wait for track to load (critical for iOS)
    await new Promise(resolve => {
        let resolved = false;
        const done = () => {
            if (!resolved) {
                resolved = true;
                resolve();
            }
        };
        track.addEventListener('load', done, { once: true });
track.addEventListener('error', function(e) {
    // Silently ignore subtitle errors
    _log('Subtitle load failed (non-critical)');
}, { once: true });
        // Timeout fallback
        setTimeout(done, 2000);
    });
    
    // IMPORTANT: Get TextTrack by DOM index, NOT by array length
    // iOS can reorder tracks, so video.textTracks.length-1 is WRONG
    const trackIdx = getTrackIndexForSubtitle({ track: track });
    const textTrack = trackIdx >= 0 ? video.textTracks[trackIdx] : null;
    
    if (textTrack) {
        // On iOS with native HLS: Start in 'hidden' but will be set to 'showing' when activated
        // This ensures cues load properly
        textTrack.mode = 'hidden';
    }
    
    const subEntry = { 
        label: label, 
        cues: offsetCues, 
        originalCues: originalCues,
        track: track,
        textTrack: textTrack,
        vttContent: vttContent,
        langName: langName,
        langCode: langCode,
        downloadLink: downloadLink,
        cachedVttUrl: cachedVttUrl
    };
    
    state.subtitles.push(subEntry);
    
    _log('Subtitle added:', label, 'trackIdx:', trackIdx, 'total tracks:', video.textTracks.length);
    _log('  cachedVttUrl:', cachedVttUrl);
    _log('  track.src:', track.src?.substring(0, 100));
    
    // Send VTT URL to parent (for iOS tester)
    if (window.parent !== window && cachedVttUrl) {
        window.parent.postMessage({ type: 'VTT_URL', url: cachedVttUrl, label: label }, '*');
    }
    
    renderSubList();
    
    if (isDefault || state.subtitles.length === 1) {
        setActiveSubtitle(state.subtitles.length - 1);
    }
}

function cuesToVTT(cues) {
    // iOS is very strict about VTT format
    let vtt = 'WEBVTT\n\n';
    cues.forEach((cue, i) => {
        // Cue identifier (optional but helps)
        vtt += (i + 1) + '\n';
        // Timestamp line - iOS needs exact format
        vtt += formatVTTTime(cue.start) + ' --> ' + formatVTTTime(cue.end) + '\n';
        // Text - strip any HTML except basic tags, ensure no null characters
        let text = (cue.text || '').replace(/\0/g, '').trim();
        vtt += text + '\n\n';
    });
    return vtt;
}

function formatVTTTime(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
}

// Create base64 encoded VTT data URL (better iOS compatibility)
function createVTTDataUrl(vttContent) {
    try {
        // Use base64 encoding for iOS
        return 'data:text/vtt;base64,' + btoa(unescape(encodeURIComponent(vttContent)));
    } catch (e) {
        // Fallback to URI encoding
        return 'data:text/vtt;charset=utf-8,' + encodeURIComponent(vttContent);
    }
}

var _langMap2to3 = {
    ar:'ara',zh:'chi',cs:'cze',da:'dan',nl:'dut',en:'eng',et:'est',fi:'fin',
    fr:'fre',de:'ger',el:'ell',he:'heb',hi:'hin',hu:'hun',is:'ice',id:'ind',
    it:'ita',ja:'jpn',ko:'kor',lv:'lav',lt:'lit',ms:'may',no:'nor',fa:'per',
    pl:'pol',pt:'por',ro:'rum',ru:'rus',sk:'slo',sl:'slv',es:'spa',sv:'swe',
    th:'tha',tr:'tur',uk:'ukr',vi:'vie',sr:'scc',bg:'bul',hr:'hrv',ka:'geo'
};
var _langMap3to2 = {};
for (var _k in _langMap2to3) _langMap3to2[_langMap2to3[_k]] = _k;

function setActiveSubtitle(idx) {
    _log('=== setActiveSubtitle called ===', { 
        idx, 
        isIOS: isIOSDevice(),
        isTouchDevice: isTouchDevice(),
        usingHlsJs: !!state.hls,
        willUseNativeRendering: isTouchDevice()
    });
    
    state.activeSubIdx = idx;
    state.currentCues = idx >= 0 ? state.subtitles[idx].cues : [];
    ccBtn.classList.toggle('active', idx >= 0);
    
    const tracks = video.textTracks;
    const trackElements = video.querySelectorAll('track');
    
    // Clear all default attributes first
    trackElements.forEach(t => t.default = false);
    
    // Hide all tracks first
    for (let i = 0; i < tracks.length; i++) {
        tracks[i].mode = 'hidden';
    }
    
    // Enable selected track
    if (idx >= 0 && state.subtitles[idx]) {
        const sub = state.subtitles[idx];
        const trackIdx = getTrackIndexForSubtitle(sub);
        
        _log('Activating subtitle:', { 
            idx, 
            label: sub.label, 
            trackIdx,
            cachedVttUrl: sub.cachedVttUrl,
            trackSrc: sub.track ? sub.track.src : 'no track element'
        });
        
        if (trackIdx >= 0 && tracks[trackIdx]) {
            // Set default attribute
            sub.track.default = true;
            
            // iOS: Set to 'showing' — required for native fullscreen subtitle rendering.
            // The custom overlay handles display outside fullscreen via updateSubtitleDisplay().
            // Non-iOS: Keep 'hidden' — custom overlay renders everything.
            if (isIOSDevice()) {
                tracks[trackIdx].mode = 'showing';
                _log('🍎 iOS: Track set to showing (needed for native fullscreen)');
            } else {
                tracks[trackIdx].mode = 'hidden';
            }
            
            // Update stored textTrack reference
            sub.textTrack = tracks[trackIdx];
            
            _log('✅ Subtitle activated:', sub.label, 'trackIdx:', trackIdx, 'mode:', tracks[trackIdx].mode);
            
            if (isIOSDevice()) {
                _log('🍎 iOS: Track element active. Proxy will activate on fullscreen.');
                _log('🍎 iOS Debug Info:', {
                    'API_BASE': API_BASE,
                    'Track src': sub.track.src,
                    'Cached VTT URL': sub.cachedVttUrl,
                    'Should use proxy': shouldUseIOSHlsProxy(),
                    'Current video URL': state.currentVideoUrl
                });
            }
        }
    } else {
        // Subtitle turned off
        // Only reload if we're currently using a proxied URL (in fullscreen mode)
        if (isIOSDevice() && video.src && video.src.includes('hls-proxy.php')) {
            _log('iOS: Reloading HLS without subtitles (was using proxy)');
            // Reload with original HLS URL (no subtitle injection)
            const currentTime = video.currentTime;
            const wasPlaying = !video.paused;
            
            video.src = state.currentVideoUrl;
            video.load();
            video.addEventListener('loadedmetadata', function onLoaded() {
                video.removeEventListener('loadedmetadata', onLoaded);
                video.currentTime = currentTime;
                if (wasPlaying) {
                    video.play().catch(e => _log('Play prevented:', e));
                }
            });
        } else {
            _log('iOS: Subtitle turned off (track mode set to hidden)');
        }
    }
    
    if (idx >= 0 && state.subtitles[idx] && state.subtitles[idx].langCode) {
        var code2 = state.subtitles[idx].langCode;
        parentStorage.setItem('lastSubLang', code2);
        var code3 = _langMap2to3[code2];
        if (code3 && langSelect && langSelect.querySelector('option[value="' + code3 + '"]')) {
            langSelect.value = code3;
            parentStorage.setItem('subtitleLang', code3);
        }
    }
    
    renderSubList();
    updateSubtitleDisplay();
}

function renderSubList() {
    let html = '<div class="menu-item ' + (state.activeSubIdx === -1 ? 'active' : '') + '" data-idx="-1"><div class="menu-item-radio"></div><span class="menu-item-label">Off</span></div>';
    
    state.subtitles.forEach((sub, i) => {
        let labelHtml = '';
        if (sub.langName && sub.langName !== sub.label) {
            labelHtml = '<span class="menu-item-label"><span class="sub-lang">' + sub.langName + '</span><span class="sub-filename">' + sub.label + '</span></span>';
        } else {
            labelHtml = '<span class="menu-item-label">' + (sub.langName || sub.label) + '</span>';
        }
        html += '<div class="menu-item ' + (state.activeSubIdx === i ? 'active' : '') + '" data-idx="' + i + '"><div class="menu-item-radio"></div>' + labelHtml + '<span class="menu-item-remove" data-remove="' + i + '">✕</span></div>';
    });
    
    subList.innerHTML = html;
    
   subList.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
        if (e.target.classList.contains('menu-item-remove')) {
            removeSubtitle(parseInt(e.target.dataset.remove));
        } else {
            // Create loading overlay
            const subList = document.getElementById('subList');
            
            let overlay = document.getElementById('subtitleLoadingOverlay');
            if (!overlay && subList) {
                overlay = document.createElement('div');
                overlay.className = 'search-loading-overlay';
                overlay.id = 'subtitleLoadingOverlay';
                overlay.innerHTML = `
                    <div class="search-loading-spinner"></div>
                    <div class="search-loading-text">Loading subtitle...</div>
                `;
                subList.appendChild(overlay);
                setTimeout(() => overlay.classList.add('visible'), 10);
            } else if (overlay) {
                overlay.classList.add('visible');
            }
            
            setActiveSubtitle(parseInt(item.dataset.idx));
            
            setTimeout(() => {
                if (overlay) overlay.classList.remove('visible');
            }, 400);
        }
    });
});
}

function removeSubtitle(idx) {
    const sub = state.subtitles[idx];
    if (sub.track && sub.track.parentNode) sub.track.parentNode.removeChild(sub.track);
    if (sub.blobUrl) URL.revokeObjectURL(sub.blobUrl);
    
    state.subtitles.splice(idx, 1);
    
    if (state.activeSubIdx === idx) {
        setActiveSubtitle(-1);
    } else if (state.activeSubIdx > idx) {
        state.activeSubIdx--;
    }
    renderSubList();
}

function clearAllSubtitles() {
    while (state.subtitles.length > 0) {
        const sub = state.subtitles.pop();
        if (sub.track && sub.track.parentNode) sub.track.parentNode.removeChild(sub.track);
        if (sub.blobUrl) URL.revokeObjectURL(sub.blobUrl);
    }
    state.activeSubIdx = -1;
    state.currentCues = [];
    state.searchResults = [];
    state._loadedDefaultSubs = {};
    subtitleText.textContent = '';
    
    subtitleOffset = 0;
    const syncInput = $id('syncOffset');
    if (syncInput) syncInput.value = 0;
    
    renderSubList();
    renderDefaultSubsList();
}

function updateSubtitleDisplay() {
    // On iOS using native HLS, skip custom overlay entirely — native text tracks render
    if (isIOSDevice() && !state.hls) {
        subtitles.classList.add('sub-hidden');
        return;
    }
    
    // For iOS fullscreen (even with HLS.js), hide custom overlay
    if (state.isIOSFullscreen) {
        subtitles.classList.add('sub-hidden');
        return;
    }
    
    // Android and Desktop: Use custom overlay
    const t = video.currentTime;
    let text = '';
    
    for (const cue of state.currentCues) {
        if (t >= cue.start && t <= cue.end) {
            text = cue.text;
            break;
        }
    }
    
    subtitleText.innerHTML = text.replace(/\n/g, '<br>');
    if (text) {
        subtitles.classList.remove('sub-hidden');
        subtitles.style.setProperty('opacity', '1', 'important');
        subtitles.style.setProperty('visibility', 'visible', 'important');
    } else {
        subtitles.classList.add('sub-hidden');
        subtitles.style.removeProperty('opacity');
        subtitles.style.removeProperty('visibility');
    }
    
}

video.addEventListener('timeupdate', updateSubtitleDisplay);

$id('subFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (ev) => {
        let content = ev.target.result;
        if (file.name.toLowerCase().endsWith('.srt')) {
            content = srtToVtt(content);
        }
        const cues = parseVTT(content);
        addSubtitle(file.name, cues);
    };
    reader.readAsText(file);
    e.target.value = '';
});

async function loadExternalSubtitle() {
    if (!CONFIG.externalSub.file) return;
    var subUrl = CONFIG.externalSub.file;
    try {
        var res = await fetch(subUrl);
        if (!res.ok) throw new Error('Direct fetch failed: ' + res.status);
        var text = await res.text();
        if (!text.trim().startsWith('WEBVTT')) text = srtToVtt(text);
        var cues = parseVTT(text);
        addSubtitle(CONFIG.externalSub.label, cues, CONFIG.externalSub.default);
    } catch (directErr) {
        _log('Direct subtitle fetch failed, trying proxy:', directErr.message);
        try {
            var proxyUrl = 'embed.php?ext_subproxy=' + encodeURIComponent(subUrl);
            var res2 = await fetch(proxyUrl);
            if (!res2.ok) throw new Error('Proxy fetch failed: ' + res2.status);
            var text2 = await res2.text();
            if (!text2.trim().startsWith('WEBVTT')) text2 = srtToVtt(text2);
            var cues2 = parseVTT(text2);
            addSubtitle(CONFIG.externalSub.label, cues2, CONFIG.externalSub.default);
        } catch (proxyErr) {
            console.error('Failed to load external subtitle:', proxyErr);
        }
    }
}
loadExternalSubtitle();

// ============================================
// OpenSubtitles Search
// ============================================
function getFallbackLanguages(currentLang) {
    var fallbacks = [];
    if (CONFIG.langOrder) {
        var ordered = CONFIG.langOrder.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        for (var i = 0; i < ordered.length; i++) {
            if (ordered[i] !== currentLang && fallbacks.indexOf(ordered[i]) === -1) {
                fallbacks.push(ordered[i]);
            }
        }
    }
    if (currentLang !== 'eng' && fallbacks.indexOf('eng') === -1) {
        fallbacks.push('eng');
    }
    return fallbacks;
}

async function searchWithFallbacks(currentLang, autoLoad) {
    var result = await searchSubtitles(currentLang, autoLoad);
    if (result.data && result.data.length > 0) {
        return { result: result, fallbackLang: null };
    }
    var fallbacks = getFallbackLanguages(currentLang);
    for (var i = 0; i < fallbacks.length; i++) {
        if (!autoLoad) {
            showLanguageLoadingOverlay(langSelect.querySelector('option[value="' + fallbacks[i] + '"]')?.textContent || fallbacks[i]);
        }
        result = await searchSubtitles(fallbacks[i], autoLoad);
        if (result.data && result.data.length > 0) {
            return { result: result, fallbackLang: fallbacks[i] };
        }
    }
    return { result: result, fallbackLang: fallbacks.length > 0 ? fallbacks[fallbacks.length - 1] : null };
}

const savedLang = parentStorage.getItem('subtitleLang');
if (savedLang && langSelect.querySelector('option[value="' + savedLang + '"]')) {
    langSelect.value = savedLang;
} else if (CONFIG.osLang) {
    var osLangNorm = CONFIG.osLang.length === 2 ? (_langMap2to3[CONFIG.osLang] || CONFIG.osLang) : CONFIG.osLang;
    if (langSelect.querySelector('option[value="' + osLangNorm + '"]')) {
        langSelect.value = osLangNorm;
    }
}

langSelect.addEventListener('change', async () => {
    if (langSelect.disabled) return;
    parentStorage.setItem('subtitleLang', langSelect.value);
    const osImdbId = getImdbIdForOS();
    if (osImdbId) {
        langSelect.disabled = true;
        showLanguageLoadingOverlay(langSelect.options[langSelect.selectedIndex].text);
        
        try {
            const fb = await searchWithFallbacks(langSelect.value, true);
            let result = fb.result;
            let fallbackUsed = fb.fallbackLang !== null;
            
            if (!result.data || result.data.length === 0) {
                hideLanguageLoadingOverlay();
                searchResults.innerHTML = '<div class="search-empty">No subtitles found</div>';
                return;
            }
            
            state.searchResults = result.data;
            
            let selectedIdx = -1;
            if (state.videoInfo && state.fileName) {
                const bestMatch = PTT.findBestMatch(state.videoInfo, result.data);
                if (bestMatch && bestMatch.score >= 50) {
                    selectedIdx = bestMatch.index;
                    await loadSearchResult(bestMatch.index, true);
                }
            }
            
            if (selectedIdx === -1) {
                const sorted = result.data.slice().sort((a, b) => (parseInt(b.SubDownloadsCnt) || 0) - (parseInt(a.SubDownloadsCnt) || 0));
                if (sorted.length > 0) {
                    selectedIdx = result.data.indexOf(sorted[0]);
                    await loadSearchResult(selectedIdx, true);
                }
            }
            
            hideLanguageLoadingOverlay();
            
            const fallbackName = fb.fallbackLang ? (langSelect.querySelector('option[value="' + fb.fallbackLang + '"]')?.textContent || fb.fallbackLang) : '';
            const suffix = fallbackUsed ? '(' + fallbackName + ' fallback)' : '';
            displaySubtitleResults(result.data, suffix, selectedIdx);
        } finally {
            langSelect.disabled = false;
        }
    }
});

function getImdbIdForOS() {
    if (CONFIG.idType === 'imdb') {
        return CONFIG.mediaId.replace(/^tt/i, '');
    }
    if (state.apiData && state.apiData.imdb_id) {
        return state.apiData.imdb_id.replace(/^tt/i, '');
    }
    return null;
}

async function searchSubtitles(lang, autoLoad) {
    if (autoLoad === undefined) autoLoad = false;
    
    const osImdbId = getImdbIdForOS();
    if (!osImdbId) {
        if (!autoLoad) searchResults.innerHTML = '<div class="search-empty">IMDB ID required</div>';
        return { success: false, data: [] };
    }
    
    let apiUrl = 'https://rest.opensubtitles.org/search';
    
    // Use CONFIG season/episode, or default to S01E01 for TV shows
    let season = CONFIG.season;
    let episode = CONFIG.episode;
    
    if (CONFIG.mediaType === 'tv' && (!season || !episode)) {
        season = 1;
        episode = 1;
    }
    
    if (season && episode) {
        apiUrl += '/episode-' + episode + '/imdbid-' + osImdbId + '/season-' + season;
    } else {
        apiUrl += '/imdbid-' + osImdbId;
    }
    apiUrl += '/sublanguageid-' + lang;
    
    if (!autoLoad) searchResults.innerHTML = '<div class="search-loading">Searching...</div>';
    
    try {
        const res = await fetch(apiUrl, { headers: { 'X-User-Agent': 'trailers.to-UA' } });
        const data = await res.json();
        return { success: true, data: data || [] };
    } catch (e) {
        return { success: false, data: [], error: e.message };
    }
}

function renderDefaultSubsList() {
    var subs = state.defaultSubs;
    var tab = $id('defaultSubsTab');
    var list = $id('defaultSubList');
    if (!tab || !list) return;

    if (!subs || subs.length === 0) {
        tab.style.display = 'none';
        list.innerHTML = '';
        return;
    }

    tab.style.display = '';
    var html = '';
    for (var i = 0; i < subs.length; i++) {
        var loaded = state._loadedDefaultSubs && state._loadedDefaultSubs[subs[i].url];
        html += '<div class="menu-item' + (loaded ? ' loaded' : '') + '" data-dsub="' + i + '">'
            + '<span class="menu-item-label">' + subs[i].lang + '</span>'
            + (loaded ? '<span style="font-size:10px;color:var(--primary,#10b981);margin-left:auto;">✓</span>' : '')
            + '</div>';
    }
    list.innerHTML = html;

    list.querySelectorAll('.menu-item').forEach(function(item) {
        item.addEventListener('click', function() {
            var idx = parseInt(item.dataset.dsub);
            loadAndActivateDefaultSub(idx);
        });
    });
}

async function loadAndActivateDefaultSub(idx) {
    var subs = state.defaultSubs;
    if (!subs || !subs[idx]) return;
    var sub = subs[idx];

    if (!state._loadedDefaultSubs) state._loadedDefaultSubs = {};

    if (state._loadedDefaultSubs[sub.url]) {
        var existingIdx = state.subtitles.findIndex(function(s) { return s.downloadLink === sub.url; });
        if (existingIdx >= 0) {
            setActiveSubtitle(existingIdx);
            var subtitlesTab = document.querySelector('[data-tab="subtitles"]');
            if (subtitlesTab) subtitlesTab.click();
        }
        return;
    }

    var list = $id('defaultSubList');
    var item = list ? list.querySelector('[data-dsub="' + idx + '"]') : null;
    if (item) item.innerHTML = '<span class="menu-item-label">' + sub.lang + '</span><span style="font-size:10px;color:#888;margin-left:auto;">loading...</span>';

    try {
        var text;
        try {
            var res = await fetch(sub.url);
            if (!res.ok) throw new Error(res.status);
            text = await res.text();
        } catch (e) {
            var proxyUrl = 'embed.php?ext_subproxy=' + encodeURIComponent(sub.url);
            var res2 = await fetch(proxyUrl);
            if (!res2.ok) throw new Error('proxy failed');
            text = await res2.text();
        }
        if (!text.trim().startsWith('WEBVTT')) text = srtToVtt(text);
        var cues = parseVTT(text);
        if (cues.length === 0) throw new Error('no cues');

        await addSubtitle(sub.lang, cues, true, sub.lang, sub.code, sub.url);
        state._loadedDefaultSubs[sub.url] = true;
        renderDefaultSubsList();

        var subtitlesTab = document.querySelector('[data-tab="subtitles"]');
        if (subtitlesTab) subtitlesTab.click();
    } catch (err) {
        _log('Failed to load default subtitle:', sub.lang, err);
        if (item) item.innerHTML = '<span class="menu-item-label">' + sub.lang + '</span><span style="font-size:10px;color:#f44;margin-left:auto;">failed</span>';
    }
}

async function loadSubtitlesAuto() {
    var savedLang2 = parentStorage.getItem('lastSubLang') || '';
    if (!savedLang2) {
        var savedLang3 = langSelect ? langSelect.value : '';
        if (savedLang3) savedLang2 = _langMap3to2[savedLang3] || '';
    }

    if (state.defaultSubs && state.defaultSubs.length > 0) {
        renderDefaultSubsList();
        if (savedLang2) {
            var matchIdx = state.defaultSubs.findIndex(function(s) { return s.code === savedLang2; });
            if (matchIdx >= 0) {
                await loadAndActivateDefaultSub(matchIdx);
                return;
            }
        }
    }
    await autoSearchSubtitles();
}

async function autoSearchSubtitles() {
    const osImdbId = getImdbIdForOS();
    if (!osImdbId) return;
    
    const preferredLang = langSelect.value;
    if (!preferredLang) return;
    const fb = await searchWithFallbacks(preferredLang, true);
    let result = fb.result;
    let fallbackUsed = fb.fallbackLang !== null;
    
    if (!result.data || result.data.length === 0) {
        searchResults.innerHTML = '<div class="search-empty">No subtitles found</div>';
        return;
    }
    
    state.searchResults = result.data;
    
    let selectedIdx = -1;
    
    if (state.videoInfo && state.fileName) {
        const bestMatch = PTT.findBestMatch(state.videoInfo, result.data);
        if (bestMatch && bestMatch.score >= 50) {
            selectedIdx = bestMatch.index;
            await loadSearchResult(bestMatch.index, true);
        }
    }
    
    if (selectedIdx === -1) {
        const sorted = result.data.slice().sort((a, b) => (parseInt(b.SubDownloadsCnt) || 0) - (parseInt(a.SubDownloadsCnt) || 0));
        if (sorted.length > 0) {
            selectedIdx = result.data.indexOf(sorted[0]);
            await loadSearchResult(selectedIdx, true);
        }
    }
    
    const fallbackName = fb.fallbackLang ? (langSelect.querySelector('option[value="' + fb.fallbackLang + '"]')?.textContent || fb.fallbackLang) : '';
    const suffix = fallbackUsed ? '(' + fallbackName + ' fallback)' : '(auto-selected)';
    displaySubtitleResults(result.data, suffix, selectedIdx);
}

searchBtn.addEventListener('click', async () => {
    updateDownloadCounter();
    const result = await searchSubtitles(langSelect.value, false);
    
    if (!result.success) {
        searchResults.innerHTML = '<div class="search-empty">Error: ' + (result.error || 'Search failed') + '</div>';
        return;
    }
    
    state.searchResults = result.data;
    
    if (!result.data || result.data.length === 0) {
        var fallbacks = getFallbackLanguages(langSelect.value);
        var found = false;
        for (var fi = 0; fi < fallbacks.length; fi++) {
            var fbName = langSelect.querySelector('option[value="' + fallbacks[fi] + '"]')?.textContent || fallbacks[fi];
            searchResults.innerHTML = '<div class="search-loading">No results, trying ' + fbName + '...</div>';
            var fbResult = await searchSubtitles(fallbacks[fi], false);
            if (fbResult.data && fbResult.data.length > 0) {
                state.searchResults = fbResult.data;
                displaySubtitleResults(fbResult.data, '(' + fbName + ' fallback)');
                found = true;
                break;
            }
        }
        if (!found) {
            searchResults.innerHTML = '<div class="search-empty">No subtitles found</div>';
        }
        return;
    }
    
    if (state.videoInfo && state.fileName) {
        const bestMatch = PTT.findBestMatch(state.videoInfo, result.data);
        if (bestMatch && bestMatch.score >= 50) {
            searchResults.innerHTML = '<div class="search-loading">Auto-matched (' + bestMatch.score + '%)...</div>';
            await loadSearchResult(bestMatch.index);
            return;
        }
    }
    
    displaySubtitleResults(result.data);
});

function displaySubtitleResults(data, suffix, selectedIdx) {
    if (suffix === undefined) suffix = '';
    if (selectedIdx === undefined) selectedIdx = -1;
    
    // Calculate match scores and sort by compatibility desc, then downloads desc
    const scoredData = data.map((s, originalIdx) => {
        let score = 0;
        if (state.videoInfo) {
            score = PTT.matchScore(state.videoInfo, s.SubFileName || s.MovieReleaseName);
        }
        return { sub: s, originalIdx: originalIdx, score: score };
    });
    
    scoredData.sort((a, b) => {
        // First by score descending
        if (b.score !== a.score) return b.score - a.score;
        // Then by downloads descending
        return (parseInt(b.sub.SubDownloadsCnt) || 0) - (parseInt(a.sub.SubDownloadsCnt) || 0);
    });
    
    // Find where selectedIdx ended up after sorting
    let displaySelectedIdx = -1;
    if (selectedIdx >= 0) {
        displaySelectedIdx = scoredData.findIndex(item => item.originalIdx === selectedIdx);
    }
    
    // Auto-detect if any subtitle from results is already loaded
    if (displaySelectedIdx === -1 && state.subtitles.length > 0) {
        scoredData.forEach((item, i) => {
            const fileName = item.sub.SubFileName || '';
            if (state.subtitles.some(sub => sub.label === fileName)) {
                displaySelectedIdx = i;
            }
        });
    }
    
    searchResults.innerHTML = scoredData.map((item, i) => {
        const s = item.sub;
        const score = item.score;
        const color = score >= 70 ? '#0c0' : (score >= 40 ? '#fc0' : '#666');
        const matchInfo = '<span class="search-result-match" style="color:' + color + ';">' + score + '%</span>';
        const fileName = (s.SubFileName || 'Subtitle').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const isSelected = (i === displaySelectedIdx);
        const loadedClass = isSelected ? ' loaded' : '';
        const dlText = isSelected ? '✓' : '↓' + (s.SubDownloadsCnt || 0);
        return '<div class="search-result' + loadedClass + '" data-idx="' + item.originalIdx + '"><span class="search-result-name">' + fileName + '</span>' + matchInfo + '<span class="search-result-dl">' + dlText + '</span></div>';
    }).join('') + (suffix ? '<div style="color:#888;font-size:11px;padding:5px;">' + suffix + '</div>' : '');
    
    searchResults.querySelectorAll('.search-result').forEach(el => {
        el.addEventListener('click', () => {
            // Prevent clicking if something is already loading
            if (state.subtitleLoadingLock) {
                return; // Silently ignore - loading overlay is already shown
            }
            loadSearchResult(parseInt(el.dataset.idx));
        });
    });
}

async function loadSearchResult(idx, silent) {
    if (silent === undefined) silent = false;
    
    // Prevent multiple simultaneous imports
    if (state.subtitleLoadingLock) {
        return; // Already loading, ignore silently
    }
    
    const sub = state.searchResults[idx];
    if (!sub.SubDownloadLink) return;
    
    const rawEncoding = sub.SubEncoding || 'UTF-8';
    // Sanitize encoding - TextDecoder doesn't support many legacy encodings
    const encodingMap = {
        'CP850': 'windows-1252', 'CP1250': 'windows-1250', 'CP1251': 'windows-1251',
        'CP1252': 'windows-1252', 'CP1253': 'windows-1253', 'CP1254': 'windows-1254',
        'CP1255': 'windows-1255', 'CP1256': 'windows-1256', 'CP437': 'windows-1252',
        'ASCII': 'utf-8', 'US-ASCII': 'utf-8'
    };
    const encoding = encodingMap[rawEncoding.toUpperCase()] || rawEncoding;
    
    // Set loading lock
    state.subtitleLoadingLock = true;
    
    if (!silent) {
        // Show loading overlay inside search results
        showSearchLoadingOverlay(idx);
    }
    
    try {
        let content = null;
        let cachedVttUrl = null;
        
        // First, try to get from server cache
        try {
            const cacheUrl = API_BASE + '/cache.php?action=get&url=' + encodeURIComponent(sub.SubDownloadLink);
            const cacheRes = await fetch(cacheUrl);
            if (cacheRes.ok) {
                const cacheData = await cacheRes.json();
                if (cacheData.success && cacheData.content) {
                    content = cacheData.content;
                    // IMPORTANT: Convert relative VTT URL to absolute for iOS
                    if (cacheData.vtt_url) {
                        cachedVttUrl = cacheData.vtt_url.startsWith('/') 
                            ? window.location.origin + cacheData.vtt_url 
                            : cacheData.vtt_url;
                    }
                    _log('Subtitle loaded from cache', cachedVttUrl ? '(VTT URL: ' + cachedVttUrl + ')' : '');
                }
            }
        } catch (e) {
            // Cache miss or error, will download from source
        }
        
        // If not in cache, download from OpenSubtitles
        if (!content) {
            _log('Downloading subtitle from source');
            const downloadUrl = sub.SubDownloadLink;
            const response = await fetch(downloadUrl);
            
            if (!response.ok) {
                throw new Error('Download failed: ' + response.status);
            }
            
            // Get the response as ArrayBuffer (it's gzipped)
            const arrayBuffer = await response.arrayBuffer();
        
        // Decompress gzip using DecompressionStream (modern browsers) or pako fallback
            // Decompress gzip using DecompressionStream (modern browsers) or pako fallback
            if (typeof DecompressionStream !== 'undefined') {
                // Modern browser with DecompressionStream support
                const ds = new DecompressionStream('gzip');
                const decompressedStream = new Response(new Blob([arrayBuffer]).stream().pipeThrough(ds)).arrayBuffer();
                const decompressed = await decompressedStream;
                content = new TextDecoder(encoding || 'utf-8').decode(decompressed);
            } else {
                // Fallback: try to decode directly (some servers return uncompressed)
                try {
                    content = new TextDecoder(encoding || 'utf-8').decode(arrayBuffer);
                    // Check if it looks like valid subtitle content
                    if (content.indexOf('-->') === -1 && content.charCodeAt(0) === 0x1f) {
                        throw new Error('Gzip decompression needed');
                    }
                } catch (e) {
                    // Try using pako if available
                    if (typeof pako !== 'undefined') {
                        const decompressed = pako.inflate(new Uint8Array(arrayBuffer));
                        content = new TextDecoder(encoding || 'utf-8').decode(decompressed);
                    } else {
                        throw new Error('Cannot decompress gzip - browser not supported');
                    }
                }
            }
            
            if (!content || content.indexOf('-->') === -1) throw new Error('Invalid format');
            
            // Send to server for caching (fire and forget) - only if downloaded from source
            try {
                const cacheData = new FormData();
                cacheData.append('action', 'cache_subtitle');
                cacheData.append('url', sub.SubDownloadLink);
                cacheData.append('content', content);
                cacheData.append('filename', sub.SubFileName || 'subtitle.srt');
                cacheData.append('imdb', CONFIG.mediaId || '');
                cacheData.append('lang', sub.SubLanguageID || sub.ISO639 || 'en');
                cacheData.append('encoding', encoding || 'UTF-8');
                fetch(API_BASE + '/cache.php', {
                    method: 'POST',
                    body: cacheData
                }).catch(() => {}); // Ignore cache errors
            } catch (e) {
                // Ignore cache errors
            }
        }
        
        // Now content is either from cache or freshly downloaded
        if (!content || content.indexOf('-->') === -1) throw new Error('Invalid format');
        
        const vtt = content.trim().startsWith('WEBVTT') ? content : srtToVtt(content);
        const cues = parseVTT(vtt);
        const langName = sub.LanguageName || '';
        const langCode = sub.SubLanguageID || sub.ISO639 || 'en';
        const subFileName = sub.SubFileName || 'OpenSubtitles';
        
        // Check if subtitle already exists (prevent duplicates)
        const existingIdx = state.subtitles.findIndex(s => 
            s.label === subFileName || 
            (s.downloadLink && s.downloadLink === sub.SubDownloadLink)
        );
        
        if (existingIdx >= 0) {
            // Already exists, just activate it
            setActiveSubtitle(existingIdx);
        } else {
            // Add new subtitle with download link reference and cached URL
            await addSubtitle(subFileName, cues, true, langName, langCode, sub.SubDownloadLink, cachedVttUrl);
            
            // Always select the newly added subtitle
            setActiveSubtitle(state.subtitles.length - 1);
        }
        
        if (!silent) {
            // Hide loading overlay and show success
            hideSearchLoadingOverlay();
            
            // Update the clicked item to show success
            const items = searchResults.querySelectorAll('.search-result');
            items.forEach((item, i) => {
                if (parseInt(item.dataset.idx) === idx) {
                    item.classList.add('loaded');
                    item.querySelector('.search-result-dl').textContent = '✓';
                }
            });
        }
        
        // Release loading lock
        state.subtitleLoadingLock = false;
        
        // Switch to subtitles tab and highlight newly added
        const subtitlesTab = document.querySelector('[data-tab="subtitles"]');
        if (subtitlesTab) {
            subtitlesTab.click();
            
            // Highlight animation on newly added subtitle
            setTimeout(() => {
                const newSubItem = subList.querySelector('.menu-item.active');
                if (newSubItem) {
                    newSubItem.classList.add('highlight-pulse');
                    setTimeout(() => newSubItem.classList.remove('highlight-pulse'), 1500);
                }
            }, 100);
        }
    } catch (e) {
        // Release loading lock
        state.subtitleLoadingLock = false;
        
        if (!silent) {
            // Hide loading overlay and show error
            hideSearchLoadingOverlay();
            showToast('✗ Failed to load subtitle', 3000);
        }
        console.error('Subtitle load failed:', e);
    }
}

function updateDownloadCounter() {
    const counter = $id('downloadCounter');
    if (counter) {
        counter.textContent = '10 downloads/24h per IP';
        counter.style.color = '#888';
    }
}

// ============================================
// Search Results Loading Overlay
// ============================================
function showSearchLoadingOverlay(idx) {
    // Remove any existing overlay
    hideSearchLoadingOverlay();
    
    // Get the subtitle name for display
    const sub = state.searchResults[idx];
    const fileName = (sub.SubFileName || 'Subtitle').substring(0, 50);
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'search-loading-overlay';
    overlay.id = 'subtitleLoadingOverlay';
    overlay.innerHTML = `
        <div class="search-loading-spinner"></div>
        <div class="search-loading-text">Loading subtitle...</div>
        <div class="search-loading-filename">${fileName}</div>
    `;
    
    // Add directly to search results
    searchResults.appendChild(overlay);
    
    // Trigger animation
    setTimeout(() => overlay.classList.add('visible'), 10);
}

function hideSearchLoadingOverlay() {
    const overlay = document.getElementById('subtitleLoadingOverlay');
    if (overlay) {
        overlay.classList.remove('visible');
        
        setTimeout(() => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, 300);
    }
}

// ============================================
// Language Search Loading Overlay
// ============================================
function showLanguageLoadingOverlay(languageName) {
    hideLanguageLoadingOverlay();
    
    const overlay = document.createElement('div');
    overlay.className = 'language-loading-overlay';
    overlay.id = 'languageLoadingOverlay';
    overlay.innerHTML = `
        <div class="language-loading-spinner"></div>
        <div class="language-loading-text">Searching subtitles...</div>
        <div class="language-loading-lang">${languageName}</div>
    `;
    
    // Add to menu-content instead of ccMenu to avoid breaking positioning
    const menuContent = document.querySelector('#ccMenu .menu-content');
    if (menuContent) {
        menuContent.appendChild(overlay);
        setTimeout(() => overlay.classList.add('visible'), 10);
    }
}

function hideLanguageLoadingOverlay() {
    const overlay = document.getElementById('languageLoadingOverlay');
    if (overlay) {
        overlay.classList.remove('visible');
        
        setTimeout(() => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, 300);
    }
}

// ============================================
// Subtitle Sync (Timing Offset)
// ============================================
let subtitleOffset = 0;
const syncOffsetInput = $id('syncOffset');
const syncDecrease = $id('syncDecrease');
const syncIncrease = $id('syncIncrease');

async function applySubtitleOffset(offset) {
    subtitleOffset = parseFloat(offset) || 0;
    syncOffsetInput.value = subtitleOffset;
    
    const isiOS = isIOSDevice();
    
    // Apply offset to all subtitle cues
    for (const sub of state.subtitles) {
        if (sub.originalCues) {
            // Restore from original and apply new offset
            sub.cues = sub.originalCues.map(cue => ({
                start: cue.start + subtitleOffset,
                end: cue.end + subtitleOffset,
                text: cue.text
            }));
            
            const vttContent = cuesToVTT(sub.cues);
            sub.vttContent = vttContent;
            
            // Rebuild track
            if (sub.track && sub.track.parentNode) {
                if (isiOS) {
                    // iOS: MUST replace track element, not just change src
                    // iOS doesn't pick up src changes on existing tracks during playback
                    const newVttUrl = await getOrCreateVttUrlForIOS(vttContent, {
                        filename: sub.label,
                        imdb: CONFIG.mediaId,
                        lang: sub.langCode
                    });
                    
                    if (newVttUrl) {
                        await replaceSubtitleTrackIOS(sub, newVttUrl);
                    } else {
                        // Fallback: try just setting src (may not work in fullscreen)
                        sub.track.src = createVTTDataUrl(vttContent);
                        console.warn('iOS: Could not get server URL for offset change');
                    }
                } else {
                    // Non-iOS: data URL is fine, just update src
                    sub.track.src = createVTTDataUrl(vttContent);
                }
            }
        }
    }
    
    // Update current cues if subtitle is active
    if (state.activeSubIdx >= 0 && state.subtitles[state.activeSubIdx]) {
        state.currentCues = state.subtitles[state.activeSubIdx].cues;
        
        // Re-enable track mode using DOM-resolved index
        const sub = state.subtitles[state.activeSubIdx];
        const trackIdx = getTrackIndexForSubtitle(sub);
        
        if (trackIdx >= 0) {
            enableTrackAtIndex(trackIdx);
        }
    }
    
    updateSubtitleDisplay();
}

syncDecrease.addEventListener('click', () => {
    applySubtitleOffset(subtitleOffset - 0.5);
});

syncIncrease.addEventListener('click', () => {
    applySubtitleOffset(subtitleOffset + 0.5);
});

syncOffsetInput.addEventListener('change', () => {
    applySubtitleOffset(syncOffsetInput.value);
});

syncOffsetInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        applySubtitleOffset(syncOffsetInput.value);
        syncOffsetInput.blur();
    }
});

// Preset buttons
document.querySelectorAll('.sync-preset').forEach(btn => {
    btn.addEventListener('click', () => {
        applySubtitleOffset(parseFloat(btn.dataset.offset) || 0);
    });
});

// ============================================
// Subtitle Style
// ============================================
const styleEls = {
    color: $id('subColor'),
    bg: $id('subBg'),
    bgAlpha: $id('subBgAlpha'),
    size: $id('subSize'),
    font: $id('subFont')
};

function updateSubStyle() {
    const alpha = styleEls.bgAlpha.value / 100;
    const r = parseInt(styleEls.bg.value.slice(1,3), 16);
    const g = parseInt(styleEls.bg.value.slice(3,5), 16);
    const b = parseInt(styleEls.bg.value.slice(5,7), 16);
    
    wrapper.style.setProperty('--sub-color', styleEls.color.value);
    wrapper.style.setProperty('--sub-bg', 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')');
    wrapper.style.setProperty('--sub-size', (styleEls.size.value / 100 * 1.3) + 'rem');
    wrapper.style.setProperty('--sub-font', styleEls.font.value);
    
    $id('subBgAlphaVal').textContent = styleEls.bgAlpha.value + '%';
    $id('subSizeVal').textContent = styleEls.size.value + '%';
}

function saveSubStyle() {
    try {
        parentStorage.setItem('playerSubStyle', JSON.stringify({
            color: styleEls.color.value,
            bg: styleEls.bg.value,
            bgAlpha: styleEls.bgAlpha.value,
            size: styleEls.size.value,
            font: styleEls.font.value
        }));
    } catch(e){}
}

(function restoreSubStyle() {
    try {
        var saved = parentStorage.getItem('playerSubStyle');
        var s = saved ? JSON.parse(saved) : (CONFIG.defaultSubStyle || null);
        if (!s) return;
        if (s.color) styleEls.color.value = s.color;
        if (s.bg) styleEls.bg.value = s.bg;
        if (s.bgAlpha) styleEls.bgAlpha.value = s.bgAlpha;
        if (s.size) styleEls.size.value = s.size;
        if (s.font) styleEls.font.value = s.font;
        updateSubStyle();
    } catch(e){}
})();

Object.values(styleEls).forEach(el => {
    el.addEventListener('input', () => { updateSubStyle(); saveSubStyle(); });
    el.addEventListener('change', () => { updateSubStyle(); saveSubStyle(); });
});

const subStyleResetBtn = $id('subStyleReset');
if (subStyleResetBtn) {
    subStyleResetBtn.addEventListener('click', function() {
        parentStorage.removeItem('playerSubStyle');
        var d = CONFIG.defaultSubStyle || {};
        styleEls.color.value = d.color || '#ffffff';
        styleEls.bg.value = d.bg || '#000000';
        styleEls.bgAlpha.value = d.bgAlpha || '80';
        styleEls.size.value = d.size || '100';
        styleEls.font.value = d.font || 'inherit';
        updateSubStyle();
    });
}

// ============================================
// Ads Integration (ad network code injection)
// ============================================
const AdsManager = {
    fired: false,

    init: function() {
        if (!ADS_CONFIG || !ADS_CONFIG.enabled) return;
        const adEl = document.getElementById('ad-network-code');
        if (!adEl || !adEl.innerHTML.trim()) return;

        const self = this;
        wrapper.addEventListener('click', function onFirstClick() {
            if (self.fired) return;
            self.fired = true;
            wrapper.removeEventListener('click', onFirstClick);

            // Activate the ad network code by moving it into the DOM and executing scripts
            const container = document.createElement('div');
            container.id = 'ad-network-active';
            container.innerHTML = adEl.innerHTML;
            document.body.appendChild(container);

            // Execute any <script> tags inside the ad code
            container.querySelectorAll('script').forEach(function(oldScript) {
                const newScript = document.createElement('script');
                if (oldScript.src) {
                    newScript.src = oldScript.src;
                } else {
                    newScript.textContent = oldScript.textContent;
                }
                oldScript.parentNode.replaceChild(newScript, oldScript);
            });
        });
    }
};

// ============================================
// Source Switcher
// ============================================
const SOURCE_LABELS = {
    'justhd': 'Source 1',
    'hdtoday': 'Source 2'
};

function initSourceSwitcher() {
    const sourceBtn = $id('sourceBtn');
    const sourceMenu = $id('sourceMenu');
    const sourceList = $id('sourceList');
    if (!sourceBtn || !sourceMenu || !sourceList) return;
    
    const sources = CONFIG.availableSources || ['justhd'];
    if (sources.length <= 1) {
        sourceBtn.style.display = 'none';
        return;
    }
    
    sourceList.innerHTML = '';
    sources.forEach(function(src) {
        const item = document.createElement('div');
        item.className = 'menu-item source-item' + (src === state.currentSource ? ' active' : '');
        item.dataset.source = src;
        item.innerHTML = '<span>' + (SOURCE_LABELS[src] || src) + '</span>'
            + (src === state.currentSource ? '<svg class="check-icon" viewBox="0 0 24 24" width="16" height="16"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>' : '');
        item.addEventListener('click', function() {
            switchSource(src);
        });
        sourceList.appendChild(item);
    });
    
    sourceBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const isOpen = sourceMenu.style.display !== 'none';
        closeAllMenus();
        if (!isOpen) {
            sourceMenu.style.display = 'block';
            positionMenu(sourceMenu, sourceBtn);
        }
    });
}

function positionMenu(menu, btn) {
    const rect = btn.getBoundingClientRect();
    const wrapRect = wrapper.getBoundingClientRect();
    menu.style.bottom = (wrapRect.bottom - rect.top + 4) + 'px';
    menu.style.right = Math.max(4, wrapRect.right - rect.right) + 'px';
}

function switchSource(newSource) {
    if (newSource === state.currentSource) {
        closeAllMenus();
        return;
    }
    
    _log('Switching source to:', newSource);
    state.currentSource = newSource;
    parentStorage.setItem('va_preferred_source', newSource);
    
    closeAllMenus();
    
    if (state.hls) {
        state.hls.destroy();
        state.hls = null;
    }
    video.removeAttribute('src');
    video.load();
    
    state.allStreams = [];
    state.currentStreamIdx = 0;
    state.billableViewSent = false;
    state._sourceFallbackAttempted = false;
    
    updateSourceMenu();
    fetchStreamData(newSource);
}

function updateSourceMenu() {
    const items = document.querySelectorAll('.source-item');
    items.forEach(function(item) {
        const src = item.dataset.source;
        const isActive = src === state.currentSource;
        item.className = 'menu-item source-item' + (isActive ? ' active' : '');
        item.innerHTML = '<span>' + (SOURCE_LABELS[src] || src) + '</span>'
            + (isActive ? '<svg class="check-icon" viewBox="0 0 24 24" width="16" height="16"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>' : '');
    });
}

document.addEventListener('click', function(e) {
    const sourceMenu = $id('sourceMenu');
    const sourceBtn = $id('sourceBtn');
    if (sourceMenu && sourceMenu.style.display !== 'none') {
        if (!sourceMenu.contains(e.target) && e.target !== sourceBtn) {
            sourceMenu.style.display = 'none';
        }
    }
});

// ============================================
// Initialize
// ============================================
renderSubList();
updateSubStyle();
initSourceSwitcher();

if (typeof ADS_CONFIG !== 'undefined') {
    AdsManager.init();
}

// Start fetching stream data
fetchStreamData();

_log('Player Ready', CONFIG);


/**
 * Player Tracking Script
 * Add this to your player JavaScript
 */

// Track play after 30 seconds of watch time
let watchTime = 0;
let playTracked = false;
let trackingInterval = null;

// Start tracking when video plays
video.addEventListener('play', function() {
    if (playTracked) return;
    
    trackingInterval = setInterval(function() {
        watchTime++;
        
        if (watchTime >= 30 && !playTracked) {
            trackPlay();
            clearInterval(trackingInterval);
        }
    }, 1000);
});

// Stop tracking when paused
video.addEventListener('pause', function() {
    if (trackingInterval) {
        clearInterval(trackingInterval);
    }
});

// Track play function — sends signed HMAC token for anti-abuse
function trackPlay() {
    playTracked = true;
    
    const videoId = CONFIG.mediaId || getVideoIdFromUrl();
    const params = new URLSearchParams({
        video_id: videoId,
        watch_time: watchTime,
        play_token: CONFIG.playToken || '',
        play_token_ts: CONFIG.playTokenTs || 0,
        media_type: CONFIG.mediaType || 'movie',
        season: CONFIG.season || '',
        episode: CONFIG.episode || '',
        domain: CONFIG.hostDomain || ''
    });
    
    fetch(API_BASE + '/track.php', {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        credentials: 'same-origin',
        body: params.toString()
    })
    .then(r => r.json())
    .then(data => { _log('Track result:', data); })
    .catch(err => { _log('Track error:', err); });
}

function getVideoIdFromUrl() {
    const path = window.location.pathname;
    const match = path.match(/\/(movie|tv|anime)\/([^\/]+)/);
    return match ? match[2] : CONFIG.mediaId || 'unknown';
}

/**
 * Episodes Button Handler for Prime Theme
 * Add this to player.js or include as a separate script
 */

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function() {
    const episodesBtn = document.getElementById('episodesBtn');
    const episodeSelector = document.getElementById('episodeSelector');
    const ccMenu = document.getElementById('ccMenu');
    const settingsMenu = document.getElementById('settingsMenu');
    
    if (episodesBtn && episodeSelector) {
        // Show Episodes button when there are episodes/seasons
        // This function should be called by your video loading code
        window.showEpisodesButton = function() {
            episodesBtn.style.display = 'flex';
        };
        
        window.hideEpisodesButton = function() {
            episodesBtn.style.display = 'none';
            episodeSelector.classList.remove('open');
        };
        
        // Episodes button click handler
        episodesBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            
            // Close other menus
            if (ccMenu) ccMenu.classList.remove('open');
            if (settingsMenu) settingsMenu.classList.remove('open');
            
            // Toggle episode selector
            episodeSelector.classList.toggle('open');
            episodesBtn.classList.toggle('active');
        });
        
        // Close episode selector when clicking outside
        document.addEventListener('click', function(e) {
            if (!episodeSelector.contains(e.target) && e.target !== episodesBtn) {
                episodeSelector.classList.remove('open');
                episodesBtn.classList.remove('active');
            }
        });
    }
});

// ============================================
// Re-apply stored settings once the parent sends STORAGE_INIT
// ============================================
parentStorage.onInit(function() {
    try {
        var sv = parentStorage.getItem('playerVolume');
        var sm = parentStorage.getItem('playerMuted');
        if (sv !== null) video.volume = parseFloat(sv);
        if (sm === '1') video.muted = true;
        updateVolumeUI();
        volumeSlider.style.setProperty('--volume-pct', ((video.muted ? 0 : video.volume) * 100) + '%');
    } catch(e) {}

    try {
        var sp = parentStorage.getItem('playerSpeed');
        if (sp) {
            var spf = parseFloat(sp);
            video.playbackRate = spf;
            var cse = $id('currentSpeed');
            if (cse) cse.textContent = spf === 1 ? '1x' : spf + 'x';
            if (speedList) {
                speedList.querySelectorAll('.menu-item').forEach(function(item) {
                    item.classList.toggle('active', parseFloat(item.dataset.speed) === spf);
                });
            }
        }
    } catch(e) {}

    var src = parentStorage.getItem('va_preferred_source');
    if (src) state.currentSource = src;

    try {
        var sl = parentStorage.getItem('subtitleLang');
        if (sl && langSelect && langSelect.querySelector('option[value="' + sl + '"]')) {
            langSelect.value = sl;
        }
    } catch(e) {}

    try {
        var ss = parentStorage.getItem('playerSubStyle');
        if (ss) {
            var s = JSON.parse(ss);
            if (s.color && styleEls.color) styleEls.color.value = s.color;
            if (s.bg && styleEls.bg) styleEls.bg.value = s.bg;
            if (s.bgAlpha && styleEls.bgAlpha) styleEls.bgAlpha.value = s.bgAlpha;
            if (s.size && styleEls.size) styleEls.size.value = s.size;
            if (s.font && styleEls.font) styleEls.font.value = s.font;
            updateSubStyle();
        }
    } catch(e) {}

    // Re-check continue watching (may have missed it if cache was empty)
    if (!(CONFIG.startAt > 0)) {
        try {
            if (CONFIG.autoplay) {
                autoResumeWatchProgress();
            } else {
                promptContinueWatching();
            }
        } catch(e) {}
    }

    // Re-check last watched episode for TV shows
    if (CONFIG.mediaType === 'tv' && typeof window.loadEpisodeGlobal === 'function') {
        try {
            var lw = getLastWatchedEpisode();
            if (lw && (String(lw.season) !== String(CONFIG.season) || String(lw.episode) !== String(CONFIG.episode))) {
                window.loadEpisodeGlobal(lw.season, lw.episode);
            }
        } catch(e) {}
    }
});

