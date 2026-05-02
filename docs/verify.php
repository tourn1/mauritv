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
    $resultados = [];
    
    // Si se especificó el tipo, probar solo ese
    if ($type) {
        $url = buildApiUrl($id, $type, $season, $episode);
        $resultado = consultarAPI($url);
        $resultado['tipo_probado'] = $type;
        return $resultado;
    }
    
    // 1. Probar como película
    $urlMovie = buildApiUrl($id, 'movie');
    $resultadoMovie = consultarAPI($urlMovie);
    $resultadoMovie['tipo_probado'] = 'movie';
    
    if ($resultadoMovie['disponible']) {
        return $resultadoMovie;
    }
    
    // 2. Probar como serie (sin season/episode, la API puede devolver datos generales)
    $urlTV = buildApiUrl($id, 'tv');
    $resultadoTV = consultarAPI($urlTV);
    $resultadoTV['tipo_probado'] = 'tv';
    
    if ($resultadoTV['disponible']) {
        return $resultadoTV;
    }
    
    // 3. Probar como serie con S01E01 (algunas APIs requieren season/episode)
    $urlTV2 = buildApiUrl($id, 'tv', 1, 1);
    $resultadoTV2 = consultarAPI($urlTV2);
    $resultadoTV2['tipo_probado'] = 'tv_s01e01';
    
    if ($resultadoTV2['disponible']) {
        return $resultadoTV2;
    }
    
    // 4. Si la API devuelve datos aunque no tenga streams, verificar si tiene info
    if (!empty($resultadoTV['title'])) {
        return array_merge($resultadoTV, ['disponible' => true]);
    }
    
    // Devolver el último intento (tv con s01e01)
    return $resultadoTV2;
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
            'error' => "Error cURL: $error"
        ];
    }
    
    $data = json_decode($response, true);
    
    if (!$data) {
        return [
            'disponible' => false,
            'httpCode' => $httpCode,
            'error' => 'Respuesta no es JSON válido'
        ];
    }
    
    $statusCode = isset($data['status_code']) ? $data['status_code'] : null;
    $isSuccess = ($statusCode === '200' || $statusCode === 200);
    
    // Para series, verificar si tiene 'eps' (episodios) además de stream_urls
    $tieneStreams = isset($data['data']) && 
                    isset($data['data']['stream_urls']) && 
                    !empty($data['data']['stream_urls']);
    
    $tieneEpisodios = isset($data['data']) && 
                      isset($data['data']['eps']) && 
                      !empty($data['data']['eps']);
    
    $disponible = $isSuccess && ($tieneStreams || $tieneEpisodios);
    
    return [
        'disponible' => $disponible,
        'httpCode' => $httpCode,
        'api_status_code' => $statusCode,
        'tiene_streams' => $tieneStreams,
        'tiene_episodios' => $tieneEpisodios,
        'num_streams' => $tieneStreams ? count($data['data']['stream_urls']) : 0,
        'num_temporadas' => $tieneEpisodios ? count($data['data']['eps']) : 0,
        'title' => $data['data']['title'] ?? null,
        'media_type' => $data['data']['type'] ?? ($tieneEpisodios ? 'tv' : 'movie'),
        'error' => null,
        'raw_data' => $data['data'] ?? null
    ];
}

$resultado = verificarAPIStreaming($id, $type, $season, $episode);
$resultado['id'] = $id;
$resultado['timestamp'] = date('Y-m-d H:i:s');
$resultado['url_verificada'] = "https://streamimdb.ru/embed/movie/$id";

// Limpiar datos crudos para no sobrecargar la respuesta
unset($resultado['raw_data']);

http_response_code(200);
echo json_encode($resultado, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
?>