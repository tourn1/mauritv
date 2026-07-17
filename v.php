<?php
$allowedOrigins = [
    	'https://mauritv.tourn1.com',
    	'https://www.mauritv.tourn1.com',
    	'http://localhost',
    	'http://127.0.0.1',
	'https://tourn1.page.gd/',
	'https://www.tourn1.page.gd/',
	'file:///Users/mauriciotourn/Documents/DESARROLLOS/PERSONAL/mauritv/index.html',
	'file:///Users/mauriciotourn/Documents/DESARROLLOS/PERSONAL/mauritv/content.html'
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

$id = isset($_GET['id']) && !empty($_GET['id']) ? $_GET['id'] : 'tt0371746';
$type = isset($_GET['type']) && !empty($_GET['type']) ? $_GET['type'] : 'movie';

$api_url = "https://streamdata.vaplayer.ru/api.php?imdb=" . $id . "&type=" . $type;

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

$data = json_decode($response, true);
echo json_encode($data, JSON_UNESCAPED_SLASHES);
?>