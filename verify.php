<?php
$allowedOrigins = [
    	'https://mauritv.tourn1.com',
    	'https://www.mauritv.tourn1.com',
    	'http://localhost',
    	'http://127.0.0.1',
	'https://tourn1.page.gd/',
	'https://www.tourn1.page.gd/'
];

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';

if (in_array($origin, $allowedOrigins)) {
    header("Access-Control-Allow-Origin: " . $origin);
    header("Vary: Origin");
}
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, X-Requested-With");
header("Access-Control-Max-Age: 86400");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

header('Content-Type: application/json');

/**
 * Detecta la calidad del video desde el nombre del archivo
 */
function detectQuality($fileName) {
    if (empty($fileName)) return [
        'detalles' => 'Desconocido', 
        'fuente' => null, 
        'resolucion' => null,
        'codec' => null,
        'audio' => null,
        'grupo' => null
    ];
    
    $fileNameLower = strtolower($fileName);
    $info = [];
    
    // 1. FUENTE/FORMATO
    $sourceMap = [
        'CAM'        => [' cam ', '.cam.', 'camrip', 'hdcam', ' cam-', '-cam'],
        'TS'         => [' telesync', '.ts.', ' ts ', 'telesync', ' ts-', '-ts'],
        'TC'         => [' telecine', '.tc.', ' tc ', 'tc-', '-tc'],
        'SCR'        => [' screener', ' scr ', '.scr.', 'dvdscr', ' scr-', '-scr'],
        'R5'         => [' r5 ', '.r5.', 'r5rip', ' r5-', '-r5'],
        'DVD-Rip'    => ['dvdrip', 'dvd-rip', 'dvd rip'],
        'DVD'        => [' dvd5 ', ' dvd9 ', '.dvd.', ' dvd ', 'dvd5.', 'dvd9.'],
        'HD-Rip'     => ['hdrip', 'hd-rip', 'hd rip'],
        'BR-Rip'     => ['brrip', 'br-rip', 'br rip'],
        'BD-Rip'     => ['bdrip', 'bd-rip', 'bd rip'],
        'VHS-Rip'    => ['vhsrip', 'vhs-rip', 'vhs rip'],
        'TV-Rip'     => ['tvrip', 'tv-rip', 'tv rip'],
        'HDTV'       => ['hdtv', 'hd-tv'],
        'WEB-Rip'    => ['webrip', 'web-rip', 'web rip'],
        'WEB-DL'     => ['web-dl', 'web dl', 'webdl'],
        'BluRay'     => ['bluray', 'blu-ray', 'bdremux', 'bd50', 'bd25', 'bdmv'],
        'AMZN WEB'   => ['amzn web', 'amazon web', 'amzn.'],
        'NF WEB'     => ['nf web', 'netflix web', 'netflix.'],
        'DSNP WEB'   => ['dsnp web', 'disney web', 'disney+.', 'dsnp.'],
        'HMAX WEB'   => ['hmax web', 'hbo max', 'hbo.'],
        'ATVP WEB'   => ['atvp web', 'apple tv', 'atvp.'],
    ];
    
    foreach ($sourceMap as $label => $patterns) {
        foreach ($patterns as $pattern) {
            if (strpos($fileNameLower, $pattern) !== false) {
                $info['fuente'] = $label;
                break 2;
            }
        }
    }
    
    // Detectar fuente del grupo (ej: TS-OnlyFlix)
    if (empty($info['fuente'])) {
        if (preg_match('/\b(ts|cam|tc|scr)\b[-.]/i', $fileNameLower, $m)) {
            $sourceLabels = ['ts' => 'TS', 'cam' => 'CAM', 'tc' => 'TC', 'scr' => 'SCR'];
            $info['fuente'] = $sourceLabels[$m[1]] ?? strtoupper($m[1]);
        }
    }
    
    // 2. RESOLUCIÓN
    $resolutionMap = [
        '2160p (4K)' => ['2160p', '4k', 'uhd'],
        '1440p (2K)' => ['1440p', '2k'],
        '1080p'      => ['1080p', '1080 ', '.1080.', 'fhd', 'full hd'],
        '720p'       => ['720p', '720 ', '.720.', 'hd ', ' hd.'],
        '480p'       => ['480p', '480 ', '.480.', 'sd'],
        '360p'       => ['360p', '360 ', '.360.'],
    ];
    
    foreach ($resolutionMap as $label => $patterns) {
        foreach ($patterns as $pattern) {
            if (strpos($fileNameLower, $pattern) !== false) {
                $info['resolucion'] = $label;
                break 2;
            }
        }
    }
    
    // 3. CODEC
    $codecMap = [
        'H.265/HEVC' => ['hevc', 'h265', 'h.265', 'x265'],
        'H.264/AVC'  => ['avc', 'h264', 'h.264', 'x264'],
        'AV1'        => ['av1'],
        'XviD'       => ['xvid'],
    ];
    
    foreach ($codecMap as $label => $patterns) {
        foreach ($patterns as $pattern) {
            if (strpos($fileNameLower, $pattern) !== false) {
                $info['codec'] = $label;
                break 2;
            }
        }
    }
    
    // 4. AUDIO
    $audioMap = [
        'Atmos'    => ['atmos'],
        'DTS-HD'   => ['dts-hd', 'dtshd'],
        'DTS 5.1'  => ['dts', 'dts5.1'],
        'DDP 5.1'  => ['ddp5.1', 'ddp 5.1', 'eac3 5.1', 'e-ac3 5.1'],
        'DDP 2.0'  => ['ddp2.0', 'ddp 2.0'],
        'AC3 5.1'  => ['ac3', 'dd5.1', 'dd 5.1'],
        'AAC 2.0'  => ['aac'],
        'FLAC'     => ['flac'],
    ];
    
    foreach ($audioMap as $label => $patterns) {
        foreach ($patterns as $pattern) {
            if (strpos($fileNameLower, $pattern) !== false) {
                $info['audio'] = $label;
                break 2;
            }
        }
    }
    
    // 5. GRUPO
    $groups = ['YTS', 'YIFY', 'RARBG', 'FGT', 'EVO', 'GALAXY', 'MZABI', 'QXR', 'Tigole', 'UTR', 'OnlyFlix', 'ShinGod', 'NOGRP', 'UNiON'];
    
    foreach ($groups as $group) {
        if (stripos($fileName, $group) !== false) {
            $info['grupo'] = $group;
            break;
        }
    }
    
    // 6. ETIQUETA
    $partes = [];
    if (!empty($info['fuente'])) $partes[] = $info['fuente'];
    if (!empty($info['resolucion'])) $partes[] = $info['resolucion'];
    if (!empty($info['codec'])) $partes[] = $info['codec'];
    if (!empty($info['audio'])) $partes[] = $info['audio'];
    if (!empty($info['grupo'])) $partes[] = $info['grupo'];
    
    return [
        'detalles' => !empty($partes) ? implode(' / ', $partes) : 'No detectado',
        'fuente' => $info['fuente'] ?? null,
        'resolucion' => $info['resolucion'] ?? null,
        'codec' => $info['codec'] ?? null,
        'audio' => $info['audio'] ?? null,
        'grupo' => $info['grupo'] ?? null
    ];
}

$id = isset($_GET['id']) && !empty($_GET['id']) ? $_GET['id'] : 'tt0371746';
$type = isset($_GET['type']) && !empty($_GET['type']) ? $_GET['type'] : 'movie';

$api_url = "https://streamdata.vaplayer.ru/api.php?imdb=" . $id . "&type=" . $type;

$respuesta = [
    'status_code' => null,
    'disponible' => false,
    'file_name' => null,
    'source' => null,
    'resolution' => null,
    'calidad_detalles' => null,
    'codec' => null,
    'audio' => null,
    'grupo' => null,
    'default_subs' => null,
    'title' => null,
    'imdb_id' => null,
    'error' => null
];

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $api_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_TIMEOUT, 15);
curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Origin: https://nextgencloudfabric.com',
    'Referer: https://nextgencloudfabric.com/',
    'Accept: application/json'
]);

$response = curl_exec($ch);
curl_close($ch);

if ($response === false) {
    $respuesta['error'] = "Error de conexión";
    echo json_encode($respuesta, JSON_UNESCAPED_SLASHES);
    exit;
}

$data = json_decode($response, true);

if (json_last_error() !== JSON_ERROR_NONE) {
    $respuesta['error'] = "Error decodificando JSON";
    echo json_encode($respuesta, JSON_UNESCAPED_SLASHES);
    exit;
}

// Tomar status_code de la respuesta JSON (no del HTTP)
if (isset($data['status_code'])) {
    $respuesta['status_code'] = $data['status_code'];
}

// Verificar si la respuesta tiene datos
if (isset($data['data']) && is_array($data['data'])) {
    // Tomar el filename directamente de data->filename
    if (isset($data['data']['filename']) && !empty($data['data']['filename'])) {
        $respuesta['disponible'] = true;
        $respuesta['file_name'] = $data['data']['filename'];
        
        // Detectar calidad desde el nombre del archivo
        $calidad = detectQuality($data['data']['filename']);
        $respuesta['source'] = $calidad['fuente'];
        $respuesta['resolution'] = $calidad['resolucion'];
        $respuesta['calidad_detalles'] = $calidad['detalles'];
        $respuesta['codec'] = $calidad['codec'];
        $respuesta['audio'] = $calidad['audio'];
        $respuesta['grupo'] = $calidad['grupo'];
    }
    
    // Tomar title desde data->title
    if (isset($data['data']['title']) && !empty($data['data']['title'])) {
        $respuesta['title'] = $data['data']['title'];
    }
    
    // Tomar imdb_id desde data->imdb_id
    if (isset($data['data']['imdb_id']) && !empty($data['data']['imdb_id'])) {
        $respuesta['imdb_id'] = $data['data']['imdb_id'];
    }
}

// Buscar default_subs en la raíz de la respuesta (no dentro de data)
if (isset($data['default_subs']) && !empty($data['default_subs'])) {
    $respuesta['default_subs'] = $data['default_subs'];
}

// Si no se encontró en data->filename, intentar otras estructuras por compatibilidad
if (!$respuesta['disponible']) {
    if (isset($data['filename']) && !empty($data['filename'])) {
        $respuesta['disponible'] = true;
        $respuesta['file_name'] = $data['filename'];
        $calidad = detectQuality($data['filename']);
        $respuesta['source'] = $calidad['fuente'];
        $respuesta['resolution'] = $calidad['resolucion'];
        $respuesta['calidad_detalles'] = $calidad['detalles'];
        $respuesta['codec'] = $calidad['codec'];
        $respuesta['audio'] = $calidad['audio'];
        $respuesta['grupo'] = $calidad['grupo'];
    } elseif (isset($data['data']['file_name']) && !empty($data['data']['file_name'])) {
        $respuesta['disponible'] = true;
        $respuesta['file_name'] = $data['data']['file_name'];
        $calidad = detectQuality($data['data']['file_name']);
        $respuesta['source'] = $calidad['fuente'];
        $respuesta['resolution'] = $calidad['resolucion'];
        $respuesta['calidad_detalles'] = $calidad['detalles'];
        $respuesta['codec'] = $calidad['codec'];
        $respuesta['audio'] = $calidad['audio'];
        $respuesta['grupo'] = $calidad['grupo'];
    } elseif ($respuesta['status_code'] !== 200) {
        $respuesta['error'] = "La API devolvió status_code: " . $respuesta['status_code'];
    } else {
        $respuesta['error'] = "No se encontró el nombre del archivo en la respuesta";
    }
}

echo json_encode($respuesta, JSON_UNESCAPED_SLASHES);
?>