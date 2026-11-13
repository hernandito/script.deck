#!/bin/bash
# build.sh - pack src/ into one self-contained script.deck.plg (no downloads,
# so it installs and boots without internet). Updates are checked at PLUGIN_URL.
#
#   bash build.sh            -> version = today's date
#   bash build.sh 2026.11.12b
#
set -euo pipefail
cd "$(dirname "$0")"

NAME="script.deck"
VERSION="${1:-$(date +%Y.%m.%d)}"
# Where Unraid looks for updates (Plugins > Check for Updates). The repo must be public.
PLUGIN_URL="https://raw.githubusercontent.com/hernandito/script.deck/main/script.deck.plg"
OUT="$NAME.plg"
SRC="src"
PLUGDIR="/usr/local/emhttp/plugins/$NAME"

{
cat <<EOF
<?xml version='1.0' standalone='yes'?>
<!DOCTYPE PLUGIN [
<!ENTITY name    "$NAME">
<!ENTITY version "$VERSION">
<!ENTITY plugdir "$PLUGDIR">
<!ENTITY cfgdir  "/boot/config/plugins/$NAME">
<!ENTITY pluginURL "$PLUGIN_URL">
]>
<PLUGIN name="&name;" author="hernandito" version="&version;" min="6.12.0" icon="script.deck.png" launch="Settings/ScriptDeck" pluginURL="&pluginURL;" support="https://github.com/hernandito/script.deck">

<CHANGES>
###&version;
$(sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' CHANGES.md 2>/dev/null || echo "- Script Deck")
</CHANGES>

<!-- Start clean, keep settings (cards.json, icons) on the flash drive. -->
<FILE Run="/bin/bash">
<INLINE>
rm -rf &plugdir;
mkdir -p &plugdir; &cfgdir;/icons
</INLINE>
</FILE>

EOF

find "$SRC" -type f | sort | while read -r f; do
  target="/${f#$SRC/}"
  # Images can't sit in XML as-is: embed them as base64 text, decoded at install (below).
  case "$f" in *.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico)
    printf '<FILE Name="%s.b64" Mode="0644">\n<INLINE>' "$target"
    base64 -w 76 "$f"
    printf '</INLINE>\n</FILE>\n\n'
    continue ;;
  esac
  if grep -q ']]>' "$f"; then echo "ERROR: $f contains a CDATA terminator" >&2; exit 1; fi
  mode=0644
  case "$target" in */event/*|*/scripts/*) mode=0755 ;; esac
  printf '<FILE Name="%s" Mode="%s">\n<INLINE><![CDATA[' "$target" "$mode"
  cat "$f"
  printf ']]></INLINE>\n</FILE>\n\n'
done

cat <<'EOF'
<!-- Turn the embedded base64 images back into image files. -->
<FILE Run="/bin/bash">
<INLINE>
find /usr/local/emhttp/plugins/script.deck -name '*.b64' | while read -r f; do base64 -d "$f" &gt; "${f%.b64}" &amp;&amp; rm -f "$f"; done
</INLINE>
</FILE>

<!-- Save script run history every 10 minutes (Unraid merges plugin .cron files). -->
<FILE Run="/bin/bash">
<INLINE>
cat > /boot/config/plugins/script.deck/script.deck.cron &lt;&lt;'CRON'
# Script Deck: save User Scripts run history so it survives reboots
*/10 * * * * /usr/bin/php /usr/local/emhttp/plugins/script.deck/include/archive.php &amp;> /dev/null
CRON
/usr/local/sbin/update_cron
</INLINE>
</FILE>

<FILE Run="/bin/bash">
<INLINE>
echo ""
echo "-----------------------------------------------------"
echo " Script Deck &version; installed."
echo " Open it at Settings > Utilities > Script Deck, or"
echo " point a Custom Tab at:"
echo "   /usr/local/emhttp/plugins/script.deck/ScriptDeck.page"
echo "-----------------------------------------------------"
echo ""
</INLINE>
</FILE>

<FILE Run="/bin/bash" Method="remove">
<INLINE>
rm -rf /usr/local/emhttp/plugins/script.deck
rm -f /boot/config/plugins/script.deck/script.deck.cron
/usr/local/sbin/update_cron
echo "Script Deck removed. Icons, card settings and run history are kept"
echo "(/boot/config/plugins/script.deck and /mnt/user/appdata/script.deck)."
</INLINE>
</FILE>
</PLUGIN>
EOF
} > "$OUT"

# Keep the repo editable from Windows over the network share (Unraid's normal
# share owner and permissions), whoever ran this script.
chown -R nobody:users . 2>/dev/null || true
chmod -R u+rwX,g+rwX,o+rwX . 2>/dev/null || true

echo "Built $OUT  (version $VERSION, $(wc -c < "$OUT") bytes)"
