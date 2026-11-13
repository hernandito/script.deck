<?php
/* Script Deck - save finished runs from User Scripts' /tmp logs into
 * /mnt/user/appdata/script.deck/history so they survive a reboot.
 * Run by cron every 10 minutes and when the array is about to stop. */
require_once __DIR__ . '/lib.php';
$n = sd_archive_all();
if ($n && in_array('-v', $argv ?? [])) echo "Script Deck: saved $n run(s)\n";
