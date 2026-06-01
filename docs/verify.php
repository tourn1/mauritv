<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

if (!isset($_GET['id']) || empty($_GET['id'])) {
    http_response_code(400);
    echo json_encode(['disponible' => false, 'error' => 'ID requerido']);
    exit();
}

$id = $_GET['id'];
$type = isset($_GET['type']) ? $_GET['type'] : null; // 'movie' o 'tv'
$season = isset($_GET['season']) ? intval($_GET['season']) : null;
$episode = isset($_GET['episode']) ? intval($_GET['episode']) : null;

if (!preg_match('/^tt\d{5,}$/', $id)) {
    http_response_code(400);
    echo json_encode(['disponible' => false, 'error' => 'Formato inválido']);
    exit();
}

/**
 * Verifica la API de streaming - primero prueba como película, luego como serie
 */
function verificarAPIStreaming($id, $type = null, $season = null, $episode = null) {
    $attempts = [];
    $tests = [];

    if ($type) {
        $tests[] = ['type' => $type, 'season' => $season, 'episode' => $episode, 'label' => $type];
    } else {
        $tests[] = ['type' => 'movie', 'season' => null, 'episode' => null, 'label' => 'movie'];
        $tests[] = ['type' => 'tv', 'season' => null, 'episode' => null, 'label' => 'tv'];
        $tests[] = ['type' => 'tv', 'season' => 1, 'episode' => 1, 'label' => 'tv_s01e01'];
    }

    foreach ($tests as $index => $test) {
        $url = buildApiUrl($id, $test['type'], $test['season'], $test['episode']);
        $resultado = consultarAPI($url);
        $resultado['tipo_probado'] = $test['label'];
        $resultado['api_url'] = $url;
        $attempts[] = $resultado;

        if ($resultado['disponible']) {
            return array_merge($resultado, [
                'attempts' => $attempts,
                'used_attempt' => $index
            ]);
        }
    }

    if (isset($attempts[1]) && !empty($attempts[1]['title'])) {
        return array_merge($attempts[1], [
            'disponible' => true,
            'attempts' => $attempts,
            'used_attempt' => 1
        ]);
    }

    return array_merge(end($attempts), [
        'attempts' => $attempts,
        'used_attempt' => count($attempts) - 1
    ]);
}

function buildApiUrl($id, $type, $season = null, $episode = null) {
    $url = "https://streamdata.vaplayer.ru/api.php?imdb=" . urlencode($id) . "&type=" . $type;
    
    if ($type === 'tv' && $season && $episode) {
        $url .= "&season=" . $season . "&episode=" . $episode;
    }
    
    return $url;
}

function consultarAPI($url) {
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        CURLOPT_HTTPHEADER => [
            'Accept: application/json, text/javascript, */*; q=0.01',
            'Accept-Language: es-ES,es;q=0.9,en;q=0.8',
            'Referer: https://brightpathsignals.com/embed/movie/' . basename($url),
            'Origin: https://brightpathsignals.com',
            'X-Requested-With: XMLHttpRequest'
        ]
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error) {
        return [
            'disponible' => false,
            'httpCode' => 0,
            'error' => "Error cURL: $error",
            'raw_response' => null,
            'raw_data' => null
        ];
    }
    
    $data = json_decode($response, true);
    
    if (!$data) {
        return [
            'disponible' => false,
            'httpCode' => $httpCode,
            'error' => 'Respuesta no es JSON válido',
            'raw_response' => $response,
            'raw_data' => null
        ];
    }
    
    $rawData = isset($data['data']) && is_array($data['data']) ? $data['data'] : [];
    $streamUrls = isset($rawData['stream_urls']) && is_array($rawData['stream_urls']) ? $rawData['stream_urls'] : [];
    $tieneStreams = !empty($streamUrls);
    $tieneEpisodios = isset($rawData['eps']) && !empty($rawData['eps']);
    $statusCode = isset($data['status_code']) ? $data['status_code'] : null;
    $isSuccess = ($statusCode === '200' || $statusCode === 200);
    $disponible = $isSuccess && ($tieneStreams || $tieneEpisodios);

    return [
        'disponible' => $disponible,
        'httpCode' => $httpCode,
        'api_status_code' => $statusCode,
        'tiene_streams' => $tieneStreams,
        'tiene_episodios' => $tieneEpisodios,
        'num_streams' => count($streamUrls),
        'num_temporadas' => $tieneEpisodios ? count($rawData['eps']) : 0,
        'title' => $rawData['title'] ?? null,
        'imdb_id' => $rawData['imdb_id'] ?? null,
        'file_name' => $rawData['file_name'] ?? null,
        'backdrop' => $rawData['backdrop'] ?? null,
        'season' => $rawData['season'] ?? null,
        'episode' => $rawData['episode'] ?? null,
        'media_type' => $rawData['type'] ?? ($tieneEpisodios ? 'tv' : 'movie'),
        'stream_urls' => $streamUrls,
        'stream_url' => count($streamUrls) === 1 ? $streamUrls[0] : null,
        'sources' => buildStreamSources($streamUrls, $rawData),
        'error' => null,
        'raw_response' => $data,
        'raw_data' => $rawData
    ];
}

function buildStreamSources(array $streamUrls, array $rawData = []) {
    $sources = [];

    foreach ($streamUrls as $streamUrl) {
        $quality = detectStreamQuality($streamUrl, $rawData['file_name'] ?? null);
        $sources[] = [
            'url' => $streamUrl,
            'type' => detectStreamType($streamUrl),
            'quality' => $quality,
            'label' => $quality ?: 'auto',
            'provider' => parse_url($streamUrl, PHP_URL_HOST) ?: null
        ];
    }

    return $sources;
}

function detectStreamType($url) {
    $path = parse_url($url, PHP_URL_PATH) ?: '';
    $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    
    if ($extension === 'm3u8') {
        return 'hls';
    }
    if ($extension === 'mpd') {
        return 'dash';
    }

    return 'direct';
}

function detectStreamQuality($url, $fileName = null) {
    $qualities = ['2160p', '1080p', '720p', '480p', '360p', '240p'];
    $haystack = strtolower($url . ' ' . ($fileName ?? ''));

    foreach ($qualities as $quality) {
        if (strpos($haystack, strtolower($quality)) !== false) {
            return $quality;
        }
    }

    return 'auto';
}

$resultado = verificarAPIStreaming($id, $type, $season, $episode);
$resultado['id'] = $id;
$resultado['timestamp'] = date('Y-m-d H:i:s');
$resultado['url_verificada'] = "https://streamimdb.ru/embed/movie/$id";
$resultado['api_endpoint'] = $resultado['api_url'] ?? null;

$embedUrl = "https://streamimdb.ru/embed/movie/$id";
if (strpos($resultado['tipo_probado'] ?? '', 'tv') !== false) {
    $embedUrl = "https://streamimdb.ru/embed/tv/$id";
    if (!empty($resultado['season']) && !empty($resultado['episode'])) {
        $embedUrl .= "/{$resultado['season']}/{$resultado['episode']}/";
    }
}
$resultado['embed_url'] = $embedUrl;

http_response_code(200);
echo json_encode($resultado, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
?>