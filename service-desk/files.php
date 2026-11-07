<?php
/**
 * LLCT Service Desk — customer document files on this server.
 *
 * Files are saved in  files/<Customer name>/<Document type>/<id>_<file name>
 * The files folder is closed to the web (files/.htaccess); files are only given out through this script.
 *
 * Who may do what is decided by Firestore itself: this script asks Firestore for the client's service link
 * (and the document) with the caller's own rights — the client link token, or the signed-in staff member's
 * Firebase ID token. If Firestore says no, this script says no.
 *
 *   files.php?a=ping                                   → {"ok":true}            (the desk checks this exists)
 *   POST files.php?a=up   t=<link> d=<doc id> type=<label> file=<file>   → {"ok":true,"path":"…"}
 *   GET  files.php?a=get&t=<link>&d=<doc id>           → the file
 *   POST files.php?a=del  t=<link> d=<doc id>          → removes the file once its Firestore document is gone
 *   GET  files.php?a=usage                             → staff only: space used per customer
 * Staff send their Firebase ID token in the header  X-Id-Token.
 */
declare(strict_types=1);
header('X-Content-Type-Options: nosniff');
const MAX_BYTES = 25 * 1024 * 1024;           // 25 MB per file
$ROOT = __DIR__ . '/files';

function out($code, $data) { http_response_code($code); header('Content-Type: application/json'); header('Cache-Control: no-store'); echo json_encode($data); exit; }
function fail($code, $msg) { out($code, ['ok' => false, 'error' => $msg]); }

// ---- Firebase project (API key + project id): from config.php if present, else read once from the web app's config.js
function fbConfig() {
  global $ROOT;
  if (is_file(__DIR__ . '/config.php')) { $c = include __DIR__ . '/config.php'; if (!empty($c['apiKey'])) return $c; }
  $cache = $ROOT . '/.fbconfig.json';
  if (is_file($cache) && ($c = json_decode((string) file_get_contents($cache), true)) && !empty($c['apiKey'])) return $c;
  foreach (['https://anwar3000.github.io/llct-att/js/config.js', 'https://anwar3000.github.io/llct-invoice/js/config.js'] as $u) {
    $js = http('GET', $u)['body'] ?? '';
    if (preg_match("/[\"']?apiKey[\"']?\s*:\s*[\"']([^\"']+)/", $js, $k) && preg_match("/[\"']?projectId[\"']?\s*:\s*[\"']([^\"']+)/", $js, $p)) {
      $c = ['apiKey' => $k[1], 'projectId' => $p[1]];
      @file_put_contents($cache, json_encode($c));
      return $c;
    }
  }
  fail(500, 'Firebase config not found: this server could not read ' . (function_exists('curl_init') || ini_get('allow_url_fopen') ? 'the web app config' : 'the web (install php-curl)') . ' — create config.php (see README).');
}
function http($method, $url, $headers = []) {
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 20]);
    $body = curl_exec($ch); $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    return ['code' => $code, 'body' => (string) $body];
  }
  $ctx = stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", $headers), 'ignore_errors' => true, 'timeout' => 20]]);
  $body = @file_get_contents($url, false, $ctx); $code = 0;
  foreach ($http_response_header ?? [] as $h) if (preg_match('#^HTTP/\S+ (\d+)#', $h, $m)) $code = (int) $m[1];
  return ['code' => $code, 'body' => (string) $body];
}
/** Read a Firestore document as the caller. Returns [status, fields as plain PHP values]. */
function fsGet($path) {
  $c = fbConfig();
  $url = ($c['fsBase'] ?? 'https://firestore.googleapis.com/v1') . '/projects/' . rawurlencode($c['projectId']) . '/databases/(default)/documents/' . $path . '?key=' . rawurlencode($c['apiKey']);
  $h = []; $tok = $_SERVER['HTTP_X_ID_TOKEN'] ?? '';
  if ($tok !== '') $h[] = 'Authorization: Bearer ' . $tok;
  $r = http('GET', $url, $h);
  if ($r['code'] !== 200) return [$r['code'] ?: 500, null];
  $j = json_decode($r['body'], true); $f = [];
  foreach (($j['fields'] ?? []) as $k => $v) $f[$k] = is_array($v) ? (array_values($v)[0] ?? null) : null;
  return [200, $f];
}
function cleanName($s, $fallback) {
  $s = preg_replace('/[^\p{L}\p{N} ._&()\-]+/u', ' ', (string) $s);
  $s = trim(preg_replace('/\s+/', ' ', $s), " .");
  return $s === '' ? $fallback : mb_substr($s, 0, 80);
}
function token($k) { $v = (string) ($_REQUEST[$k] ?? ''); if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $v)) fail(400, "Bad $k"); return $v; }
/** The service link, read with the caller's rights (client: active link; staff: any link). */
function portal($t) { [$st, $p] = fsGet('svcPortals/' . $t); if ($st !== 200) fail(403, 'This service link is not valid.'); return $p; }
function folderOf($p) { return cleanName($p['clientName'] ?? '', 'Customer ' . substr((string) ($p['clientId'] ?? 'unknown'), 0, 8)); }
function inRoot($path) { global $ROOT; $r = realpath($ROOT); $p = realpath($path); return $r && $p && strpos($p, $r . DIRECTORY_SEPARATOR) === 0; }
function findFile($dir, $d) { foreach (glob($dir . '/*/' . $d . '_*') ?: [] as $f) if (is_file($f)) return $f; return null; }

if (!is_dir($ROOT) && !@mkdir($ROOT, 0775, true)) fail(500, 'Cannot create the files folder — make it writable for the web server (see README).');
if (!is_file($ROOT . '/.htaccess')) @file_put_contents($ROOT . '/.htaccess', "Require all denied\nDeny from all\n");

$a = $_REQUEST['a'] ?? '';
if ($a === 'ping') out(200, ['ok' => true, 'max' => MAX_BYTES, 'writable' => is_writable($ROOT)]);

if ($a === 'up') {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POST only');
  $t = token('t'); $d = token('d');
  $p = portal($t);
  $f = $_FILES['file'] ?? null;
  if (!$f || ($f['error'] ?? 1) !== UPLOAD_ERR_OK) fail(400, ($f && in_array($f['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) ? 'The file is larger than the server allows (see README: upload_max_filesize).' : 'No file received.');
  if ($f['size'] > MAX_BYTES) fail(413, 'The file is larger than 25 MB.');
  $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
  if (in_array($ext, ['php', 'phtml', 'phar', 'php3', 'php4', 'php5', 'php7', 'pht', 'cgi', 'pl', 'py', 'sh', 'exe', 'js', 'html', 'htm', 'svg'], true)) fail(415, 'This kind of file is not accepted.');
  $dir = $ROOT . '/' . folderOf($p) . '/' . cleanName($_POST['type'] ?? '', 'Documents');
  if (!is_dir($dir) && !@mkdir($dir, 0775, true)) fail(500, 'Cannot create the customer folder.');
  $name = $d . '_' . cleanName(pathinfo((string) $f['name'], PATHINFO_FILENAME), 'file') . ($ext ? '.' . preg_replace('/[^a-z0-9]/', '', $ext) : '');
  if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $name)) fail(500, 'Could not save the file.');
  @chmod($dir . '/' . $name, 0664);
  out(200, ['ok' => true, 'path' => substr($dir . '/' . $name, strlen($ROOT) + 1), 'size' => (int) $f['size']]);
}

if ($a === 'get') {
  $t = token('t'); $d = token('d');
  $p = portal($t);
  [$st, $m] = fsGet('svcPortals/' . $t . '/docs/' . $d);
  if ($st !== 200) fail(404, 'Document not found.');
  $file = !empty($m['path']) ? $ROOT . '/' . $m['path'] : findFile($ROOT . '/' . folderOf($p), $d);
  if (!$file || !is_file($file) || !inRoot($file)) fail(404, 'File not found on the server.');
  $mime = (string) ($m['mime'] ?? '') ?: (function_exists('mime_content_type') ? (mime_content_type($file) ?: 'application/octet-stream') : 'application/octet-stream');
  $nice = preg_replace('/^' . preg_quote($d, '/') . '_/', '', basename($file));
  header('Content-Type: ' . $mime);
  header('Content-Length: ' . filesize($file));
  header('Content-Disposition: ' . (($_GET['dl'] ?? '') === '1' ? 'attachment' : 'inline') . '; filename="' . str_replace('"', '', $nice) . '"');
  header('Cache-Control: private, max-age=300');
  readfile($file); exit;
}

if ($a === 'del') {
  $t = token('t'); $d = token('d');
  $p = portal($t);
  [$st] = fsGet('svcPortals/' . $t . '/docs/' . $d);
  if ($st === 200) fail(409, 'Delete the document first.');  // only files whose Firestore document was deleted
  $file = findFile($ROOT . '/' . folderOf($p), $d);
  if ($file && inRoot($file)) @unlink($file);
  out(200, ['ok' => true]);
}

if ($a === 'usage') {
  if (($_SERVER['HTTP_X_ID_TOKEN'] ?? '') === '') fail(401, 'Staff only');
  [$st] = fsGet('settings/service');               // any signed-in staff member can read this
  if ($st !== 200 && $st !== 404) fail(403, 'Staff only');
  $res = []; $total = 0;
  foreach (glob($ROOT . '/*', GLOB_ONLYDIR) ?: [] as $cdir) {
    $n = 0; $bytes = 0;
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($cdir, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $fi) if ($fi->isFile()) { $n++; $bytes += $fi->getSize(); }
    $res[basename($cdir)] = ['files' => $n, 'bytes' => $bytes]; $total += $bytes;
  }
  $free = @disk_free_space($ROOT); $size = @disk_total_space($ROOT);
  out(200, ['ok' => true, 'customers' => $res, 'total' => $total, 'diskFree' => $free === false ? null : $free, 'diskSize' => $size === false ? null : $size]);
}

fail(400, 'Unknown action');
