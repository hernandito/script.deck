<?php
/*
 * Script Deck - data layer.
 *
 * Reads everything from the original User Scripts plugin (scripts, names,
 * descriptions, schedule.json, logs, running state). Categories are shared with
 * User Scripts Enhanced (its categories.json, same format) so both pages agree;
 * without Enhanced, Script Deck keeps its own file in the same format.
 * Script Deck's own extras: /boot/config/plugins/script.deck/cards.json + ui.json.
 * Run history (so it survives reboots): /mnt/user/appdata/script.deck/history.
 */

const SD_US      = '/boot/config/plugins/user.scripts';
const SD_SCRIPTS = SD_US . '/scripts';
const SD_TMP     = '/tmp/user.scripts';
const SD_CFG     = '/boot/config/plugins/script.deck';
const SD_CARDS   = SD_CFG . '/cards.json';
const SD_UI      = SD_CFG . '/ui.json';
const SD_ICONS   = SD_CFG . '/icons';
const SD_ENH_DIR = '/boot/config/plugins/user.scripts.enhanced';
const SD_ENH     = SD_ENH_DIR . '/categories.json';
const SD_OWN_CATS = SD_CFG . '/categories.json';
const SD_HIST    = '/mnt/user/appdata/script.deck/history';
const SD_PLUGINS = '/usr/local/emhttp/plugins';
const SD_DOCKER_ICONS = '/usr/local/emhttp/state/plugins/dynamix.docker.manager/images';
const SD_FA_CSS  = '/usr/local/emhttp/webGui/styles/font-awesome.css';
const SD_KEEP_RUNS = 60;           // runs kept per script in history
const SD_RUN_MAX   = 262144;       // bytes of output kept per saved run

// Use the server's own time zone so log times and next-run times match Unraid.
(function () {
  $ini = @parse_ini_file('/var/local/emhttp/var.ini');
  $tz = $ini['timeZone'] ?? '';
  if ($tz === '' && is_link('/etc/localtime')) $tz = preg_replace('#^.*/zoneinfo/#', '', readlink('/etc/localtime'));
  if ($tz !== '' && in_array($tz, timezone_identifiers_list(), true)) date_default_timezone_set($tz);
})();

/* ---------- small helpers ---------- */

function sd_json_read($file, $default = []) {
  $d = @json_decode((string)@file_get_contents($file), true);
  return is_array($d) ? $d : $default;
}

function sd_json_write($file, $data, $flags = JSON_PRETTY_PRINT) {
  @mkdir(dirname($file), 0755, true);
  $tmp = $file . '.tmp';
  file_put_contents($tmp, json_encode($data, $flags | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
  rename($tmp, $file);
}

/** A script id is its folder name under SD_SCRIPTS. Reject anything else. */
function sd_valid_id($id) {
  if (!is_string($id) || $id === '' || $id === '.' || $id === '..') return false;
  if (strpbrk($id, "/\\\0") !== false) return false;
  return is_dir(SD_SCRIPTS . "/$id") && is_file(SD_SCRIPTS . "/$id/script");
}

/** Same element key the original plugin (and Enhanced) use: dots to dashes, no spaces. */
function sd_element($id) { return str_replace(' ', '', str_replace('.', '-', $id)); }

function sd_plain($html) {
  $html = preg_replace('/<br\s*\/?>/i', ' ', (string)$html);
  $t = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
  return trim(preg_replace('/\s+/u', ' ', $t));
}

function sd_hex($c) { return (is_string($c) && preg_match('/^#[0-9a-f]{6}$/i', $c)) ? strtolower($c) : ''; }

/** Leading emoji (with modifiers / ZWJ sequences), or ''. */
function sd_leading_emoji($text) {
  $re = '/^((?:[\x{1F000}-\x{1FAFF}]|[\x{2600}-\x{27BF}]|[\x{2B00}-\x{2BFF}]|[\x{2190}-\x{21FF}]|[\x{2300}-\x{23FF}])'
      . '(?:\x{FE0F}|\x{20E3}|[\x{1F3FB}-\x{1F3FF}]|\x{200D}(?:[\x{1F000}-\x{1FAFF}]|[\x{2600}-\x{27BF}])\x{FE0F}?)*)/u';
  return preg_match($re, ltrim((string)$text), $m) ? $m[1] : '';
}

/* ---------- title sanitising ----------
 * Titles are stored as small HTML in the script's `name` file (that is how the
 * original plugin and your existing titles work). Colour, bold, italic,
 * underline and line breaks survive; everything else is reduced to text.
 */
function sd_dom($html) {
  $doc = new DOMDocument();
  libxml_use_internal_errors(true);
  $doc->loadHTML('<?xml encoding="utf-8"?><div id="r">' . $html . '</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
  libxml_clear_errors();
  return $doc->getElementById('r');
}

function sd_sanitize_title($html) {
  $html = (string)$html;
  if (trim($html) === '') return '';
  $root = sd_dom($html);
  if (!$root) return htmlspecialchars(sd_plain($html), ENT_QUOTES, 'UTF-8');
  $out = sd_sanitize_node($root, ['color' => '', 'bold' => false, 'italic' => false, 'under' => false]);
  $out = preg_replace('/[ \t\r\n]+/u', ' ', $out);
  $out = preg_replace('/(\s*<br>\s*){3,}/', '<br><br>', $out);          // at most one empty line
  return trim(preg_replace('/^(\s*<br>)+|(<br>\s*)+$/', '', $out));
}

function sd_sanitize_node($node, $inh) {
  $out = '';
  foreach ($node->childNodes as $c) {
    if ($c->nodeType === XML_TEXT_NODE) {
      $t = htmlspecialchars($c->nodeValue, ENT_QUOTES, 'UTF-8');
      if ($t === '') continue;
      $st = [];
      if ($inh['color'])  $st[] = 'color:' . $inh['color'];
      if ($inh['bold'])   $st[] = 'font-weight:700';
      if ($inh['italic']) $st[] = 'font-style:italic';
      if ($inh['under'])  $st[] = 'text-decoration:underline';
      $out .= $st ? '<span style="' . implode(';', $st) . '">' . $t . '</span>' : $t;
      continue;
    }
    if ($c->nodeType !== XML_ELEMENT_NODE) continue;
    $tag = strtolower($c->nodeName);
    if (in_array($tag, ['script', 'style', 'img', 'iframe', 'object'])) continue;
    if ($tag === 'br') { $out .= '<br>'; continue; }
    $n = $inh;
    if ($tag === 'b' || $tag === 'strong') $n['bold'] = true;
    if ($tag === 'i' || $tag === 'em') $n['italic'] = true;
    if ($tag === 'u') $n['under'] = true;
    $col = $c->getAttribute('color');
    $style = strtolower($c->getAttribute('style'));
    if ($style !== '') {
      if (preg_match('/(?:^|;)\s*color\s*:\s*([^;]+)/', $style, $m)) $col = trim($m[1]);
      if (preg_match('/font-weight\s*:\s*(bold|[6-9]00)/', $style)) $n['bold'] = true;
      if (preg_match('/font-weight\s*:\s*(normal|[1-4]00)/', $style)) $n['bold'] = false;
      if (preg_match('/font-style\s*:\s*italic/', $style)) $n['italic'] = true;
      if (preg_match('/text-decoration[^;]*underline/', $style)) $n['under'] = true;
    }
    if ($col !== '' && preg_match('/^(#[0-9a-f]{3,8}|rgb\([\d\s,.%]+\)|[a-z]{3,20})$/i', trim($col))) $n['color'] = trim($col);
    $inner = sd_sanitize_node($c, $n);
    // A block element (the editor makes <div> for a new line) becomes a line break.
    if (in_array($tag, ['div', 'p']) && $out !== '' && substr($out, -4) !== '<br>') $out .= '<br>';
    $out .= $inner;
  }
  return $out;
}

/** Category display name: keep the main text, drop small "notes" written in tiny fonts. */
function sd_category_name($html) {
  $root = sd_dom((string)$html);
  if (!$root) return sd_plain($html);
  $text = '';
  $walk = function ($n) use (&$walk, &$text) {
    foreach ($n->childNodes as $c) {
      if ($c->nodeType === XML_TEXT_NODE) { $text .= $c->nodeValue; continue; }
      if ($c->nodeType !== XML_ELEMENT_NODE) continue;
      $style = strtolower($c->getAttribute('style'));
      if (preg_match('/font-size\s*:\s*(\d+)px/', $style, $m) && (int)$m[1] < 14) continue;
      if (in_array(strtolower($c->nodeName), ['i', 'em', 'small'])) continue;
      $walk($c);
    }
  };
  $walk($root);
  $t = trim(preg_replace('/\s+/u', ' ', $text));
  return rtrim($t, " -–—") ?: sd_plain($html);
}

/* ---------- logs ---------- */

function sd_log_file($id) { return SD_TMP . "/tmpScripts/$id/log.txt"; }

function sd_parse_time($s) {
  $d = DateTime::createFromFormat('M d, Y  H:i.s', trim($s));
  if (!$d) $d = DateTime::createFromFormat('M d, Y H:i.s', preg_replace('/\s+/', ' ', trim($s)));
  return $d ? $d->getTimestamp() : null;
}

/** Split a User Scripts log into runs: [start, end, aborted, from, to] (line offsets). */
function sd_parse_runs($text) {
  $runs = [];
  $lines = explode("\n", $text);
  foreach ($lines as $i => $line) {
    if (preg_match('/Script Starting (\w{3} \d{1,2}, \d{4}\s+\d{1,2}:\d{2}\.\d{2})/', $line, $m)) {
      if ($runs) $runs[count($runs) - 1]['to'] = $i - 1;
      $runs[] = ['start' => sd_parse_time($m[1]), 'end' => null, 'aborted' => false, 'from' => $i, 'to' => count($lines) - 1];
    } elseif ($runs && preg_match('/Script Finished (\w{3} \d{1,2}, \d{4}\s+\d{1,2}:\d{2}\.\d{2})/', $line, $m)) {
      $runs[count($runs) - 1]['end'] = sd_parse_time($m[1]);
    } elseif ($runs && strpos($line, 'Execution was aborted by user') !== false) {
      $runs[count($runs) - 1]['aborted'] = true;
    }
  }
  return $runs;
}

function sd_run_text($lines, $r) {
  $t = implode("\n", array_slice($lines, $r['from'], $r['to'] - $r['from'] + 1));
  if (strlen($t) > SD_RUN_MAX) $t = "… (earlier output trimmed)\n" . substr($t, -SD_RUN_MAX);
  return $t;
}

/** Last ~2 MB of a log is plenty and keeps huge logs from stalling the page. */
function sd_read_log($id, $max = 2097152) {
  $f = sd_log_file($id);
  if (!is_file($f)) return '';
  $size = filesize($f);
  $h = fopen($f, 'r');
  if ($size > $max) { fseek($h, -$max, SEEK_END); fgets($h); }
  $t = stream_get_contents($h);
  fclose($h);
  return str_replace("\r", '', $t);
}

/* ---------- run history (survives reboots) ---------- */

function sd_hist_ok() { return is_dir('/mnt/user/appdata') && is_writable('/mnt/user/appdata'); }
function sd_hist_dir($id) { return SD_HIST . '/' . rawurlencode($id); }

function sd_hist_index($id) {
  if (!sd_hist_ok()) return [];
  return sd_json_read(sd_hist_dir($id) . '/runs.json', []);
}

/** Copy every finished run of every script from the /tmp logs into history. */
function sd_archive_all() {
  if (!sd_hist_ok()) return 0;
  $saved = 0;
  foreach (@scandir(SD_TMP . '/tmpScripts') ?: [] as $id) {
    if ($id[0] === '.' || !is_file(sd_log_file($id))) continue;
    $saved += sd_archive($id);
  }
  return $saved;
}

function sd_archive($id) {
  $text = sd_read_log($id);
  if ($text === '') return 0;
  $runs = sd_parse_runs($text);
  if (!$runs) return 0;
  if (sd_running_pid($id)) array_pop($runs);           // still writing
  $runs = array_slice($runs, -SD_KEEP_RUNS);           // only the newest are kept anyway
  $dir = sd_hist_dir($id);
  $index = sd_json_read("$dir/runs.json", []);
  $have = [];
  foreach ($index as $r) $have[$r['start']] = true;
  $lines = explode("\n", $text);
  $added = 0;
  foreach ($runs as $r) {
    if (!$r['start'] || isset($have[$r['start']])) continue;
    if (!$r['end'] && !$r['aborted']) continue;          // unfinished (e.g. cut by a reboot)
    @mkdir($dir, 0755, true);
    file_put_contents("$dir/{$r['start']}.log", sd_run_text($lines, $r));
    $index[] = ['start' => $r['start'], 'end' => $r['end'], 'aborted' => $r['aborted']];
    $added++;
  }
  if (!$added) return 0;
  usort($index, function ($a, $b) { return $a['start'] <=> $b['start']; });
  while (count($index) > SD_KEEP_RUNS) { $old = array_shift($index); @unlink("$dir/{$old['start']}.log"); }
  sd_json_write("$dir/runs.json", $index, 0);
  return $added;
}

/** Archive at most once a minute when the page polls. */
function sd_archive_throttled() {
  $stamp = '/tmp/script.deck.archived';
  if (is_file($stamp) && time() - filemtime($stamp) < 60) return;
  touch($stamp);
  sd_archive_all();
}

/** Live runs from /tmp plus saved runs from history, oldest first, each with its text. */
function sd_all_runs($id, $limit = SD_KEEP_RUNS) {
  $text = sd_read_log($id);
  $lines = explode("\n", $text);
  $live = sd_parse_runs($text);
  $running = sd_running_pid($id) > 0;
  $out = [];
  foreach (sd_hist_index($id) as $r) $out[$r['start']] = $r + ['saved' => true];
  foreach ($live as $i => $r) {
    $out[$r['start'] ?: -$i] = ['start' => $r['start'], 'end' => $r['end'], 'aborted' => $r['aborted'], 'saved' => false,
      'live' => $running && $i === count($live) - 1, 'text' => sd_run_text($lines, $r)];
  }
  ksort($out);
  $out = array_slice(array_values($out), -$limit);
  foreach ($out as &$r) {
    if (!isset($r['text'])) $r['text'] = (string)@file_get_contents(sd_hist_dir($id) . "/{$r['start']}.log");
  }
  return $out;
}

/* ---------- running state ---------- */

function sd_running_pid($id) {
  $f = SD_TMP . "/running/$id";
  if (!is_file($f)) return 0;
  $pid = (int)trim((string)@file_get_contents($f));
  return ($pid > 0 && @posix_kill($pid, 0)) ? $pid : 0;
}

/* ---------- schedules ---------- */

function sd_runparts_times() {
  static $t = null;
  if ($t !== null) return $t;
  $t = ['hourly' => '47 * * * *', 'daily' => '40 4 * * *', 'weekly' => '30 4 * * 0', 'monthly' => '20 4 1 * *'];
  $tab = @file_get_contents('/var/spool/cron/crontabs/root');
  if ($tab) foreach (explode("\n", $tab) as $line) {
    if (preg_match('/^\s*(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+\S*run-parts\s+\/etc\/cron\.(hourly|daily|weekly|monthly)/', $line, $m)) $t[$m[2]] = $m[1];
  }
  return $t;
}

function sd_cron_field($f, $min, $max) {
  $set = [];
  foreach (explode(',', $f) as $part) {
    $step = 1;
    if (strpos($part, '/') !== false) { list($part, $step) = explode('/', $part, 2); $step = max(1, (int)$step); }
    if ($part === '*') { $a = $min; $b = $max; }
    elseif (strpos($part, '-') !== false) { list($a, $b) = array_map('intval', explode('-', $part, 2)); }
    else { $a = $b = (int)$part; if ($step > 1) $b = $max; }
    for ($v = $a; $v <= $b; $v += $step) if ($v >= $min && $v <= $max) $set[$v] = true;
  }
  return $set;
}

/** Next run (unix time) of a 5-field cron expression after $from, or null. */
function sd_cron_next($expr, $from) {
  $f = preg_split('/\s+/', trim($expr));
  if (count($f) < 5) return null;
  $mins = sd_cron_field($f[0], 0, 59); $hours = sd_cron_field($f[1], 0, 23);
  $doms = sd_cron_field($f[2], 1, 31); $mons = sd_cron_field($f[3], 1, 12);
  $dows = sd_cron_field(str_replace('7', '0', $f[4]), 0, 6);
  $domAny = $f[2] === '*'; $dowAny = $f[4] === '*';
  $start = $from - ($from % 60) + 60;
  $day = strtotime(date('Y-m-d 00:00:00', $start));
  for ($i = 0; $i < 400; $i++, $day = strtotime('+1 day', $day)) {
    if (!isset($mons[(int)date('n', $day)])) continue;
    $domOk = isset($doms[(int)date('j', $day)]); $dowOk = isset($dows[(int)date('w', $day)]);
    $dayOk = ($domAny && $dowAny) ? true : ($domAny ? $dowOk : ($dowAny ? $domOk : ($domOk || $dowOk)));
    if (!$dayOk) continue;
    foreach (array_keys($hours) as $h) foreach (array_keys($mins) as $m) {
      $t = $day + $h * 3600 + $m * 60;
      if ($t >= $start) return $t;
    }
  }
  return null;
}

function sd_cron_text($expr) {
  $f = preg_split('/\s+/', trim($expr));
  if (count($f) < 5) return $expr;
  list($m, $h, $dom, $mon, $dow) = $f;
  $days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  $num = '/^\d+$/';
  $hm = (preg_match($num, $m) && preg_match($num, $h)) ? sprintf('%02d:%02d', $h, $m) : null;
  if (preg_match('/^\*\/(\d+)$/', $m, $x) && $h === '*' && $dom === '*' && $mon === '*' && $dow === '*') return "Every {$x[1]} min";
  if ($m === '*' && $h === '*' && $dom === '*' && $mon === '*' && $dow === '*') return 'Every minute';
  if (preg_match($num, $m) && $h === '*' && $dom === '*' && $mon === '*' && $dow === '*') return sprintf('Hourly at :%02d', $m);
  if (preg_match($num, $m) && preg_match('/^\*\/(\d+)$/', $h, $x) && $dom === '*' && $mon === '*' && $dow === '*') return "Every {$x[1]} hours";
  if ($hm && $dom === '*' && $mon === '*' && $dow === '*') return "Daily $hm";
  if ($hm && $dom === '*' && $mon === '*' && preg_match('/^[0-7](,[0-7])*$/', $dow)) {
    $names = array_map(function ($d) use ($days) { return $days[(int)$d]; }, explode(',', $dow));
    return implode(', ', $names) . " $hm";
  }
  if ($hm && preg_match('/^\*\/(\d+)$/', $dom, $x) && $mon === '*' && $dow === '*') return "Every {$x[1]} days $hm";
  if ($hm && preg_match($num, $dom) && $mon === '*' && $dow === '*') return "Monthly, day $dom $hm";
  return $expr;
}

/** -> [kind, text, cron|null] ; kind: manual|repeat|start|stop|boot */
function sd_schedule_info($entry) {
  $freq = $entry['frequency'] ?? 'disabled';
  $custom = trim($entry['custom'] ?? '');
  $rp = sd_runparts_times();
  switch ($freq) {
    case 'hourly':  return ['repeat', 'Hourly at :' . sprintf('%02d', (int)explode(' ', $rp['hourly'])[0]), $rp['hourly']];
    case 'daily':   return ['repeat', 'Daily ' . sd_hm($rp['daily']), $rp['daily']];
    case 'weekly':  return ['repeat', 'Weekly, ' . sd_cron_text($rp['weekly']), $rp['weekly']];
    case 'monthly': return ['repeat', 'Monthly, ' . preg_replace('/^Monthly, /', '', sd_cron_text($rp['monthly'])), $rp['monthly']];
    case 'custom':  return $custom ? ['repeat', sd_cron_text($custom), $custom] : ['manual', 'Manual', null];
    case 'start':   return ['start', 'At array start', null];
    case 'stop':    return ['stop', 'At array stop', null];
    case 'boot':    return ['boot', 'At first array start', null];
    default:        return ['manual', 'Manual', null];
  }
}

function sd_hm($cron) {
  $f = preg_split('/\s+/', $cron);
  return sprintf('%02d:%02d', (int)$f[1], (int)$f[0]);
}

const SD_FREQS = ['disabled', 'hourly', 'daily', 'weekly', 'monthly', 'start', 'stop', 'boot', 'custom'];

/** A plain 5-field cron expression (numbers, * , - /). */
function sd_valid_cron($expr) {
  $f = preg_split('/\s+/', trim((string)$expr));
  if (count($f) !== 5) return false;
  foreach ($f as $x) if (!preg_match('/^[0-9*\/,\-]+$/', $x)) return false;
  return sd_cron_next(implode(' ', $f), time()) !== null;
}

/** What the fixed Unraid schedules mean on this server (they follow /etc/cron.*). */
function sd_freq_texts() {
  $out = [];
  foreach (['hourly', 'daily', 'weekly', 'monthly'] as $f) $out[$f] = sd_schedule_info(['frequency' => $f])[1];
  return $out;
}

/**
 * Save one script's schedule exactly like the original plugin's "Apply":
 * schedule.json (flash + the /tmp copy the cron jobs read), then
 * customSchedule.cron rebuilt from every custom entry, then update_cron.
 */
function sd_save_schedule($id, $freq, $custom) {
  $file = SD_US . '/schedule.json';
  $all = sd_json_read($file, []);
  $path = SD_SCRIPTS . "/$id/script";
  $old = $all[$path] ?? [];
  $all[$path] = ['script' => $path, 'frequency' => $freq, 'id' => $old['id'] ?? ('schedule' . sd_element($id)),
                 'custom' => $freq === 'custom' ? trim($custom) : ($old['custom'] ?? '')];
  @copy($file, SD_CFG . '/schedule.backup.json');                     // one-step undo
  $json = json_encode($all, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
  file_put_contents($file, $json);
  @mkdir(SD_TMP, 0755, true);
  file_put_contents(SD_TMP . '/schedule.json', $json);
  $cron = '';
  foreach ($all as $e) {
    if (($e['frequency'] ?? '') === 'custom' && trim($e['custom'] ?? '') !== '' && is_file($e['script'] ?? '')) {
      $cron .= trim($e['custom']) . ' /usr/local/emhttp/plugins/user.scripts/startCustom.php ' . escapeshellarg($e['script']) . " > /dev/null 2>&1\n";
    }
  }
  if ($cron !== '') file_put_contents(SD_US . '/customSchedule.cron', "# Generated cron schedule for user.scripts\n$cron\n");
  else @unlink(SD_US . '/customSchedule.cron');
  exec('/usr/local/sbin/update_cron');
}

/* ---------- icons ---------- */

function sd_docker_icons() {
  $out = [];
  foreach (glob(SD_DOCKER_ICONS . '/*-icon.png') ?: [] as $f) $out[] = substr(basename($f), 0, -9);
  natcasesort($out);
  return array_values($out);
}

function sd_fa_icons() {
  $css = @file_get_contents(SD_FA_CSS);
  if (!$css || !preg_match_all('/\.fa-([a-z0-9-]+):before/', $css, $m)) return [];
  return array_values(array_unique(array_filter($m[1], function ($n) { return strlen($n) > 1; })));
}

/** Icons shipped by installed plugins (and Unraid's own pages): small, roughly square images. */
function sd_plugin_icons() {
  $out = []; $seen = [];
  $add = function ($file) use (&$out, &$seen) {
    if (!is_file($file) || filesize($file) > 98304) return;
    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    if (!in_array($ext, ['png', 'svg', 'gif', 'jpg', 'jpeg', 'webp'])) return;
    if ($ext !== 'svg') {
      $sz = @getimagesize($file);
      if (!$sz || $sz[0] < 16 || $sz[0] > 512 || $sz[1] < 16 || $sz[1] > 512) return;
      $ratio = $sz[0] / max(1, $sz[1]);
      if ($ratio < 0.75 || $ratio > 1.34) return;
    }
    $hash = md5_file($file);
    if (isset($seen[$hash])) return;
    $seen[$hash] = true;
    $rel = substr($file, strlen(SD_PLUGINS) + 1);
    $out[] = ['p' => $rel, 'n' => strtok($rel, '/') . ' · ' . basename($file)];
  };
  // Each installed plugin's own icon (the icon="" of its .plg).
  foreach (glob('/var/log/plugins/*.plg') ?: [] as $plg) {
    $name = basename($plg, '.plg');
    if (preg_match('/<PLUGIN[^>]*\sicon="([^"]+\.(png|svg|gif|jpg))"/i', (string)@file_get_contents($plg, false, null, 0, 65536), $m) && strpos($m[1], '//') === false) {
      foreach (["$name/{$m[1]}", "$name/images/{$m[1]}", "$name/icons/{$m[1]}"] as $c) $add(SD_PLUGINS . '/' . $c);
    }
  }
  foreach (glob(SD_PLUGINS . '/*/{icons,images}/*.{png,svg,gif}', GLOB_BRACE) ?: [] as $f) $add($f);
  foreach (glob(SD_PLUGINS . '/*/*.{png,svg}', GLOB_BRACE) ?: [] as $f) $add($f);
  usort($out, function ($a, $b) { return strnatcasecmp($a['n'], $b['n']); });
  return $out;
}

function sd_valid_plugin_icon($rel) {
  $real = realpath(SD_PLUGINS . '/' . $rel);
  return $real && strpos($real, SD_PLUGINS . '/') === 0 && preg_match('/\.(png|svg|gif|jpe?g|webp)$/i', $real) ? substr($real, strlen(SD_PLUGINS) + 1) : '';
}

/** Pick a sensible icon when the user hasn't chosen one. */
function sd_auto_icon($id, $plainTitle, $dockerIcons) {
  $emoji = sd_leading_emoji($plainTitle);
  if ($emoji !== '') return ['t' => 'emoji', 'v' => $emoji, 'auto' => 'title'];
  $hay = strtolower($id . ' ' . $plainTitle);
  $alias = ['mysql' => 'mariadb', 'home assistant' => 'homeassistant', 'homeassistant' => 'homeassistant', 'tautull' => 'tautulli', 'sabnzbd' => 'sabnzbd'];
  foreach ($alias as $word => $icon) {
    if (preg_match('/\b' . preg_quote($word, '/') . '/', $hay)) foreach ($dockerIcons as $d) if (strtolower($d) === $icon) return ['t' => 'docker', 'v' => $d, 'auto' => 'match'];
  }
  foreach ($dockerIcons as $d) {
    $key = strtolower(preg_replace('/[-_].*$/', '', $d));
    if (strlen($key) >= 4 && preg_match('/\b' . preg_quote($key, '/') . '/', $hay)) return ['t' => 'docker', 'v' => $d, 'auto' => 'match'];
  }
  $fa = [
    'backup' => 'archive', 'docker' => 'cube', 'log' => 'file-text-o', 'disk' => 'hdd-o', 'drive' => 'hdd-o',
    'fan' => 'tachometer', 'ipmi' => 'tachometer', 'nvidia' => 'microchip', 'vbios' => 'microchip', 'clean' => 'magic',
    'delete' => 'trash', 'trim' => 'scissors', 'music' => 'music', 'playlist' => 'music', 'camera' => 'camera', 'mount' => 'plug',
    'mover' => 'truck', 'claude' => 'asterisk', 'update' => 'refresh', 'crash' => 'heartbeat', 'health' => 'heartbeat',
    'certificate' => 'certificate', 'menu' => 'bars', 'shutdown' => 'power-off', 'reboot' => 'power-off', 'duplicate' => 'clone',
    'size' => 'pie-chart', 'report' => 'bar-chart', 'movie' => 'film', 'tv' => 'tv', 'indexer' => 'search', 'nzb' => 'search',
    'executable' => 'terminal', 'ds_store' => 'apple', 'image' => 'picture-o', 'zurg' => 'cloud', 'seedbox' => 'cloud',
  ];
  foreach ($fa as $word => $icon) if (strpos($hay, $word) !== false) return ['t' => 'fa', 'v' => $icon, 'auto' => 'match'];
  return ['t' => 'fa', 'v' => 'terminal', 'auto' => 'default'];
}

/* ---------- categories ----------
 * Shared with User Scripts Enhanced when it is installed (same file, same
 * format), otherwise kept in Script Deck's own file in that format.
 */
function sd_cats_file() { return is_dir(SD_ENH_DIR) ? SD_ENH : SD_OWN_CATS; }
function sd_cats_raw() { return sd_json_read(sd_cats_file(), []); }

function sd_cats_write($raw) {
  $f = sd_cats_file();
  if (is_file($f)) @copy($f, SD_CFG . '/categories.backup.json');   // one-step undo
  // Enhanced writes this file compact; keep its order and fields.
  sd_json_write($f, array_values($raw), 0);
}

function sd_categories() {
  $raw = sd_cats_raw();
  $out = [];
  $flat = function ($list, $parent) use (&$flat, &$out) {
    usort($list, function ($a, $b) { return ($a['order'] ?? 0) <=> ($b['order'] ?? 0); });
    foreach ($list as $c) {
      $name = sd_category_name($c['name'] ?? '');
      $out[] = ['id' => (string)($c['id'] ?? md5($name)), 'name' => $name, 'parent' => $parent, 'keys' => array_values($c['scripts'] ?? [])];
      if (!empty($c['subcategories'])) $flat($c['subcategories'], (string)($c['id'] ?? ''));
    }
  };
  $flat($raw, null);
  return $out;
}

/** Remove a script key from every category (and sub-category). */
function sd_cats_unassign(&$list, $key) {
  foreach ($list as &$c) {
    $c['scripts'] = array_values(array_filter($c['scripts'] ?? [], function ($k) use ($key) { return $k !== $key; }));
    if (!empty($c['subcategories'])) sd_cats_unassign($c['subcategories'], $key);
  }
}

/** Put a category's scripts in the given order (keys not listed keep their place at the end). */
function sd_cats_reorder(&$list, $catId, $keys) {
  foreach ($list as &$c) {
    if ((string)($c['id'] ?? '') === (string)$catId) {
      $have = $c['scripts'] ?? [];
      $new = array_values(array_intersect($keys, $have));
      foreach ($have as $k) if (!in_array($k, $new, true)) $new[] = $k;
      $c['scripts'] = $new;
      return true;
    }
    if (!empty($c['subcategories']) && sd_cats_reorder($c['subcategories'], $catId, $keys)) return true;
  }
  return false;
}

function sd_cats_assign(&$list, $catId, $key) {
  foreach ($list as &$c) {
    if ((string)($c['id'] ?? '') === (string)$catId) { $c['scripts'][] = $key; return true; }
    if (!empty($c['subcategories']) && sd_cats_assign($c['subcategories'], $catId, $key)) return true;
  }
  return false;
}

/* ---------- the whole picture ---------- */

function sd_list() {
  $now = time();
  $today = strtotime('today', $now);
  sd_archive_throttled();
  $cards = sd_json_read(SD_CARDS, []);
  $sched = sd_json_read(SD_US . '/schedule.json', []);
  $docker = sd_docker_icons();
  $cats = sd_categories();
  $catOf = [];
  foreach ($cats as $c) foreach ($c['keys'] as $k) $catOf[$k] = $c['id'];

  $scripts = [];
  foreach (@scandir(SD_SCRIPTS) ?: [] as $id) {
    if ($id[0] === '.' || $id === '__MACOSX' || !is_file(SD_SCRIPTS . "/$id/script")) continue;
    $rawName = trim((string)@file_get_contents(SD_SCRIPTS . "/$id/name"));
    if ($rawName === '') $rawName = htmlspecialchars($id, ENT_QUOTES, 'UTF-8');
    $plain = sd_plain($rawName);
    $card = $cards[$id] ?? [];
    $icon = !empty($card['icon']['t']) ? $card['icon'] + ['auto' => ''] : sd_auto_icon($id, $plain, $docker);
    $titleHtml = sd_sanitize_title($rawName);
    if ($icon['t'] === 'emoji' && ($icon['auto'] ?? '') === 'title') $titleHtml = sd_strip_leading_emoji_html($titleHtml);
    $sEntry = $sched[SD_SCRIPTS . "/$id/script"] ?? [];
    list($kind, $text, $cron) = sd_schedule_info($sEntry);
    $runs = sd_parse_runs(sd_read_log($id, 262144));
    $pid = sd_running_pid($id);
    $runsToday = 0;
    foreach ($runs as $r) if (($r['start'] ?? 0) >= $today) $runsToday++;
    $last = null;
    $done = $pid ? array_slice($runs, 0, -1) : $runs;
    if ($done) { $l = end($done); $last = ['start' => $l['start'], 'end' => $l['end'], 'aborted' => $l['aborted']]; }
    if (!$last) {                                          // nothing since boot: use saved history
      $h = sd_hist_index($id);
      if ($h) $last = end($h);
    }
    $scripts[] = [
      'id' => $id,
      'title' => $titleHtml,
      'plain' => $plain,
      'desc' => sd_plain(@file_get_contents(SD_SCRIPTS . "/$id/description")),
      'icon' => $icon,
      'tint' => $card['tint'] ?? '',
      'bg' => sd_hex($card['bg'] ?? ''),
      'pinned' => !empty($card['pinned']),
      'askFirst' => !empty($card['askFirst']),
      'category' => $catOf['name' . sd_element($id)] ?? '',
      'schedule' => ['kind' => $kind, 'text' => $text, 'cron' => $cron, 'next' => $cron ? sd_cron_next($cron, $now) : null,
                     'freq' => $sEntry['frequency'] ?? 'disabled', 'custom' => $sEntry['custom'] ?? ''],
      'running' => $pid > 0,
      'runningSince' => $pid && $runs ? end($runs)['start'] : null,
      'last' => $last,
      'runsToday' => $runsToday,
      'hasLog' => is_file(sd_log_file($id)),
      'vars' => sd_script_vars($id),
    ];
  }
  $key = function ($s) { return preg_replace('/^[^\p{L}\p{N}]+/u', '', $s['plain']); };
  usort($scripts, function ($a, $b) use ($key) { return strnatcasecmp($key($a), $key($b)); });
  // Each category lists its scripts in their saved order (the order of its "scripts" array).
  $idOf = [];
  foreach ($scripts as $s) $idOf['name' . sd_element($s['id'])] = $s['id'];
  $cats = array_map(function ($c) use ($idOf) {
    $c['ids'] = array_values(array_filter(array_map(function ($k) use ($idOf) { return $idOf[$k] ?? null; }, $c['keys'])));
    unset($c['keys']);
    return $c;
  }, $cats);
  return ['now' => $now, 'scripts' => $scripts,
          'categories' => $cats,
          'catsShared' => is_dir(SD_ENH_DIR), 'history' => sd_hist_ok(), 'freqTexts' => sd_freq_texts(), 'ui' => sd_json_read(SD_UI, ['shut' => []])];
}

function sd_strip_leading_emoji_html($html) {
  $re = '/^((?:\s|<span[^>]*>)*)((?:[\x{1F000}-\x{1FAFF}]|[\x{2600}-\x{27BF}]|[\x{2B00}-\x{2BFF}]|[\x{2190}-\x{21FF}]|[\x{2300}-\x{23FF}]|\x{FE0F}|\x{200D}|\x{20E3}|[\x{1F3FB}-\x{1F3FF}]|\s)+)/u';
  $out = preg_replace($re, '$1', $html, 1);
  $out = preg_replace('/<span[^>]*>\s*<\/span>/u', '', $out);
  return trim($out);
}

/** Header variables the original plugin understands (#arrayStarted=true, ...). */
function sd_script_vars($id) {
  $vars = [];
  $lines = explode("\n", str_replace("\r", '', (string)@file_get_contents(SD_SCRIPTS . "/$id/script", false, null, 0, 8192)));
  foreach ($lines as $line) {
    if (strpos($line, '#!') === 0 || trim($line) === '' || strpos($line, '<?') === 0) continue;
    if ($line[0] !== '#') break;
    if (strpos($line, '=') === false) continue;
    list($k, $v) = explode('=', trim(ltrim($line, '#')), 2);
    $vars[trim($k)] = trim($v);
  }
  $bool = function ($k) use ($vars) { return filter_var($vars[$k] ?? false, FILTER_VALIDATE_BOOLEAN); };
  return ['arrayStarted' => $bool('arrayStarted'), 'foregroundOnly' => $bool('foregroundOnly'), 'backgroundOnly' => $bool('backgroundOnly'),
          'directPHP' => $bool('directPHP'), 'argumentDescription' => $vars['argumentDescription'] ?? '', 'argumentDefault' => $vars['argumentDefault'] ?? ''];
}
