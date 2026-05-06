<?php
// ============================================
// DESCARGADOR DE STREAMIMDB - VERSIÓN ROBUSTA
// Prueba todos los streams hasta encontrar uno funcional
// ============================================

set_time_limit(0);
ini_set('memory_limit', '512M');
error_reporting(0);

$id = $_GET['id'] ?? '';
$type = $_GET['type'] ?? 'auto';
$season = intval($_GET['season'] ?? 1);
$episode = intval($_GET['episode'] ?? 1);
$maxSeconds = intval($_GET['seconds'] ?? 0);

if (!preg_match('/^tt\d{5,}$/', $id)) {
    header('Content-Type: application/json');
    die(json_encode(['error' => 'ID inválido']));
}

// ============================================
// FUNCIONES
// ============================================

function curlGet($url, $timeout = 15) {
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        CURLOPT_HTTPHEADER => [
            'Accept: */*',
            'Accept-Language: es-ES,es;q=0.9',
            'Referer: https://brightpathsignals.com/',
            'Origin: https://brightpathsignals.com'
        ]
    ]);
    $data = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ($httpCode === 200 || $httpCode === 206) ? $data : false;
}

function fetchAPI($id, $type, $season = null, $episode = null) {
    $url = "https://streamdata.vaplayer.ru/api.php?imdb=" . urlencode($id) . "&type=" . $type;
    if ($type === 'tv' && $season && $episode) {
        $url .= "&season=" . $season . "&episode=" . $episode;
    }
    
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_USERAGENT => 'Mozilla/5.0',
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'Referer: https://brightpathsignals.com/'
        ]
    ]);
    $response = curl_exec($ch);
    curl_close($ch);
    
    $data = json_decode($response, true);
    return (($data['status_code'] ?? '') === '200' && isset($data['data'])) ? $data['data'] : null;
}

function extractSegmentsFromVariant($variantContent) {
    $segments = [];
    $segmentDuration = 0;
    
    foreach (explode("\n", $variantContent) as $line) {
        $line = trim($line);
        
        if (strpos($line, '#EXTINF:') !== false) {
            preg_match('/#EXTINF:([\d.]+)/', $line, $m);
            $segmentDuration = isset($m[1]) ? floatval($m[1]) : 5;
        } elseif (!empty($line) && strpos($line, '#') !== 0) {
            $segments[] = [
                'url' => $line,
                'duration' => $segmentDuration
            ];
            $segmentDuration = 0;
        }
    }
    
    return $segments;
}

function findBestVariant($masterContent, $masterUrl) {
    $lines = explode("\n", $masterContent);
    $variants = [];
    $currentBandwidth = 0;
    $currentResolution = '';
    
    foreach ($lines as $i => $line) {
        $line = trim($line);
        if (strpos($line, '#EXT-X-STREAM-INF') !== false) {
            preg_match('/BANDWIDTH=(\d+)/', $line, $m);
            $currentBandwidth = isset($m[1]) ? intval($m[1]) : 0;
            preg_match('/RESOLUTION=(\d+x\d+)/', $line, $m);
            $currentResolution = $m[1] ?? '';
        } elseif (!empty($line) && strpos($line, '#') !== 0 && $currentBandwidth > 0) {
            $url = (strpos($line, 'http') === 0) ? $line : 'https://dataanalyticsacademy.site' . $line;
            $variants[] = [
                'url' => $url,
                'bandwidth' => $currentBandwidth,
                'resolution' => $currentResolution
            ];
            $currentBandwidth = 0;
        }
    }
    
    // Ordenar por bandwidth descendente
    usort($variants, function($a, $b) {
        return $b['bandwidth'] - $a['bandwidth'];
    });
    
    return $variants;
}

// ============================================
// 1. OBTENER STREAMS DE LA API
// ============================================

// Probar como película y serie
$data = fetchAPI($id, 'movie');
if (!$data || empty($data['stream_urls'])) {
    $data = fetchAPI($id, 'tv', $season, $episode);
}

if (!$data || empty($data['stream_urls'])) {
    header('Content-Type: application/json');
    die(json_encode(['error' => 'Película/serie no encontrada']));
}

$title = $data['title'] ?? 'video';
$streams = $data['stream_urls'];

// ============================================
// 2. PROBAR CADA STREAM HASTA ENCONTRAR UNO FUNCIONAL
// ============================================

$workingSegments = null;
$workingStreamIdx = -1;
$bestBandwidth = 0;
$bestResolution = '';

foreach ($streams as $idx => $masterUrl) {
    // Descargar master playlist
    $master = curlGet($masterUrl, 10);
    if (!$master || strlen($master) < 100) continue;
    
    // Ver si es master o directo
    $isMaster = (strpos($master, '#EXT-X-STREAM-INF') !== false);
    $isDirect = (strpos($master, '#EXTINF') !== false);
    
    if ($isMaster) {
        // Extraer variants
        $variants = findBestVariant($master, $masterUrl);
        
        foreach ($variants as $variant) {
            $variantContent = curlGet($variant['url'], 10);
            if (!$variantContent || strlen($variantContent) < 100) continue;
            
            $segments = extractSegmentsFromVariant($variantContent);
            
            if (!empty($segments)) {
                // Verificar que el primer segmento sea accesible
                $firstSeg = curlGet($segments[0]['url'], 10);
                if ($firstSeg && strlen($firstSeg) > 1000 && ord($firstSeg[0]) === 0x47) {
                    // ¡FUNCIONA!
                    if ($variant['bandwidth'] > $bestBandwidth) {
                        $workingSegments = $segments;
                        $workingStreamIdx = $idx;
                        $bestBandwidth = $variant['bandwidth'];
                        $bestResolution = $variant['resolution'];
                        break 2; // Salir de ambos loops
                    }
                }
            }
        }
    } elseif ($isDirect) {
        $segments = extractSegmentsFromVariant($master);
        
        if (!empty($segments)) {
            $firstSeg = curlGet($segments[0]['url'], 10);
            if ($firstSeg && strlen($firstSeg) > 1000 && ord($firstSeg[0]) === 0x47) {
                $workingSegments = $segments;
                $workingStreamIdx = $idx;
                break;
            }
        }
    }
}

if (!$workingSegments) {
    header('Content-Type: application/json');
    die(json_encode(['error' => 'No se pudo acceder a ningún stream. Intenta de nuevo.']));
}

// ============================================
// 3. LIMITAR SEGMENTOS SI SE ESPECIFICÓ seconds
// ============================================

$totalSegments = count($workingSegments);

if ($maxSeconds > 0) {
    $segundosAcumulados = 0;
    $segmentosFiltrados = [];
    
    foreach ($workingSegments as $seg) {
        $segundosAcumulados += $seg['duration'];
        $segmentosFiltrados[] = $seg;
        if ($segundosAcumulados >= $maxSeconds) break;
    }
    
    $workingSegments = $segmentosFiltrados;
}

// Calcular duración total
$totalDuration = 0;
foreach ($workingSegments as $seg) {
    $totalDuration += $seg['duration'];
}

// ============================================
// 4. ENVIAR ARCHIVO
// ============================================

$safeTitle = preg_replace('/[^a-zA-Z0-9\s\-_]/', '', $title);
$safeTitle = preg_replace('/\s+/', '_', substr($safeTitle, 0, 70));

$fileName = $maxSeconds > 0 ? $safeTitle . '_' . $maxSeconds . 's.ts' : $safeTitle . '.ts';

header('Content-Type: video/mp2t');
header('Content-Disposition: attachment; filename="' . $fileName . '"');
header('Content-Transfer-Encoding: binary');
header('X-Stream-Index: ' . $workingStreamIdx);
header('X-Total-Segments: ' . $totalSegments);
header('X-Download-Segments: ' . count($workingSegments));
header('X-Duration: ' . round($totalDuration) . 's');
header('X-Resolution: ' . $bestResolution);
header('X-Bandwidth: ' . $bestBandwidth);

if (ob_get_level()) ob_end_clean();

// Descargar segmentos
$downloaded = 0;
foreach ($workingSegments as $i => $seg) {
    $data = curlGet($seg['url'], 20);
    if ($data && strlen($data) > 0) {
        echo $data;
        $downloaded++;
    }
    
    if ($i % 20 === 0) flush();
}
?>