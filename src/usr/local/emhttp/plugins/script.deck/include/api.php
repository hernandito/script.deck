<?php
/*
 * Script Deck - JSON API used by the page.
 * Reads:  GET  ?a=list | log&id= | icons | icon&f= | script&id= | cats
 * Writes: POST a=run|stop|save|pin|saveScript|clearLog|upload|cats|ui  (Unraid checks csrf_token on POST)
 *
 * Running and stopping deliberately reuse the original User Scripts plugin's
 * own mechanism (its tmpScripts copy, backgroundScript.sh / startBackground.php,
 * running/ and finished/ markers), so its page and logs stay in sync.
 */
require_once __DIR__ . '/lib.php';

function out($data, $code = 200) {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
  exit;
}
function fail($msg, $code = 400) { out(['ok' => false, 'error' => $msg], $code); }
function need_id() {
  $id = $_REQUEST['id'] ?? '';
  if (!sd_valid_id($id)) fail('Unknown script');
  return $id;
}
function need_post() { if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST required', 405); }

$a = $_REQUEST['a'] ?? '';

switch ($a) {

  case 'list':
    out(['ok' => true] + sd_list());

  case 'log': {
    $id = need_id();
    sd_archive($id);
    out(['ok' => true, 'runs' => sd_all_runs($id), 'running' => sd_running_pid($id) > 0, 'history' => sd_hist_ok(), 'now' => time()]);
  }

  case 'icons':
    $uploads = [];
    foreach (glob(SD_ICONS . '/*.{png,svg,jpg,jpeg,webp,gif}', GLOB_BRACE) ?: [] as $f) $uploads[] = basename($f);
    out(['ok' => true, 'docker' => sd_docker_icons(), 'plugins' => sd_plugin_icons(), 'fa' => sd_fa_icons(), 'uploads' => $uploads]);

  case 'icon': {
    $f = basename($_GET['f'] ?? '');
    $path = SD_ICONS . "/$f";
    if ($f === '' || !is_file($path)) { http_response_code(404); exit; }
    $types = ['png' => 'image/png', 'svg' => 'image/svg+xml', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp', 'gif' => 'image/gif'];
    $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
    header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
    header('Cache-Control: max-age=86400');
    if ($ext === 'svg') header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'");
    readfile($path);
    exit;
  }

  case 'script': {
    $id = need_id();
    out(['ok' => true, 'text' => str_replace("\r", '', (string)file_get_contents(SD_SCRIPTS . "/$id/script"))]);
  }

  case 'run': {
    need_post();
    $id = need_id();
    if (sd_running_pid($id)) fail('Already running');
    $path = SD_SCRIPTS . "/$id/script";
    $vars = sd_script_vars($id);
    $ini = @parse_ini_file('/var/local/emhttp/var.ini');
    if ($vars['arrayStarted'] && ($ini['mdState'] ?? '') !== 'STARTED') fail('This script needs the array to be started');
    // Same preparation as the original plugin's "convertScript".
    $tmp = SD_TMP . "/tmpScripts/$id/script";
    @mkdir(dirname($tmp), 0755, true);
    @mkdir(SD_TMP . '/running', 0755, true);
    @mkdir(SD_TMP . '/finished', 0755, true);
    $body = str_replace("\r", '', (string)file_get_contents($path));
    if (strpos($body, '#!') !== 0) $body = "#!/bin/bash\n" . $body;
    // A script that asks a question (#argumentDescription=...) gets the answer as $1 $2 ...
    // User Scripts appends #argumentDefault to the command line; "set --" replaces that for this run.
    if (isset($_POST['args']) && $vars['argumentDescription'] !== '' && !$vars['directPHP'] && preg_match('#^\#!\S*(bash|sh)\b#', $body)) {
      $words = preg_split('/\s+/', trim(mb_substr((string)$_POST['args'], 0, 500)), -1, PREG_SPLIT_NO_EMPTY);
      $set = 'set -- ' . implode(' ', array_map('escapeshellarg', $words)) . "   # answer given in Script Deck\n";
      // after the header comments, so User Scripts still reads its #variables
      $lines = explode("\n", $body);
      $at = count($lines);
      foreach ($lines as $i => $l) if ($i > 0 && trim($l) !== '' && $l[0] !== '#') { $at = $i; break; }
      array_splice($lines, $at, 0, [rtrim($set)]);
      $body = implode("\n", $lines);
    }
    file_put_contents($tmp, $body);
    chmod($tmp, 0755);
    // Same launcher the original "Run In Background" button uses.
    exec('/usr/local/emhttp/plugins/user.scripts/backgroundScript.sh ' . escapeshellarg($tmp) . ' > /dev/null 2>&1');
    exec('logger ' . escapeshellarg("Script Deck: started '$id' in the background"));
    out(['ok' => true]);
  }

  case 'stop': {
    need_post();
    $id = need_id();
    $pid = sd_running_pid($id);
    if (!$pid) fail('Not running');
    // Mirrors the original plugin's "abortScript".
    exec('pkill -TERM -P ' . (int)$pid);
    exec('kill -9 ' . (int)$pid);
    $ps = [];
    exec('ps -eo pid,args', $ps);
    foreach ($ps as $line) {
      if (strpos($line, SD_TMP . "/tmpScripts/$id/") !== false && preg_match('/^\s*(\d+)/', $line, $m)) exec('kill -9 ' . (int)$m[1]);
    }
    @unlink(SD_TMP . "/running/$id");
    file_put_contents(SD_TMP . "/finished/$id", 'aborted');
    file_put_contents(sd_log_file($id), "Execution was aborted by user\n\n", FILE_APPEND);
    exec('logger ' . escapeshellarg("Script Deck: stopped '$id'"));
    out(['ok' => true]);
  }

  case 'save': {
    need_post();
    $id = need_id();
    $dir = SD_SCRIPTS . "/$id";
    if (isset($_POST['title'])) {
      $title = sd_sanitize_title($_POST['title']);
      if (sd_plain($title) === '') fail('The title cannot be empty');
      file_put_contents("$dir/name", $title);
    }
    if (isset($_POST['desc'])) file_put_contents("$dir/description", trim((string)$_POST['desc']));
    $cards = sd_json_read(SD_CARDS, []);
    $card = $cards[$id] ?? [];
    if (isset($_POST['icon'])) {
      $icon = json_decode((string)$_POST['icon'], true);
      if (!$icon || empty($icon['t'])) unset($card['icon']);
      elseif ($icon['t'] === 'plugin') { $p = sd_valid_plugin_icon((string)$icon['v']); if ($p) $card['icon'] = ['t' => 'plugin', 'v' => $p]; }
      elseif (in_array($icon['t'], ['emoji', 'docker', 'fa', 'upload'], true)) $card['icon'] = ['t' => $icon['t'], 'v' => mb_substr((string)$icon['v'], 0, 64)];
    }
    if (isset($_POST['tint'])) $card['tint'] = preg_match('/^([a-z]{0,12}|#[0-9a-f]{6})$/i', $_POST['tint']) ? strtolower($_POST['tint']) : '';
    if (isset($_POST['bg'])) $card['bg'] = sd_hex($_POST['bg']);
    if (isset($_POST['pinned'])) $card['pinned'] = $_POST['pinned'] === '1';
    if (isset($_POST['pinHide'])) $card['pinHide'] = $_POST['pinHide'] === '1';
    if (empty($card['pinned'])) unset($card['pinHide']);   // unpinned: back in its category
    if (isset($_POST['askFirst'])) $card['askFirst'] = $_POST['askFirst'] === '1';
    $cards[$id] = array_filter($card, function ($v) { return $v !== '' && $v !== false && $v !== null; });
    if (!$cards[$id]) unset($cards[$id]);
    sd_json_write(SD_CARDS, $cards);
    if (isset($_POST['category'])) {                    // move to another category ('' = none)
      $raw = sd_cats_raw();
      $key = 'name' . sd_element($id);
      sd_cats_unassign($raw, $key);
      if ($_POST['category'] !== '') sd_cats_assign($raw, $_POST['category'], $key);
      sd_cats_write($raw);
    }
    out(['ok' => true]);
  }

  case 'cron': {                                         // preview a cron expression
    $expr = trim(preg_replace('/\s+/', ' ', (string)($_GET['expr'] ?? '')));
    if (!sd_valid_cron($expr)) out(['ok' => true, 'valid' => false]);
    $next = []; $t = time();
    for ($i = 0; $i < 3 && ($t = sd_cron_next($expr, $t)); $i++) $next[] = $t;
    out(['ok' => true, 'valid' => true, 'text' => sd_cron_text($expr), 'next' => $next]);
  }

  case 'schedule': {
    need_post();
    $id = need_id();
    $freq = (string)($_POST['frequency'] ?? '');
    $custom = trim(preg_replace('/\s+/', ' ', (string)($_POST['custom'] ?? '')));
    if (!in_array($freq, SD_FREQS, true)) fail('Unknown schedule');
    if ($freq === 'custom' && !sd_valid_cron($custom)) fail('That custom schedule is not a valid cron line (5 fields: minute hour day month weekday)');
    sd_save_schedule($id, $freq, $custom);
    exec('logger ' . escapeshellarg("Script Deck: schedule of '$id' set to $freq" . ($freq === 'custom' ? " ($custom)" : '')));
    out(['ok' => true]);
  }

  case 'pin': {
    need_post();
    $id = need_id();
    $cards = sd_json_read(SD_CARDS, []);
    $cards[$id]['pinned'] = ($_POST['pinned'] ?? '') === '1';
    if (!$cards[$id]['pinned']) unset($cards[$id]['pinned'], $cards[$id]['pinHide']);   // unpinned: back in its category
    if (!$cards[$id]) unset($cards[$id]);
    sd_json_write(SD_CARDS, $cards);
    out(['ok' => true]);
  }

  case 'cats': {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
      $list = [];
      foreach (sd_categories() as $c) if ($c['parent'] === null) $list[] = ['id' => $c['id'], 'name' => $c['name'], 'count' => count($c['keys'])];
      out(['ok' => true, 'cats' => $list, 'shared' => is_dir(SD_ENH_DIR)]);
    }
    // POST: the full new list of top-level categories, in order: [{id|null, name}]
    $new = json_decode((string)($_POST['cats'] ?? ''), true);
    if (!is_array($new)) fail('Bad category list');
    $raw = sd_cats_raw();
    $byId = [];
    foreach ($raw as $c) $byId[(string)($c['id'] ?? '')] = $c;
    $out = []; $order = 1;
    foreach ($new as $n) {
      $name = trim(preg_replace('/\s+/u', ' ', (string)($n['name'] ?? '')));
      if ($name === '') continue;
      $id = (string)($n['id'] ?? '');
      if ($id !== '' && isset($byId[$id])) {
        $c = $byId[$id];
        // Only replace the stored name if it was really changed (keeps Enhanced's formatting).
        if (sd_category_name($c['name'] ?? '') !== $name) $c['name'] = htmlspecialchars($name, ENT_QUOTES, 'UTF-8');
        unset($byId[$id]);
      } else {
        $c = ['id' => (string)round(microtime(true) * 1000) . $order, 'name' => htmlspecialchars($name, ENT_QUOTES, 'UTF-8'), 'expanded' => 'yes',
              'view_mode' => 'panel', 'subcategory_position' => 'default', 'scripts' => [], 'custom_class' => '', 'subcategories' => []];
      }
      $c['order'] = $order++;
      $out[] = $c;
    }
    // Categories left out were deleted: their scripts simply become uncategorised.
    sd_cats_write($out);
    out(['ok' => true]);
  }

  case 'ui': {
    need_post();
    $ui = sd_json_read(SD_UI, ['shut' => []]);
    if (isset($_POST['shut'])) {
      $shut = json_decode((string)$_POST['shut'], true);
      if (is_array($shut)) $ui['shut'] = array_filter($shut, function ($v) { return $v === true; });
    }
    if (isset($_POST['emoji'])) $ui['emoji'] = $_POST['emoji'] === 'system' ? 'system' : '';
    if (isset($_POST['fmt'])) $ui['fmt'] = in_array($_POST['fmt'], ['html', 'plain'], true) ? $_POST['fmt'] : '';
    if (isset($_POST['badges'])) $ui['badges'] = $_POST['badges'] !== '0';   // counts on the category buttons
    if (isset($_POST['other'])) {                       // the "Other" category: its name and position
      $o = json_decode((string)$_POST['other'], true);
      if (is_array($o)) {
        $name = trim(preg_replace('/\s+/u', ' ', (string)($o['name'] ?? '')));
        $ui['other'] = ['name' => $name !== '' ? mb_substr($name, 0, 60) : 'Other',
                        'pos' => isset($o['pos']) && is_numeric($o['pos']) ? max(0, (int)$o['pos']) : null];
      }
    }
    sd_json_write(SD_UI, $ui, 0);
    out(['ok' => true]);
  }

  case 'order': {                                        // arrange the tiles of one section
    need_post();
    $sec = (string)($_POST['sec'] ?? '');
    $ids = json_decode((string)($_POST['ids'] ?? ''), true);
    if (!is_array($ids)) fail('Bad order');
    $ids = array_values(array_filter($ids, 'sd_valid_id'));
    if ($sec === 'pinned' || $sec === 'other') {         // Script Deck's own sections
      $ui = sd_json_read(SD_UI, []);
      $ui['order'][$sec] = $ids;
      sd_json_write(SD_UI, $ui, 0);
    } elseif (strpos($sec, 'c') === 0) {                 // a real category: shared with Enhanced
      $raw = sd_cats_raw();
      if (!sd_cats_reorder($raw, substr($sec, 1), array_map(function ($id) { return 'name' . sd_element($id); }, $ids))) fail('Unknown category');
      sd_cats_write($raw);
    } else fail('Unknown section');
    out(['ok' => true]);
  }

  case 'saveScript': {
    need_post();
    $id = need_id();
    $text = (string)($_POST['text'] ?? '');
    if (trim($text) === '') fail('The script is empty');
    $f = SD_SCRIPTS . "/$id/script";
    copy($f, SD_CFG . '/last-edit-backup.sh');   // one-step undo, on the flash drive
    file_put_contents($f, str_replace("\r", '', $text));
    out(['ok' => true]);
  }

  case 'clearLog': {
    need_post();
    $id = need_id();
    if (sd_running_pid($id)) fail('Stop the script before clearing its log');
    @unlink(sd_log_file($id));
    out(['ok' => true]);
  }

  case 'upload': {
    need_post();
    $data = (string)($_POST['data'] ?? '');
    if (!preg_match('#^data:image/(png|svg\+xml|jpeg|webp|gif);base64,(.+)$#', $data, $m)) fail('Use a PNG, SVG, JPG, WEBP or GIF image');
    $bin = base64_decode($m[2], true);
    if ($bin === false || strlen($bin) > 262144) fail('Images must be under 256 KB');
    $ext = ['png' => 'png', 'svg+xml' => 'svg', 'jpeg' => 'jpg', 'webp' => 'webp', 'gif' => 'gif'][$m[1]];
    if ($ext === 'svg' && preg_match('/<script|on\w+\s*=|javascript:/i', $bin)) fail('That SVG contains scripts');
    @mkdir(SD_ICONS, 0755, true);
    $name = substr(sha1($bin), 0, 12) . ".$ext";
    file_put_contents(SD_ICONS . "/$name", $bin);
    out(['ok' => true, 'file' => $name]);
  }
}

fail('Unknown action');
