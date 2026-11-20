/* Script Deck - front end. Plain JavaScript, no libraries.
 * Data: include/api.php (see the comment at its top). */
(function () {
  'use strict';
  var app = document.getElementById('sd-app');
  if (!app) return;
  var API = app.getAttribute('data-api');
  var DOCKER_URL = '/state/plugins/dynamix.docker.manager/images/';

  var S = {
    data: null, tab: load('tab', 'all'), q: '', shut: null, pending: false,
    modal: null   // view: {id, tab, edit, etab, run, follow, find, fmt, log, draft}  cats: {kind:'cats', list}
  };

  /* ---------- helpers ---------- */
  function load(k, d) { try { var v = localStorage.getItem('sd.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem('sd.' + k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function csrf() { return (typeof window.csrf_token !== 'undefined') ? window.csrf_token : ''; }
  function cssq(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'); }
  function svg(path, size, fill) {
    return '<svg width="' + (size || 14) + '" height="' + (size || 14) + '" viewBox="0 0 24 24" aria-hidden="true" ' +
      (fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"') + '><path d="' + path + '"></path></svg>';
  }
  var I = {
    play: 'M7 4.5v15l12.5-7.5z', stop: 'M7 7h10v10H7z', x: 'M6 6l12 12M18 6 6 18', chev: 'm6 9 6 6 6-6',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4', edit: 'M4 20h4L19 9l-4-4L4 16z',
    up: 'm6 15 6-6 6 6', down: 'm6 9 6 6 6-6', arrange: 'M7 4v16M7 4 4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', plus: 'M12 5v14M5 12h14', cog: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4'
  };

  function get(params) {
    var q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch(API + '?' + q, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function post(params) {
    var body = new URLSearchParams();
    Object.keys(params).forEach(function (k) { body.append(k, params[k]); });
    body.append('csrf_token', csrf());
    return fetch(API, { method: 'POST', credentials: 'same-origin', body: body })
      .then(function (r) {
        return r.text().then(function (t) {
          try { return JSON.parse(t); }
          catch (e) { throw new Error('the server replied unexpectedly (HTTP ' + r.status + '): ' + t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)); }
        });
      })
      .then(function (d) { if (!d.ok) throw new Error(d.error || 'Something went wrong'); return d; });
  }
  function toast(msg, bad) {
    var t = document.createElement('div');
    t.className = 'sd-toast' + (bad ? ' bad' : '');
    t.textContent = msg;
    if (bad) t.title = 'Click to dismiss';
    t.addEventListener('click', function () { t.remove(); });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, bad ? 12000 : 2600);
  }
  // Any unexpected error in Script Deck is shown, never silently swallowed.
  window.addEventListener('error', function (e) {
    if (e.filename && e.filename.indexOf('/plugins/script.deck/') >= 0) toast('Script Deck problem: ' + e.message, true);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    if (r && r.message && String(r.stack || '').indexOf('/plugins/script.deck/') >= 0) toast('Script Deck problem: ' + r.message, true);
  });

  /* Emoji style: browsers pick different emoji fonts (Google's Noto, Twitter's
     Twemoji...). "Windows / Apple style" asks for Segoe UI Emoji / Apple Color Emoji first. */
  function applyEmojiStyle() {
    app.classList.toggle('emoji-system', S.emoji === 'system');
    if (ov) ov.classList.toggle('emoji-system', S.emoji === 'system');
  }

  /* ---------- time ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(ts) { var d = new Date(ts * 1000); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dayStart() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime() / 1000; }
  function when(ts) {
    if (!ts) return '';
    var d = new Date(ts * 1000), day = dayStart();
    if (ts >= day) return hm(ts);
    if (ts >= day - 86400) return 'yesterday ' + hm(ts);
    if (ts >= day - 6 * 86400) return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + hm(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + hm(ts);
  }
  /* Upcoming times: "today 14:40", "tomorrow 01:59", "Sun 01:30", "Dec 4 02:20". */
  function whenNext(ts) {
    if (!ts) return '';
    var d = new Date(ts * 1000), day = dayStart();
    if (ts < day + 86400) return 'today ' + hm(ts);
    if (ts < day + 2 * 86400) return 'tomorrow ' + hm(ts);
    if (ts < day + 7 * 86400) return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + hm(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + hm(ts);
  }
  function nextText(ts) {
    var mins = Math.round((ts - Date.now() / 1000) / 60);
    if (mins < 1) return 'any moment';
    if (mins < 60) return 'in ' + mins + ' min';
    if (mins < 24 * 60) return 'in ' + Math.round(mins / 60) + ' h';
    return 'in ' + Math.round(mins / 1440) + ' days';
  }
  function dur(a, b) {
    if (!a || !b) return '';
    var s = Math.max(0, b - a);
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.round(s / 60) + ' min';
    return (s / 3600).toFixed(s < 36000 ? 1 : 0) + ' h';
  }
  function elapsed(a) {
    var s = Math.max(0, Math.round(Date.now() / 1000 - a));
    return Math.floor(s / 60) + ':' + pad(s % 60);
  }

  /* ---------- data ---------- */
  function byId(id) { var s = S.data && S.data.scripts; if (!s) return null; for (var i = 0; i < s.length; i++) if (s[i].id === id) return s[i]; return null; }
  function catName(id) { var c = (S.data.categories || []).filter(function (x) { return x.id === id; })[0]; return c ? c.name : 'Other'; }

  /* Auto-refresh must never get in the way of selecting text:
     - normally only the tiles whose content changed are swapped, one by one;
     - the page is rebuilt only when the layout itself changes (a script added,
       moved, renamed...), and never while the mouse button is down, for a moment
       after it is released, or while text is selected - it waits instead. */
  var lastLayout = '', cardCache = {}, mouseDown = false, lastUp = 0;
  document.addEventListener('mousedown', function () { mouseDown = true; }, true);
  document.addEventListener('mouseup', function () { mouseDown = false; lastUp = Date.now(); }, true);
  function selecting() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    var n = sel.anchorNode;
    return app.contains(n) || !!(ov && ov.contains(n));
  }
  function busy() { return !!S.reorder || mouseDown || selecting() || Date.now() - lastUp < 1500; }
  function selectionIn(el) {
    var sel = window.getSelection();
    return !!(sel && !sel.isCollapsed && sel.rangeCount && (el.contains(sel.anchorNode) || el.contains(sel.focusNode)));
  }
  function refresh() {
    return get({ a: 'list' }).then(function (d) {
      if (!d.ok) throw new Error(d.error);
      if (S.shut === null) S.shut = (d.ui && d.ui.shut && !Array.isArray(d.ui.shut)) ? d.ui.shut : load('shut', {});
      if (S.emoji === undefined) { S.emoji = (d.ui && d.ui.emoji) || load('emoji', ''); applyEmojiStyle(); }
      var o = d.ui && d.ui.other;
      S.other = { name: (o && o.name) || 'Other', pos: o && o.pos != null ? +o.pos : null };
      S.order = (d.ui && d.ui.order && !Array.isArray(d.ui.order)) ? d.ui.order : {};
      if (S.fmtPref === undefined) S.fmtPref = (d.ui && d.ui.fmt) || '';
      if (S.badges === undefined) S.badges = !(d.ui && d.ui.badges === false);
      delete d.ui;
      S.data = d;
      if (!lastLayout || layoutSig() !== lastLayout) {
        if (lastLayout && busy()) S.pending = true;
        else { S.pending = false; renderPage(); }
      } else patchPage();
      if (S.modal && S.modal.kind === 'run') {
        var rc = byId(S.modal.id), rs = JSON.stringify([rc && rc.running, rc && rc.last]);
        if (rs !== S.modal.sig && !selecting()) { S.modal.sig = rs; renderModal(true); }
      }
      if (S.modal && S.modal.kind === 'view' && !S.modal.edit) {
        var cur = byId(S.modal.id);
        if (cur && S.modal.log && S.modal.log.running !== cur.running) loadLog();       // started or finished
        else if (cur && cur.running) loadLog();
        var ms = JSON.stringify(cur);
        if (ms !== S.modal.sig && !busy()) { S.modal.sig = ms; renderModal(true); }
      }
    }).catch(function (e) { if (!S.data) app.innerHTML = '<div class="sd-loading">Could not load scripts: ' + esc(e.message) + '</div>'; });
  }
  /* Swap only what changed: the status chips, section notes, and individual tiles. */
  function patchPage() {
    if (S.reorder) return;                                  // never disturb tiles being arranged
    var chips = $('#sd-chips', app), ch = chipsHtml();
    if (chips && chips.innerHTML !== ch && !selectionIn(chips)) chips.innerHTML = ch;
    var v = buildView();
    flatSecs(v.secs).forEach(function (sec) {
      var n = app.querySelector('.sd-sec[data-seckey="' + cssq(sec.key) + '"] > .sd-sh .note');
      var t = noteText(sec);
      if (n && n.textContent !== t && !selectionIn(n)) n.textContent = t;
    });
    S.data.scripts.forEach(function (s) {
      var html = cardHtml(s);
      if (cardCache[s.id] === html) return;
      var els = app.querySelectorAll('.sd-card[data-open="' + cssq(s.id) + '"]'), ok = true;
      Array.prototype.forEach.call(els, function (el) {
        if (selectionIn(el) || (mouseDown && el.matches(':hover'))) { ok = false; return; }
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        el.replaceWith(tmp.firstChild);
      });
      if (ok) cardCache[s.id] = html;      // otherwise retried on the next refresh
    });
  }
  document.addEventListener('selectionchange', function () {
    if (S.pending && !busy()) { S.pending = false; renderPage(); }
  });
  setInterval(function () { if (S.pending && !busy()) { S.pending = false; renderPage(); } }, 1000);

  /* ---------- icons ---------- */
  function iconStyle(s) {
    return /^#/.test(s.tint || '') ? 'background:' + s.tint + ';' : '';
  }
  function iconInner(x) {
    if (x.t === 'docker') return '<img src="' + DOCKER_URL + encodeURIComponent(x.v) + '-icon.png" alt="" loading="lazy">';
    if (x.t === 'upload') return '<img src="' + API + '?a=icon&f=' + encodeURIComponent(x.v) + '" alt="" loading="lazy">';
    if (x.t === 'plugin') return '<img src="/plugins/' + esc(encodeURI(x.v)) + '" alt="" loading="lazy">';
    if (x.t === 'emoji') return '<span class="emo">' + esc(x.v) + '</span>';
    return '<i class="fa fa-' + esc(x.v || 'terminal') + '" aria-hidden="true"></i>';
  }
  function iconHtml(s, ring) {
    var ic = s.icon || {}, cls = 'sd-ico';
    if (ic.t === 'docker' || ic.t === 'upload' || ic.t === 'plugin') cls += ' img';
    if (s.tint && !/^#/.test(s.tint)) cls += ' t-' + s.tint;          // backgrounds apply to images too
    if (ring) cls += ' ' + ring;
    var st = iconStyle(s);
    return '<span class="' + cls + '"' + (st ? ' style="' + st + '"' : '') + '>' + iconInner(ic) + '</span>';
  }
  function state(s) {
    if (s.running) return { ring: 'ring-run', cls: 'run', text: 'running ' + (s.runningSince ? elapsed(s.runningSince) : '') };
    var L = s.last;
    if (L && L.aborted) return { ring: 'ring-stop', cls: 'stop', text: '■ stopped ' + when(L.start) };
    if (L && L.start) {
      var recent = Date.now() / 1000 - L.start < 86400;
      return { ring: recent ? 'ring-ok' : '', cls: recent ? 'ok' : '', text: '✓ ' + when(L.start) + (L.end ? ' · ' + dur(L.start, L.end) : '') + ' · ' + s.schedule.text };
    }
    return { ring: '', cls: '', text: s.schedule.text + (s.schedule.next ? ' · next ' + whenNext(s.schedule.next) : '') };
  }

  /* ---------- page ---------- */
  function counts() {
    var run = 0, today = 0;
    S.data.scripts.forEach(function (s) { if (s.running) run++; if (s.runsToday > 0) today++; });
    return { run: run, today: today };
  }
  function visible() {
    var q = S.q.trim().toLowerCase();
    return S.data.scripts.filter(function (s) {
      if (!q) return true;
      return (s.plain + ' ' + s.desc + ' ' + s.id + ' ' + s.schedule.text).toLowerCase().indexOf(q) >= 0;
    });
  }
  /* Category names form an outline, up to 3 levels, split at " - ":
       "Backups - Daily"            -> Backups > Daily
       "Backups - Daily - Appdata"  -> Backups > Daily > Appdata
       "Backups"                    -> scripts shown directly under the Backups heading
     A level is only made when 2+ categories share it; otherwise the full name is kept.
     Each node: { id, name, cats (every category in it), first, own (categories named
     exactly this), kids (sub-nodes), leaf (the category, for a plain one) }. */
  var MAX_DEPTH = 3;
  function groups() {
    var cats = (S.data.categories || []).filter(function (c) { return !c.parent; });
    var ents = cats.map(function (c) {
      return { cat: c, segs: c.name.split(' - ').map(function (x) { return x.trim(); }).filter(function (x) { return x; }) };
    });
    function leaf(e, at) { return { id: e.cat.id, name: e.segs.slice(at).join(' - ') || e.cat.name, cats: [e.cat], first: e.cat, own: [], kids: [], leaf: e.cat }; }
    function nest(list, at, depth) {
      var order = [], by = {}, out = [];
      list.forEach(function (e) {
        var k = e.segs[at];
        if (!by[k]) { by[k] = []; order.push(k); }
        by[k].push(e);
      });
      order.forEach(function (k) {
        var g = by[k];
        if (g.length < 2 || depth >= MAX_DEPTH) { g.forEach(function (e) { out.push(leaf(e, at)); }); return; }
        var own = g.filter(function (e) { return e.segs.length === at + 1; });
        var rest = g.filter(function (e) { return e.segs.length > at + 1; });
        out.push({ id: 'g:' + g[0].segs.slice(0, at + 1).join(' - '), name: k,
          cats: g.map(function (e) { return e.cat; }), first: g[0].cat,
          own: own.map(function (e) { return e.cat; }), kids: nest(rest, at + 1, depth + 1), leaf: null });
      });
      return out;
    }
    return nest(ents.filter(function (e) { return e.segs.length; }), 0, 1);
  }
  /* Category groups in display order, with "Other" (scripts without a category)
     placed where the user put it - by default last, like User Scripts Enhanced. */
  function ordered() {
    var top = (S.data.categories || []).filter(function (c) { return !c.parent; });
    var pos = S.other && S.other.pos != null ? S.other.pos : Infinity, out = [], placed = false;
    groups().forEach(function (g) {
      var idx = top.indexOf(g.first);
      if (!placed && idx >= pos) { out.push({ other: true }); placed = true; }
      out.push({ g: g });
    });
    if (!placed) out.push({ other: true });
    return out;
  }
  function otherName() { return (S.other && S.other.name) || 'Other'; }
  function sections() {
    var list = visible(), cats = S.data.categories || [], out = [];
    // Tiles keep the order the user arranged; anything not arranged yet follows alphabetically.
    var byOrder = function (items, ids) {
      if (!ids || !ids.length) return items;
      var at = {}; ids.forEach(function (id, i) { at[id] = i; });
      return items.slice().sort(function (a, b) {
        var x = at[a.id], y = at[b.id];
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return x - y;
      });
    };
    var pinned = byOrder(list.filter(function (s) { return s.pinned; }), (S.order || {}).pinned);
    // Pinned scripts also stay in their category, unless told not to ("Also show in its category" off).
    var list2 = list.filter(inCategory);
    var inCat = function (id) {
      var c0 = cats.filter(function (c) { return c.id === id; })[0];
      return byOrder(list2.filter(function (s) { return s.category === id || cats.some(function (c) { return c.id === s.category && c.parent === id; }); }), c0 && c0.ids);
    };
    var other = byOrder(list2.filter(function (s) { return !s.category || !cats.some(function (c) { return c.id === s.category; }); }), (S.order || {}).other);
    var G = groups();
    // A node of the outline becomes a section; a group is a heading with its own scripts
    // (a category named exactly like it) and its sub-sections indented under it.
    var secOf = function (g) {
      if (g.leaf) return [{ key: 'c' + g.leaf.id, name: g.name, items: inCat(g.leaf.id) }];
      var own = [];
      g.own.forEach(function (c) { own = own.concat(inCat(c.id)); });
      var subs = [];
      g.kids.forEach(function (k) { subs = subs.concat(secOf(k)); });
      if (S.tab === 'all') subs = subs.filter(function (x) { return x.items.length; });
      var all = own.slice();
      subs.forEach(function (x) { all = all.concat(x.items); });
      if (!subs.length && !own.length && S.tab === 'all') return [];
      return [{ key: g.id, name: g.name, group: true, subs: subs, items: all, own: own,
                ownKey: g.own.length === 1 ? 'c' + g.own[0].id : null }];
    };
    var PIN = { key: 'pinned', name: '📌 Pinned', items: pinned };
    var OTHER = { key: 'other', name: otherName(), note: 'scripts without a category', items: other };
    if (S.tab === 'pinned') return [PIN];
    if (S.tab === 'other') return [OTHER];
    if (S.tab !== 'all') {
      var g = G.filter(function (x) { return x.id === S.tab; })[0];
      if (g) return secOf(g);
      S.tab = 'all';
    }
    if (pinned.length) out.push(PIN);
    ordered().forEach(function (e) {
      if (e.other) { if (other.length) out.push(OTHER); }
      else out = out.concat(secOf(e.g).filter(function (x) { return x.items.length; }));
    });
    return out;
  }
  function inCategory(s) { return !(s.pinned && s.pinHide); }
  /* Every section, group headings and their sub-sections alike, in page order. */
  function flatSecs(secs) {
    var out = [];
    (secs || sections()).forEach(function (x) { out.push(x); if (x.subs) out = out.concat(flatSecs(x.subs)); });
    return out;
  }

  /* What the page shows, independent of run times: buttons and sections. */
  function buildView() {
    var tabs = [{ id: 'all', name: 'All', n: S.data.scripts.length }];
    if (S.data.scripts.some(function (s) { return s.pinned; })) tabs.push({ id: 'pinned', name: '📌 Pinned', n: S.data.scripts.filter(function (s) { return s.pinned; }).length });
    var otherN = S.data.scripts.filter(function (s) { return !s.category && inCategory(s); }).length;
    ordered().forEach(function (e) {
      if (e.other) { if (otherN) tabs.push({ id: 'other', name: otherName(), n: otherN }); return; }
      var ids = e.g.cats.map(function (c) { return c.id; });
      tabs.push({ id: e.g.id, name: e.g.name, n: S.data.scripts.filter(function (s) { return ids.indexOf(s.category) >= 0 && inCategory(s); }).length });
    });
    if (!tabs.some(function (t) { return t.id === S.tab; })) S.tab = 'all';
    return { tabs: tabs, secs: sections() };
  }
  /* Changes only when the layout changes - not when a script runs or a clock ticks. */
  function layoutSig() {
    var v = buildView();
    return JSON.stringify([S.tab, S.q, S.other, v.tabs, flatSecs(v.secs).map(function (s) { return [s.key, s.name, !!s.group, s.items.map(function (i) { return i.id; })]; })]);
  }
  function chipsHtml() {
    var c = counts();
    return (c.run ? '<span class="sd-chip run">● ' + c.run + ' running</span>' : '') + '<span class="sd-chip ok">✓ ' + c.today + ' ran today</span>';
  }
  function noteText(sec) {
    var ran = sec.items.filter(function (s) { return s.runsToday > 0; }).length;
    return sec.note || (ran ? ran + ' ran today' : '');
  }

  function renderPage() {
    if (!S.data) return;
    var active = document.activeElement && document.activeElement.id === 'sd-q';
    var v = buildView(), secs = v.secs;
    var anyOpen = flatSecs(secs).some(function (x) { return !S.shut[x.key]; });
    var h = '<div class="sd-top"><h1>Scripts</h1><span id="sd-chips" style="display:contents">' + chipsHtml() + '</span>';
    // "Counts" and "Collapse all" sit just left of the search box
    h += '<span class="sd-toptools">' +
      '<label class="sd-chk sd-badgetoggle" title="Show or hide the script counts on the category buttons"><input type="checkbox" id="sd-badges"' + (S.badges === false ? '' : ' checked') + '> Counts</label>' +
      '<button type="button" class="sd-linkbtn" data-allsec="' + (anyOpen ? 'shut' : 'open') + '">' + (anyOpen ? 'Collapse all' : 'Expand all') + '</button></span>';
    h += '<label class="sd-search">' + svg(I.search, 15) + '<input id="sd-q" type="search" placeholder="Find a script  ( / )" aria-label="Find a script" value="' + esc(S.q) + '"></label>';
    h += '<a class="sd-btn" href="/Settings/Userscripts" title="The original User Scripts page">Classic page</a>';
    h += '<button type="button" class="sd-btn sd-gear" data-managecats aria-label="Manage categories" title="Manage categories: add, rename, delete, reorder"><i class="fa fa-cog" aria-hidden="true"></i></button></div>';

    // Category buttons: all shown, wrapping onto more lines when needed.
    h += '<nav class="sd-cats' + (S.badges === false ? ' nobadges' : '') + '" aria-label="Categories">';
    v.tabs.forEach(function (t) {
      h += '<button type="button" class="sd-cat' + (S.tab === t.id ? ' on' : '') + '" data-tab="' + esc(t.id) + '" aria-pressed="' + (S.tab === t.id) + '" title="' + esc(t.name) + '">' +
        '<span class="nm">' + esc(t.name) + '</span><span class="sd-badge">' + t.n + '</span></button>';
    });
    h += '</nav>';

    if (!secs.length || secs.every(function (x) { return !x.items.length; })) h += '<div class="sd-empty">' + (S.q ? 'No script matches “' + esc(S.q) + '”.' : 'Nothing here yet.') + '</div>';
    cardCache = {};
    var gridHtml = function (items, arranging) {
      var o = '<div class="sd-grid">';
      items.forEach(function (s) { var c = cardHtml(s, false, arranging); if (!arranging) cardCache[s.id] = c; o += c; });
      return o + '</div>';
    };
    var secHtml = function (sec, sub, depth) {
      // the tiles this heading arranges: its own (a plain category, or a group's own category)
      var arrKey = sec.group ? sec.ownKey : sec.key, arrItems = sec.group ? (sec.own || []) : sec.items;
      var arranging = !!arrKey && S.reorder === arrKey;
      var shut = !!S.shut[sec.key] && !S.q && !arranging;
      var tools = !arrKey ? '' : arranging
        ? '<span class="sd-arrbar"><span class="sd-help">Drag the tiles, or use ◀ ▶</span>' +
          '<button type="button" class="sd-btn sm" data-arrcancel>Cancel</button><button type="button" class="sd-btn sm accent" data-arrdone="' + esc(arrKey) + '">Done</button></span>'
        : (arrItems.length > 1 && !S.q && !S.reorder ? '<button type="button" class="sd-arrbtn" data-arrange="' + esc(arrKey) + '" aria-label="Arrange the tiles of ' + esc(sec.name) + '" title="Arrange tiles">' + svg(I.arrange, 15) + '</button>' : '');
      var o = '<section class="sd-sec' + (sec.group ? ' grp' : '') + (sub ? ' sub lv' + depth : '') + (shut ? ' shut' : '') + (arranging && !sec.group ? ' arranging' : '') + '" data-seckey="' + esc(sec.key) + '"><div class="sd-sh">' +
        '<button type="button" class="sd-shbtn" data-sec="' + esc(sec.key) + '" aria-expanded="' + (!shut) + '"' + (arranging ? ' disabled' : '') + '><span class="chev">' + svg(I.chev, 14) + '</span>' +
        '<span class="sd-catlabel">' + esc(sec.name) + '</span><span class="sd-badge">' + sec.items.length + '</span></button>' +
        '<span class="note">' + esc(noteText(sec)) + '</span><span class="rule"></span>' + tools + '</div>' +
        '<div class="sd-acc"><div>';
      if (sec.group) {
        // the group's own scripts first, in a headerless block that Arrange can find by its key
        if (sec.own && sec.own.length) o += '<div class="sd-sec own' + (arranging ? ' arranging' : '') + '" data-seckey="' + esc(sec.ownKey || '') + '">' + gridHtml(sec.own, arranging) + '</div>';
        sec.subs.forEach(function (x) { o += secHtml(x, true, depth + 1); });
      } else o += gridHtml(sec.items, arranging);
      return o + '</div></div></section>';
    };
    secs.forEach(function (sec) { h += secHtml(sec, false, 1); });
    app.innerHTML = h;
    lastLayout = layoutSig();
    if (active) { var q = $('#sd-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  function cardHtml(s, preview, arrange) {
    var st = state(s);
    if (arrange) {
      // Arrange mode: a draggable tile with move buttons instead of the run button.
      return '<div class="sd-card arr" draggable="true" data-arr="' + esc(s.id) + '"' + (s.bg ? ' style="background:' + esc(s.bg) + '"' : '') + '>' +
        '<div class="sd-card-top">' + iconHtml(s, '') + '<span class="sd-mv">' +
        '<button type="button" data-mv="-1" aria-label="Move ' + esc(s.plain) + ' earlier">◀</button>' +
        '<button type="button" data-mv="1" aria-label="Move ' + esc(s.plain) + ' later">▶</button></span></div>' +
        '<div class="sd-title">' + s.title + '</div><div class="sd-stat"><span class="t">⠿ drag to move</span></div></div>';
    }
    var flag = s.running ? '<span class="sd-flag live">LIVE</span>' : (s.askFirst ? '<span class="sd-flag warn">⚠ ASKS FIRST</span>' : '');
    return '<div class="sd-card' + (s.running ? ' run' : '') + '"' + (s.bg ? ' style="background:' + esc(s.bg) + '"' : '') +
      (preview ? '' : ' tabindex="0" role="button" data-open="' + esc(s.id) + '" aria-label="Open ' + esc(s.plain) + '"') + '>' +
      '<div class="sd-card-top">' + iconHtml(s, st.ring) +
      '<button type="button" class="sd-go' + (s.running ? ' stop' : '') + '"' + (preview ? ' tabindex="-1"' : ' data-' + (s.running ? 'stop' : 'runwatch') + '="' + esc(s.id) + '"') +
      ' aria-label="' + (s.running ? 'Stop ' : 'Run ') + esc(s.plain) + '" title="' + (s.running ? 'Stop' : 'Run') + '">' + svg(s.running ? I.stop : I.play, s.running ? 12 : 16, true) + '</button></div>' +
      '<div class="sd-title" title="' + esc(s.plain) + '">' + s.title + '</div>' +
      '<div class="sd-stat ' + st.cls + '">' + flag + '<span class="t">' + esc(st.text) + '</span></div></div>';
  }

  /* Accordion: toggle in place (animated), remember on the server. */
  var uiTimer = null;
  function saveShut() {
    save('shut', S.shut);
    clearTimeout(uiTimer);
    uiTimer = setTimeout(function () { post({ a: 'ui', shut: JSON.stringify(S.shut) }).catch(function () {}); }, 500);
  }
  function toggleSection(key, shut) {
    S.shut[key] = shut;
    if (!shut) delete S.shut[key];
    var sec = app.querySelector('.sd-sec[data-seckey="' + cssq(key) + '"]');
    if (sec) { sec.classList.toggle('shut', !!shut); var b = sec.querySelector(':scope > .sd-sh .sd-shbtn'); if (b) b.setAttribute('aria-expanded', String(!shut)); }
    var anyOpen = Array.prototype.some.call(app.querySelectorAll('.sd-sec:not(.own)'), function (x) { return !x.classList.contains('shut'); });
    var lb = $('[data-allsec]', app);
    if (lb) { lb.dataset.allsec = anyOpen ? 'shut' : 'open'; lb.textContent = anyOpen ? 'Collapse all' : 'Expand all'; }
    saveShut();
  }

  /* ---------- arranging tiles within a section ---------- */
  function moveCard(card, dir) {
    if (!card) return;
    var sib = dir < 0 ? card.previousElementSibling : card.nextElementSibling;
    if (!sib) return;
    if (dir < 0) card.parentNode.insertBefore(card, sib); else card.parentNode.insertBefore(sib, card);
    var b = card.querySelector('[data-mv="' + dir + '"]'); if (b) b.focus();
  }
  function saveOrder(key) {
    var grid = app.querySelector('.sd-sec[data-seckey="' + cssq(key) + '"] .sd-grid');
    if (!grid) return;
    var ids = Array.prototype.map.call(grid.querySelectorAll('.sd-card.arr'), function (c) { return c.dataset.arr; });
    // Show the new order straight away, then save it.
    if (key === 'pinned' || key === 'other') { S.order = S.order || {}; S.order[key] = ids; }
    else {
      var c = (S.data.categories || []).filter(function (x) { return 'c' + x.id === key; })[0];
      if (c) c.ids = ids.filter(function (id) { var s = byId(id); return s && s.category === c.id; });
    }
    S.reorder = null;
    renderPage();
    post({ a: 'order', sec: key, ids: JSON.stringify(ids) }).then(function () { toast('Order saved'); }).catch(function (e) { toast('Order not saved: ' + e.message, true); refresh(); });
  }
  var dragCard = null;
  app.addEventListener('dragstart', function (e) {
    var c = e.target.closest && e.target.closest('.sd-card.arr');
    if (!c) return;
    dragCard = c; c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', c.dataset.arr); } catch (er) {}
  });
  app.addEventListener('dragover', function (e) {
    var c = e.target.closest && e.target.closest('.sd-card.arr');
    if (!dragCard || !c || c === dragCard || c.parentNode !== dragCard.parentNode) return;
    e.preventDefault();
    var r = c.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
    c.parentNode.insertBefore(dragCard, after ? c.nextSibling : c);
  });
  app.addEventListener('drop', function (e) { if (dragCard) e.preventDefault(); });
  app.addEventListener('dragend', function () { if (dragCard) dragCard.classList.remove('dragging'); dragCard = null; });

  /* ---------- run / stop ---------- */
  function run(id, watch) {
    var s = byId(id);
    if (!s) return;
    if (s.askFirst && !confirm('Run “' + s.plain + '”?')) return;
    if (s.vars && (s.vars.foregroundOnly || s.vars.directPHP)) return runClassic(s);
    // A script that asks a question first: the run window opens and asks.
    if (askOf(s)) return openRun(id);
    // "Run" opens the run window: live output, and closing it stops the script
    // (like Unraid's own script window). "Run in background" just starts it.
    if (watch) { openRun(id); return startRun('live'); }
    post({ a: 'run', id: id }).then(function () {
      toast('Started ' + s.plain);
      setTimeout(refresh, 600);
    }).catch(function (e) { toast(e.message, true); });
  }

  /* A question the script asks before it runs (User Scripts' #argumentDescription=...).
     Choices can be offered at the end: "What to do? [report:📋 Report only|clean:🧹 Clean up]".
     The answer becomes the script's $1 (and $2 ... if it has spaces). */
  function askOf(s) {
    var d = s && s.vars && s.vars.argumentDescription;
    if (!d) return null;
    var m = d.match(/\[([^\]]*\|[^\]]*)\]\s*$/);
    var choices = m ? m[1].split('|').map(function (c) {
      var i = c.indexOf(':'), v = (i > 0 ? c.slice(0, i) : c).trim();
      return { v: v, label: (i > 0 ? c.slice(i + 1) : c).trim() || v };
    }).filter(function (c) { return c.v; }) : null;
    return { q: (m ? d.slice(0, m.index) : d).trim(), choices: choices, def: s.vars.argumentDefault || '' };
  }

  /* ---------- the run window ---------- */
  function openRun(id) {
    ensureOverlay();
    var ask = askOf(byId(id));
    S.modal = { kind: 'run', id: id, mode: null, startAt: null, follow: true, find: '', fmt: null, log: null,
      ask: ask ? { value: ask.def || (ask.choices ? ask.choices[0].v : '') } : null };
    renderModal();
    showOverlay();
    loadLog();
  }
  /* mode 'live': closing the window stops the script; 'bg': it keeps running. */
  function startRun(mode) {
    var m = S.modal;
    if (!m || m.kind !== 'run') return;
    var s = byId(m.id);
    m.mode = mode;
    m.startAt = Math.floor(Date.now() / 1000) - 2;            // until a run this new appears, show "Starting…"
    m.follow = true;
    renderModal();
    var p = { a: 'run', id: m.id };
    if (m.ask) { p.args = m.ask.value; m.asked = m.ask.value; }
    post(p).then(function () {
      setTimeout(function () { refresh(); loadLog(); }, 500);
    }).catch(function (e) { m.startAt = null; m.mode = null; renderModal(); toast(e.message, true); });
  }
  function runState(m, s) {
    var runs = m.log ? m.log.runs : [], r = runs[runs.length - 1];
    var mine = r && m.startAt && r.start >= m.startAt ? r : null;
    if (m.startAt && !mine && Date.now() / 1000 - m.startAt < 30) return { phase: 'starting', run: null };
    if ((s && s.running) || (mine && mine.live) || (m.log && m.log.running)) return { phase: 'running', run: mine || r };
    if (mine) return { phase: 'done', run: mine };
    return { phase: 'idle', run: r };
  }
  function runHtml(s) {
    var m = S.modal, st = runState(m, s), busy = st.phase === 'starting' || st.phase === 'running';
    var detailsOk = !busy || m.mode === 'bg';
    var h = '<div class="sd-mh">' + iconHtml(s, state(s).ring) + '<div style="flex:1;min-width:0"><h2>' + s.title + '</h2>' +
      (s.desc ? '<p>' + esc(s.desc) + '</p>' : '') + '</div>' +
      '<button type="button" class="sd-x" data-rclose aria-label="Close" title="' + (busy && m.mode === 'live' ? 'Close and stop the script' : 'Close') + '">' + svg(I.x, 16) + '</button></div>' +
      '<div class="sd-acts">' +
      '<button type="button" class="sd-btn dark" data-rrun' + (busy ? ' disabled' : '') + '>' + svg(I.play, 13, true) + 'Run</button>' +
      '<button type="button" class="sd-btn" data-rbg' + (busy ? ' disabled' : '') + '>Run in background</button>' +
      '<button type="button" class="sd-btn" data-rdetails' + (detailsOk ? '' : ' disabled title="Available when the script finishes (closing this window would stop it)"') + '>Details</button>' +
      (st.phase === 'done' ? '<button type="button" class="sd-btn accent push" data-rdone>Done</button>' : '') + '</div>';
    var ask = m.ask && askOf(s);
    if (ask) {
      h += '<div class="sd-ask' + (busy ? ' off' : '') + '"><span class="q">❓ ' + esc(ask.q || 'Argument for this run') + '</span>';
      if (ask.choices) ask.choices.forEach(function (c) {
        var on = m.ask.value === c.v;
        h += '<button type="button" class="sd-btn sm' + (on ? ' on' : '') + '" data-ans="' + esc(c.v) + '" aria-pressed="' + on + '"' + (busy ? ' disabled' : '') + '>' + esc(c.label) + '</button>';
      });
      else h += '<input class="sd-input" id="sd-arg" value="' + esc(m.ask.value) + '" aria-label="' + esc(ask.q || 'Argument') + '"' + (busy ? ' disabled' : '') + '>';
      h += busy && m.asked != null ? '<span class="sd-help">running with: <b>' + esc(m.asked || '(nothing)') + '</b></span>' : '<span class="sd-help">then press Run</span>';
      h += '</div>';
    }
    var status, cls = '';
    if (st.phase === 'starting') { status = 'Starting…'; cls = 'run'; }
    else if (st.phase === 'running') { status = '● Running <span class="el">' + (st.run && st.run.start ? elapsed(st.run.start) : '') + '</span>' + (m.mode === 'live' ? ' · closing this window stops it' : m.mode === 'bg' ? ' · in the background' : ''); cls = 'run'; }
    else if (st.phase === 'done') { var rr = st.run; status = rr.aborted ? '■ Stopped' : '✓ Finished' + (rr.end ? ' in ' + esc(dur(rr.start, rr.end)) : ''); cls = rr.aborted ? 'stop' : 'ok'; }
    else status = st.run ? 'Last run ' + esc(when(st.run.start)) + (st.run.end ? ' · took ' + esc(dur(st.run.start, st.run.end)) : '') : 'Ready to run';
    h += '<div class="sd-rbody"><div class="sd-row sd-rstat"><span class="st ' + cls + '">' + status + '</span>' + fmtSwitch() + '</div>' +
      '<div class="sd-out sd-rout" role="log" aria-live="polite"></div></div>';
    return h;
  }
  function closeRun() {
    var m = S.modal, s = m && byId(m.id), st = m && runState(m, s);
    if (st && (st.phase === 'running' || st.phase === 'starting') && m.mode === 'live') {
      if (!confirm('Closing this window stops “' + (s ? s.plain : m.id) + '”. Stop it and close?')) return;
      var id = m.id;
      m.dirty = false; closeModal();
      post({ a: 'stop', id: id }).then(function () { toast('Stopped'); refresh(); }).catch(function (e) { toast(e.message, true); });
      return;
    }
    closeModal();
  }
  // Leaving or reloading the page during a live run would leave it running unseen: warn first.
  window.addEventListener('beforeunload', function (e) {
    var m = S.modal;
    if (m && m.kind === 'run' && m.mode === 'live') {
      var st = runState(m, byId(m.id));
      if (st.phase === 'running' || st.phase === 'starting') { e.preventDefault(); e.returnValue = ''; }
    }
  });
  /* Scripts marked foregroundOnly / directPHP run the original way, in Unraid's window. */
  function runClassic(s) {
    var path = '/boot/config/plugins/user.scripts/scripts/' + s.id + '/script';
    if (typeof window.$ === 'undefined' || typeof window.openBox !== 'function') { location.href = '/Settings/Userscripts'; return; }
    var action = s.vars.directPHP ? 'directRunScript' : 'convertScript';
    window.$.post('/plugins/user.scripts/exec.php', { action: action, path: path, csrf_token: csrf() }, function (data) {
      if (!data) return;
      if (s.vars.directPHP) window.openBox(data, 'Script ' + s.id + ' Running', 800, 1200);
      else window.openBox('/plugins/user.scripts/startScript.sh&arg1=' + data + '&arg2=' + (s.vars.argumentDefault || ''), 'Script ' + s.id + ' Running', 800, 1200, true);
    });
  }
  function stop(id) {
    var s = byId(id);
    if (!confirm('Stop “' + (s ? s.plain : id) + '”?')) return;
    post({ a: 'stop', id: id }).then(function () { toast('Stopped'); refresh(); if (S.modal) loadLog(); }).catch(function (e) { toast(e.message, true); });
  }
  function pin(id, on) { post({ a: 'pin', id: id, pinned: on ? '1' : '0' }).then(refresh).catch(function (e) { toast(e.message, true); }); }

  /* ---------- script output: formatted (like Unraid's window) or plain ---------- */
  var OK_TAGS = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, FONT: 1, SPAN: 1, DIV: 1, P: 1, BR: 1, CENTER: 1, PRE: 1, CODE: 1, HR: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
    TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TD: 1, TH: 1, UL: 1, OL: 1, LI: 1, SMALL: 1, BIG: 1, SUB: 1, SUP: 1, A: 1, MARK: 1, S: 1, STRIKE: 1, BLOCKQUOTE: 1 };
  var OK_CSS = /^(color|background|background-color|font-size|font-weight|font-style|text-align|text-decoration|padding(-\w+)?|margin(-\w+)?|border(-\w+)*|width|display|line-height|white-space)$/;
  function cleanInto(src, dst) {
    Array.prototype.forEach.call(src.childNodes, function (n) {
      if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); return; }
      if (n.nodeType !== 1) return;
      if (!OK_TAGS[n.tagName]) { cleanInto(n, dst); return; }
      var e = document.createElement(n.tagName);
      ['color', 'size', 'align', 'colspan', 'rowspan'].forEach(function (a) { if (n.hasAttribute(a)) e.setAttribute(a, n.getAttribute(a)); });
      if (n.tagName === 'A' && /^https?:/i.test(n.getAttribute('href') || '')) { e.setAttribute('href', n.getAttribute('href')); e.setAttribute('target', '_blank'); e.setAttribute('rel', 'noopener'); }
      var st = n.getAttribute('style');
      if (st) {
        var keep = st.split(';').filter(function (p) {
          var k = p.split(':')[0].trim().toLowerCase();
          return OK_CSS.test(k) && !/url\(|expression|javascript/i.test(p);
        }).join(';');
        if (keep) e.setAttribute('style', keep);
      }
      cleanInto(n, e);
      dst.appendChild(e);
    });
  }
  function isHtml(t) { return /<(b|i|u|font|span|div|p|br|center|strong|em|table|h[1-6]|hr|pre)\b[^>]*>/i.test(t); }
  function noise(l) { return l.indexOf('Full logs for this script are available at') < 0 && !/^Script (Starting|Finished) \w{3} \d/.test(l); }
  /* One run's lines minus User Scripts' padding: no leading/trailing blank
     lines and never more than one blank line in a row. */
  function runLines(text) {
    var out = [], blank = false;
    String(text || '').split('\n').filter(noise).forEach(function (l) {
      var b = !l.trim();
      if (b && (blank || !out.length)) return;
      out.push(l); blank = b;
    });
    while (out.length && !out[out.length - 1].trim()) out.pop();
    return out;
  }
  function markText(root, q) {
    if (!q) return 0;
    var n = 0, re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (t) {
      var v = t.nodeValue;
      if (!re.test(v)) return;
      re.lastIndex = 0;
      var frag = document.createDocumentFragment(), last = 0;
      v.replace(re, function (m, i) {
        frag.appendChild(document.createTextNode(v.slice(last, i)));
        var mk = document.createElement('mark'); mk.textContent = m; frag.appendChild(mk);
        last = i + m.length; n++;
      });
      frag.appendChild(document.createTextNode(v.slice(last)));
      t.parentNode.replaceChild(frag, t);
    });
    return n;
  }
  /* Fill an output box (a placeholder div) after the HTML is in the page. */
  function fillOutput(box, text, fmt, find) {
    var lines = runLines(text), html = fmt === 'html';
    box.className = 'sd-out ' + (html ? 'html' : 'plain') + ' ' + (box.dataset.size || '');
    box.innerHTML = '';
    if (!lines.length) { box.textContent = text && /Script Starting/.test(text) && !/Script Finished|aborted/.test(text) ? 'Running… waiting for output.' : 'This run printed nothing.'; return 0; }
    if (html) {
      var doc = new DOMParser().parseFromString('<div>' + lines.join('\n') + '</div>', 'text/html');
      cleanInto(doc.body.firstChild || doc.body, box);
    } else {
      var f = document.createDocumentFragment();
      lines.forEach(function (l, i) {
        var d = document.createElement('div');
        d.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="l"></span>';
        d.lastChild.textContent = l || ' ';
        f.appendChild(d);
      });
      box.appendChild(f);
    }
    return markText(box, (find || '').trim());
  }

  /* ---------- modal ---------- */
  var ov = null;
  function ensureOverlay() {
    if (ov) return;
    ov = document.createElement('div');
    ov.className = 'sd-ov';
    ov.innerHTML = '<div class="sd-modal" role="dialog" aria-modal="true" aria-label="Script"></div>';
    // Clicking outside closes a window, except the run window (hard to close on purpose).
    ov.addEventListener('mousedown', function (e) { if (e.target === ov && !(S.modal && S.modal.kind === 'run')) closeModal(); });
    ov.addEventListener('click', onClick);
    ov.addEventListener('input', onInput);
    ov.addEventListener('change', onChange);
    ov.addEventListener('keydown', onKey);
    ov.addEventListener('dragstart', onDragStart);
    ov.addEventListener('dragover', onDragOver);
    ov.addEventListener('dragleave', onDragLeave);
    ov.addEventListener('drop', onDrop);
    ov.addEventListener('dragend', onDragEnd);
    document.body.appendChild(ov);
    applyEmojiStyle();
  }
  function showOverlay() {
    ov.style.display = 'flex';
    void ov.offsetWidth;                       // let the browser see the start state, so it animates
    ov.classList.add('show');
  }
  function openModal(id, tab) {
    ensureOverlay();
    S.modal = { kind: 'view', id: id, tab: tab || 'overview', edit: false, etab: 'card', run: null, follow: true, find: '', fmt: null, log: null };
    renderModal();
    showOverlay();
    loadLog();
  }
  function closeModal() {
    if (!ov || !S.modal) return;
    if (S.modal.dirty && !confirm('Discard your changes?')) return;
    ov.classList.remove('show');
    S.modal = null;
    setTimeout(function () { if (!S.modal && ov) ov.style.display = 'none'; }, 300);
  }
  function loadLog() {
    if (!S.modal || (S.modal.kind !== 'view' && S.modal.kind !== 'run')) return;
    var id = S.modal.id;
    return get({ a: 'log', id: id }).then(function (d) {
      if (!S.modal || S.modal.id !== id) return;
      var old = S.modal.log, prev = old ? old.runs.length : 0;
      S.modal.log = d;
      if (S.modal.run == null || (S.modal.follow && d.runs.length !== prev) || S.modal.run >= d.runs.length) S.modal.run = d.runs.length - 1;
      if (S.modal.fmt == null) {
        // The user's last Formatted/Plain choice wins; otherwise guess from the output.
        var last = d.runs[d.runs.length - 1];
        S.modal.fmt = S.fmtPref || (last && isHtml(last.text) ? 'html' : 'plain');
      }
      var same = old && old.running === d.running && old.runs.length === d.runs.length &&
        (!d.runs.length || old.runs[old.runs.length - 1].text === d.runs[d.runs.length - 1].text);
      if (old && old.running && !d.running) refresh();          // just finished: update the tile too
      // The run window updates as soon as output arrives (only a text selection holds it back).
      if (!S.modal.edit && !same && (S.modal.kind === 'run' ? !selecting() : !busy())) renderModal(true);
    });
  }

  function renderModal(soft) {
    if (!ov || !S.modal) return;
    var m = S.modal, box = ov.firstChild;
    box.classList.toggle('run', m.kind === 'run');
    if (m.kind === 'cats') { box.innerHTML = catsHtml(); return; }
    var s = byId(m.id);
    if (!s) { closeModal(); return; }
    if (m.kind === 'run') return renderRun(s, soft);
    var runs0 = m.log ? m.log.runs : [], newest = runs0[runs0.length - 1];
    m.starting = !!(m.startAt && Date.now() / 1000 - m.startAt < 30 && !(newest && newest.start >= m.startAt));
    var h0 = box.getBoundingClientRect().height, animate = ov.classList.contains('show') && !!box.animate;
    if (animate) box.getAnimations().forEach(function (a) { a.cancel(); });
    var outBox = $('.sd-out', box), keepScroll = soft && outBox ? outBox.scrollTop : null, atBottom = outBox && outBox.scrollTop + outBox.clientHeight >= outBox.scrollHeight - 8;
    var findFocused = document.activeElement && document.activeElement.id === 'sd-find';
    var h = m.edit ? editHead(s) : viewHead(s);
    if (m.edit) {
      h += '<nav class="sd-mtabs" aria-label="Edit sections">' + ['card', 'schedule', 'script'].map(function (t) {
        return '<button type="button" class="sd-tab' + (m.etab === t ? ' on' : '') + '" data-etab="' + t + '">' + { card: 'Card', schedule: 'Schedule', script: 'Script' }[t] + '</button>';
      }).join('') + '</nav><div class="sd-mbody">' + (m.etab === 'card' ? editCard(s) : m.etab === 'script' ? editScript(s) : editSchedule(s)) + '</div>';
    } else {
      h += '<nav class="sd-mtabs" aria-label="Script sections">' +
        '<button type="button" class="sd-tab' + (m.tab === 'overview' ? ' on' : '') + '" data-mtab="overview">Overview</button>' +
        '<button type="button" class="sd-tab' + (m.tab === 'log' ? ' on' : '') + '" data-mtab="log">Log</button></nav>' +
        '<div class="sd-mbody">' + (m.tab === 'log' ? logTab(s) : overview(s)) + '</div>';
    }
    box.innerHTML = h;
    // Fill the output box now that it exists.
    var ob = $('.sd-out', box);
    if (ob && m.tab === 'overview' && m.starting) {
      ob.className = 'sd-out plain tall live';
      ob.textContent = 'Starting… the output appears here as soon as the script prints something.';
    } else if (ob && m.log && m.log.runs.length) {
      var r = m.tab === 'log' ? (m.log.runs[m.run] || m.log.runs[m.log.runs.length - 1]) : m.log.runs[m.log.runs.length - 1];
      var hits = fillOutput(ob, r.text, m.fmt, m.tab === 'log' ? m.find : '');
      var c = $('.sd-find .c', box); if (c) c.textContent = m.find.trim() ? hits + ' match' + (hits === 1 ? '' : 'es') : '';
      var follow = m.tab === 'overview' ? (s.running || atBottom || !soft) : (m.follow && m.run === m.log.runs.length - 1);
      if (follow) ob.scrollTop = ob.scrollHeight;
      else if (keepScroll != null) ob.scrollTop = keepScroll;
    }
    if (findFocused) { var f = $('#sd-find', box); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
    // The window grows/shrinks with its content: animate that instead of jumping.
    if (animate) {
      var h1 = box.getBoundingClientRect().height;
      if (Math.abs(h1 - h0) > 6) box.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }

  function renderRun(s, soft) {
    var m = S.modal, box = ov.firstChild;
    var ob0 = $('.sd-rout', box), keep = soft && ob0 ? ob0.scrollTop : null;
    var atBottom = !ob0 || ob0.scrollTop + ob0.clientHeight >= ob0.scrollHeight - 8;
    var typing = document.activeElement && document.activeElement.id === 'sd-arg' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    box.innerHTML = runHtml(s);
    if (typing) { var ai = $('#sd-arg', box); if (ai) { ai.focus(); ai.setSelectionRange(typing[0], typing[1]); } }
    var ob = $('.sd-rout', box), st = runState(m, s);
    if (st.phase === 'starting') { ob.className = 'sd-out sd-rout plain'; ob.textContent = 'Starting… the output appears here as soon as the script prints something.'; }
    else if (st.run) fillOutput(ob, st.run.text, m.fmt || S.fmtPref || (isHtml(st.run.text) ? 'html' : 'plain'), '');
    else { ob.className = 'sd-out sd-rout plain'; ob.textContent = 'Press Run to start the script. Its output appears here, live.'; }
    ob.classList.add('sd-rout');
    // Follow the output while it runs, unless the user scrolled up to read.
    if (st.phase !== 'done' && (atBottom || !soft)) ob.scrollTop = ob.scrollHeight;
    else if (keep != null) ob.scrollTop = keep;
    if (st.phase === 'done' && !soft) ob.scrollTop = ob.scrollHeight;
    var d = $('[data-rdone]', box); if (d && !m.doneFocused) { m.doneFocused = true; d.focus(); }
  }

  function viewHead(s) {
    return '<div class="sd-mh">' + iconHtml(s, state(s).ring) + '<div style="flex:1;min-width:0"><h2>' + s.title + '</h2>' +
      (s.desc ? '<p>' + esc(s.desc) + '</p>' : '') + '</div>' +
      '<button type="button" class="sd-x" data-close aria-label="Close">' + svg(I.x, 16) + '</button></div>' +
      '<div class="sd-acts">' +
      (s.running
        ? '<button type="button" class="sd-btn" data-stop="' + esc(s.id) + '">' + svg(I.stop, 12, true) + 'Stop</button>'
        : '<button type="button" class="sd-btn dark" data-runwatch="' + esc(s.id) + '">' + svg(I.play, 13, true) + 'Run</button>' +
          '<button type="button" class="sd-btn" data-run="' + esc(s.id) + '">Run in background</button>') +
      '<button type="button" class="sd-btn' + (s.pinned ? ' on' : '') + '" data-pin="' + esc(s.id) + '" aria-pressed="' + s.pinned + '">📌 ' + (s.pinned ? 'Pinned' : 'Pin') + '</button>' +
      '<button type="button" class="sd-btn push" data-edit>' + svg(I.edit, 14) + 'Edit</button></div>';
  }
  function fmtSwitch() {
    var f = S.modal.fmt || 'plain';
    return '<div class="sd-seg" role="group" aria-label="Output view"><button type="button" class="' + (f === 'html' ? 'on' : '') + '" data-fmt="html">Formatted</button>' +
      '<button type="button" class="' + (f === 'plain' ? 'on' : '') + '" data-fmt="plain">Plain</button></div>';
  }

  function overview(s) {
    var L = s.last, log = S.modal.log, runs = log ? log.runs : [];
    var h = '<div class="sd-stats">';
    if (s.running) h += '<div><span class="sd-k">Running for</span><strong>' + (s.runningSince ? elapsed(s.runningSince) : '…') + '</strong><span class="sub">started ' + when(s.runningSince) + '</span></div>';
    else h += '<div><span class="sd-k">Last run</span><strong>' + (L && L.start ? when(L.start) : '—') + '</strong><span class="sub' + (L && !L.aborted ? ' ok' : '') + '">' +
      (L && L.start ? (L.aborted ? 'stopped by user' : '✓ finished' + (L.end ? ' · ' + dur(L.start, L.end) : '')) : 'no run recorded yet') + '</span></div>';
    h += '<div><span class="sd-k">Next run</span><strong>' + (s.schedule.next ? whenNext(s.schedule.next) : '—') + '</strong><span class="sub">' +
      (s.schedule.next ? nextText(s.schedule.next) : (s.schedule.kind === 'manual' ? 'only when you run it' : 'on an array event')) + '</span></div>';
    h += '<div><span class="sd-k">Runs</span><strong title="' + esc(s.schedule.text) + '">' + esc(s.schedule.text) + '</strong><span class="sub sd-mono">' + esc(s.schedule.cron || '') + '</span></div>';
    h += '<div><span class="sd-k">Today</span><strong>' + s.runsToday + ' run' + (s.runsToday === 1 ? '' : 's') + '</strong><span class="sub">' + runs.length + ' kept in history</span></div></div>';

    var done = runs.filter(function (r) { return !r.live; });
    if (done.length > 1) {
      var last = done.slice(-60), max = 1;
      last.forEach(function (r) { max = Math.max(max, (r.end || r.start) - r.start); });
      h += '<div class="sd-row"><span class="sd-k">Last ' + last.length + ' runs</span><span class="sd-help">each bar is one run; height is how long it took</span></div><div class="sd-bars" role="img" aria-label="Recent runs">';
      last.forEach(function (r, i) {
        var d = (r.end || r.start) - r.start, hgt = 6 + Math.round(30 * d / max);
        h += '<span class="' + (r.aborted ? 'ab' : (i === last.length - 1 ? 'last' : '')) + '" style="height:' + hgt + 'px" title="' + esc(when(r.start) + (r.end ? ' · ' + dur(r.start, r.end) : '')) + '"></span>';
      });
      h += '</div><div class="sd-row sd-help"><span>' + when(last[0].start) + '</span><span>' + when(last[last.length - 1].start) + '</span></div>';
    }
    if (runs.length || S.modal.starting) {
      var r = S.modal.starting ? { live: true, start: 0 } : runs[runs.length - 1];
      h += '<div class="sd-row" style="margin:16px 0 8px;align-items:center"><span class="sd-k">' + (S.modal.starting ? 'Output · starting…' : r.live ? 'Output so far · live' : 'Last output · ' + esc(when(r.start))) + '</span>' +
        '<span style="display:flex;gap:10px;align-items:center">' + fmtSwitch() + '<a href="#" data-mtab="log">Open in Log tab →</a></span></div>' +
        '<div class="sd-out" data-size="tall' + (r.live ? ' live' : '') + '"></div>';
    } else {
      h += '<p class="sd-help" style="margin-top:16px">No output recorded yet. ' + (S.data.history ? 'Runs are saved from now on, so they survive reboots.' : '') + '</p>';
    }
    var v = s.vars || {}, opts = [];
    if (v.arrayStarted) opts.push('needs the array started');
    if (v.foregroundOnly) opts.push('runs in a window only');
    if (v.backgroundOnly) opts.push('background only');
    if (v.directPHP) opts.push('PHP script');
    h += '<dl class="sd-dl"><dt>Category</dt><dd>' + esc(s.category ? catName(s.category) : 'Other') + '</dd>' +
      '<dt>Ask before running</dt><dd>' + (s.askFirst ? 'Yes' : 'No') + '</dd>' +
      (opts.length ? '<dt>Script options</dt><dd>' + esc(opts.join(', ')) + '</dd>' : '') +
      '<dt>Script file</dt><dd class="sd-mono">/boot/config/plugins/user.scripts/scripts/' + esc(s.id) + '/script</dd></dl>';
    return h;
  }

  function logTab(s) {
    var m = S.modal, log = m.log;
    if (!log) return '<div class="sd-empty">Loading…</div>';
    if (!log.runs.length) return '<div class="sd-empty">No runs recorded yet. Run the script and its output appears here, live.</div>';
    var h = '<div class="sd-log"><div class="sd-runs">', group = '', day = dayStart();
    for (var i = log.runs.length - 1; i >= 0; i--) {
      var r = log.runs[i], g = r.start >= day ? 'Today' : r.start >= day - 86400 ? 'Yesterday' : 'Earlier';
      if (g !== group) { h += '<div class="grp">' + g + '</div>'; group = g; }
      h += '<button type="button" class="sd-run' + (m.run === i ? ' on' : '') + '" data-runi="' + i + '"><span class="sd-dot' + (r.live ? ' run' : r.aborted ? ' ab' : '') + '">' + (r.live ? '●' : r.aborted ? '■' : '✓') + '</span>' +
        '<span>' + esc(g === 'Earlier' ? when(r.start) : hm(r.start)) + '</span><span class="d">' + (r.live ? 'live' : esc(dur(r.start, r.end))) + '</span></button>';
    }
    h += '<p class="sd-help" style="margin:auto 0 0;padding:10px">' + (log.history ? 'The last 60 runs are kept in appdata, so they survive reboots.' : 'Runs are kept until the next reboot.') + '</p></div>';
    var r2 = log.runs[m.run] || log.runs[log.runs.length - 1];
    h += '<div class="sd-viewer"><div class="sd-tools"><label class="sd-find">' + svg(I.search, 13) +
      '<input id="sd-find" type="search" placeholder="Find in output" value="' + esc(m.find) + '" aria-label="Find in output"><span class="c"></span></label>' + fmtSwitch() +
      '<label class="sd-chk"><input type="checkbox" id="sd-follow"' + (m.follow ? ' checked' : '') + '> Follow live</label>' +
      '<button type="button" class="sd-btn sm" data-download>Download</button>' +
      '<button type="button" class="sd-btn sm danger" data-clearlog' + (log.running ? ' disabled' : '') + ' title="Delete User Scripts\' current log (runs since the last reboot)">Clear</button></div>' +
      '<div class="sd-row" style="font-size:12.5px"><strong>' + esc(when(r2.start)) + (r2.live ? ' · running ' + elapsed(r2.start) : (r2.end ? ' · finished in ' + esc(dur(r2.start, r2.end)) : '')) + '</strong>' +
      (r2.live ? '<span style="color:var(--run);font-weight:600">● live</span>' : r2.aborted ? '<span style="color:#b45309;font-weight:600">■ stopped by user</span>' : '<span style="color:#14632f;font-weight:600">✓ finished</span>') + '</div>' +
      '<div class="sd-out" role="log" aria-live="polite"></div></div></div>';
    return h;
  }

  /* ---------- edit ---------- */
  // '' = default (light grey for icons/emoji, white for images); 'clear' = no background at all.
  var TINTS = ['', 'clear', 'white', 'amber', 'teal', 'blue', 'plum', 'rose', 'slate', 'green'];
  var TINT_BG = { '': '#f4f4f4', clear: 'repeating-conic-gradient(#d9d9d9 0 25%,#fff 0 50%) 0 0/8px 8px', white: '#ffffff', amber: '#fdf0d8', teal: '#dcf2ee', blue: '#e3eafc', plum: '#f1e6f7', rose: '#fce4e4', slate: '#e6e6e6', green: '#e2f3e2' };
  var TINT_NAME = { '': 'Default', clear: 'None (transparent)', white: 'White' };
  var CARD_BG = ['', '#fffaf0', '#f0f7ff', '#f2fbf5', '#fbf2ff', '#fff3f3', '#f5f5f5', '#fffde8'];
  var COLORS = ['#1d1d1d', '#006cd9', '#b32d00', '#c2410c', '#15803d', '#6b2a86', '#b45309', '#0f766e'];
  var EMOJI = '🎵 🎧 💿 📀 🎬 🎞️ 📺 🖥️ 💻 🖨️ 🗄️ 💾 📦 📁 📂 🗂️ 📋 📝 📰 📊 📈 📉 🧾 🔒 🔑 🛡️ ⚙️ 🔧 🔨 🛠️ 🧰 🧹 🧽 🧼 🛀 🧊 ❄️ 🔥 ⚡ 🔌 🔋 💡 🌐 ☁️ 🌩️ 🚀 🛰️ 📡 🔔 📣 ⏰ ⏱️ 📆 🗓️ 🕑 ✅ ❌ ⚠️ ⛔ 🛑 ✋🏻 👋 👍 👨‍💻 🤖 🧠 👀 🔍 🔎 🐳 🐋 🐧 🍎 🪟 🏃 🚛 🚚 🔄 🔁 ♻️ 🗑️ ✂️ 🧩 🎨 🖌️ ⭐ 🌟 ✨ 🎯 🏁 🚦 📷 📸 🎥 🏠 🏡 🔐 🧪 🧬 🩺 ❤️ 🩹 💰 📌 📍 🔖 🏷️'.split(' ');

  function startEdit(s) {
    var c = s.icon && !s.icon.auto ? { t: s.icon.t, v: s.icon.v } : null;
    S.modal.edit = true;
    S.modal.etab = 'card';
    S.modal.dirty = false;
    var custom = s.schedule.custom || '';
    S.modal.draft = { title: s.title, desc: s.desc, icon: c, tint: s.tint || '', bg: s.bg || '', pinned: s.pinned, pinShow: !s.pinHide, askFirst: s.askFirst,
      category: s.category || '', src: 'suggested', emojiOpen: false, script: null,
      freq: s.schedule.freq || 'disabled', cron: custom || '0 3 * * *', builder: parseCron(custom || '0 3 * * *') };
    renderModal();
    get({ a: 'icons' }).then(function (d) { if (S.modal && S.modal.edit) { S.modal.icons = d; renderEditBody(); } });
  }
  function draftScript() {
    var s = byId(S.modal.id), d = S.modal.draft;
    var icon = d.icon || (s.icon.auto ? s.icon : { t: 'fa', v: 'terminal' });
    return { id: s.id, title: d.title, plain: '', desc: d.desc, icon: icon, tint: d.tint, bg: d.bg, pinned: d.pinned, askFirst: d.askFirst,
      running: false, last: s.last, schedule: s.schedule, runsToday: s.runsToday };
  }
  function editHead(s) {
    return '<div class="sd-edithead"><div style="display:flex;flex-direction:column;gap:6px"><span class="sd-k" style="color:var(--muted)">Editing · preview</span>' +
      '<div id="sd-prev">' + cardHtml(draftScript(), true) + '</div></div>' +
      '<div style="margin-left:auto;display:flex;gap:8px;align-self:flex-end">' +
      '<button type="button" class="sd-btn" data-cancel>Cancel</button><button type="button" class="sd-btn accent" data-save>Save</button></div></div>';
  }
  function renderEditBody() {
    if (!ov || !S.modal || !S.modal.edit) return;
    var s = byId(S.modal.id), body = $('.sd-mbody', ov), rich = $('#sd-rich', ov);
    if (rich) S.modal.draft.title = rich.innerHTML;
    var st = body ? body.scrollTop : 0;
    if (body && S.modal.etab === 'card') { body.innerHTML = editCard(s); body.scrollTop = st; }
    if (body && S.modal.etab === 'schedule') { body.innerHTML = editSchedule(s); body.scrollTop = st; previewCron(); }
    updatePreview();
  }
  function updatePreview() { var p = $('#sd-prev', ov); if (p) p.innerHTML = cardHtml(draftScript(), true); }
  function swatches(list, cur, attr, bgOf, pickId, label) {
    var h = '<div class="sd-swatches">';
    list.forEach(function (v) {
      var nm = (attr === 'tint' && TINT_NAME[v]) || v || 'none';
      h += '<button type="button" class="sd-sw' + (cur === v ? ' on' : '') + '" data-' + attr + '="' + v + '" aria-label="' + esc(label + ': ' + nm) + '" title="' + esc(nm) + '"><i style="background:' + bgOf(v) + '"></i></button>';
    });
    var custom = /^#/.test(cur) && list.indexOf(cur) < 0;
    h += '<label class="sd-pick' + (custom ? ' on' : '') + '" title="Pick any colour"><i style="background:' + (custom ? cur : 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)') + '"></i>' + (custom ? esc(cur) : 'Custom') +
      '<input type="color" id="' + pickId + '" value="' + (/^#/.test(cur) ? cur : '#d0e4ff') + '" aria-label="' + esc(label) + ' custom colour"></label></div>';
    return h;
  }

  function editCard(s) {
    var d = S.modal.draft;
    var h = '<div class="sd-field"><span class="sd-k">Title</span><div class="sd-tb">' +
      '<button type="button" class="sd-tbb" data-cmd="bold" aria-label="Bold" style="font-weight:800">B</button>' +
      '<button type="button" class="sd-tbb" data-cmd="italic" aria-label="Italic" style="font-style:italic;font-weight:500">I</button>' +
      '<button type="button" class="sd-tbb" data-cmd="underline" aria-label="Underline" style="text-decoration:underline;font-weight:500">U</button>' +
      '<button type="button" class="sd-tbb" data-cmd="insertLineBreak" aria-label="Line break" title="Line break (Enter)" style="font-weight:500">↵ Break</button><span class="sd-sep"></span>';
    COLORS.forEach(function (c) { h += '<button type="button" class="sd-sw" data-color="' + c + '" aria-label="Text colour ' + c + '" title="' + c + '"><i style="background:' + c + '"></i></button>'; });
    h += '<label class="sd-pick" title="Any text colour"><i style="background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red)"></i>Custom<input type="color" id="sd-anycolor" value="#006cd9" aria-label="Custom text colour"></label><span class="sd-sep"></span>' +
      '<button type="button" class="sd-tbb" data-emojis aria-expanded="' + d.emojiOpen + '">😀 Emoji</button>' +
      '<button type="button" class="sd-tbb" data-cmd="removeFormat" style="font-weight:500;color:var(--ink2)">Clear formatting</button></div>';
    if (d.emojiOpen) { h += '<div class="sd-emojis">'; EMOJI.forEach(function (e) { h += '<button type="button" data-insert="' + e + '">' + e + '</button>'; }); h += '</div>'; }
    h += '<div id="sd-rich" class="sd-rich" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Title" spellcheck="false">' + d.title + '</div>' +
      '<span class="sd-help">Select words, then pick a style or colour. Press Enter for a new line. The folder <span class="sd-mono">' + esc(s.id) + '</span> is not renamed; the title is saved to its <span class="sd-mono">name</span> file, so the classic page shows it too.</span></div>';

    h += '<label class="sd-field"><span class="sd-k">Description</span><input class="sd-input" id="sd-desc" type="text" value="' + esc(d.desc) + '"></label>';

    var icons = S.modal.icons || { docker: [], plugins: [], fa: [], uploads: [] };
    h += '<div class="sd-field sd-drop" id="sd-drop"><div class="sd-inline" style="gap:12px"><span class="sd-k">Icon</span><div class="sd-seg" role="tablist" aria-label="Icon source">';
    [['suggested', 'Suggested'], ['docker', 'Containers · ' + icons.docker.length], ['plugins', 'Plugins · ' + icons.plugins.length], ['emoji', 'Emoji'], ['fa', 'Icons · ' + icons.fa.length], ['upload', 'Upload']].forEach(function (x) {
      h += '<button type="button" class="' + (d.src === x[0] ? 'on' : '') + '" data-src="' + x[0] + '">' + x[1] + '</button>';
    });
    h += '</div></div><div class="sd-cells">';
    var cur = d.icon ? d.icon.t + ':' + d.icon.v : 'auto';
    // NB: not "data-icon" - Unraid's icon font draws a Docker whale on any [data-icon].
    function cell(t, v, label) { var k = t + ':' + v; return '<button type="button" class="sd-cell' + (cur === k ? ' on' : '') + '" data-pick="' + esc(k) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + iconInner({ t: t, v: v }) + '</button>'; }
    if (d.src === 'suggested') {
      h += '<button type="button" class="sd-cell' + (cur === 'auto' ? ' on' : '') + '" data-pick="auto" title="Automatic" aria-label="Automatic" style="font-size:12px;font-weight:700;width:auto;padding:0 12px">Auto</button>';
      suggest(s, icons).forEach(function (x) { h += cell(x.t, x.v, x.v); });
    } else if (d.src === 'docker') icons.docker.forEach(function (n) { h += cell('docker', n, n); });
    else if (d.src === 'plugins') icons.plugins.forEach(function (p) { h += cell('plugin', p.p, p.n); });
    else if (d.src === 'emoji') {
      var mine = d.icon && d.icon.t === 'emoji' && EMOJI.indexOf(d.icon.v) < 0 ? d.icon.v : '';
      h += '<div class="sd-emojiopt"><label class="sd-chk" title="Browsers use different emoji designs. Tick to prefer the Windows (Segoe UI Emoji) or Apple design when this computer has it.">' +
        '<input type="checkbox" id="sd-emoji-sys"' + (S.emoji === 'system' ? ' checked' : '') + '> Use Windows / Apple style emoji <span class="sd-help">(applies everywhere in Script Deck)</span></label></div>';
      h += '<div class="sd-ownemoji"><label for="sd-emoji-in" class="sd-help" style="font-weight:600;color:var(--ink2)">Your own:</label>' +
        '<input class="sd-input" id="sd-emoji-in" type="text" maxlength="16" value="' + esc(mine) + '" placeholder="Type or paste any emoji" autocomplete="off" spellcheck="false">' +
        '<button type="button" class="sd-btn sm" data-ownemoji>Use it</button>' +
        '<span class="sd-help">Windows: <kbd>Win</kbd> + <kbd>.</kbd> · Mac: <kbd>Ctrl</kbd> + <kbd>Cmd</kbd> + <kbd>Space</kbd></span></div>';
      if (mine) h += cell('emoji', mine, 'Your emoji');
      EMOJI.forEach(function (e) { h += cell('emoji', e, e); });
    }
    else if (d.src === 'fa') icons.fa.forEach(function (n) { h += cell('fa', n, n); });
    else {
      icons.uploads.forEach(function (n) { h += cell('upload', n, n); });
      h += '<label class="sd-cell" title="Choose an image to upload" style="font-size:26px;cursor:pointer">＋<input type="file" id="sd-upload" accept="image/png,image/svg+xml,image/jpeg,image/webp,image/gif" style="display:none"></label>';
    }
    h += '</div><span class="sd-help">' + { suggested: 'Picked from the title and name. Auto uses the emoji that starts the title, or a match from the name.', docker: 'Icons of your Docker containers.', plugins: 'Icons shipped with your installed plugins.', emoji: 'Any emoji. You can also start the title with one and choose Auto.', fa: 'Font Awesome icons built into Unraid.', upload: 'PNG, SVG, JPG, WEBP or GIF up to 256 KB, saved on the flash drive.' }[d.src] +
      ' <strong>Tip:</strong> drop an image file anywhere here to upload it.</span></div>';

    h += '<div class="sd-field"><span class="sd-k">Icon background</span>' + swatches(TINTS, d.tint, 'tint', function (v) { return TINT_BG[v]; }, 'sd-tintpick', 'Icon background') +
      '<span class="sd-help">The chequered swatch is “None”: no background, ideal for PNG icons with transparency. The next one is plain white.</span></div>';
    h += '<div class="sd-field"><span class="sd-k">Tile background</span>' + swatches(CARD_BG, d.bg, 'bg', function (v) { return v || '#ffffff'; }, 'sd-bgpick', 'Tile background') + '</div>';

    var cats = (S.data.categories || []).filter(function (c) { return !c.parent; });
    h += '<div class="sd-inline"><label class="sd-inline" style="gap:10px"><span class="sd-k">Category</span><select class="sd-select" id="sd-cat"><option value="">' + esc(otherName()) + ' (no category)</option>' +
      cats.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === d.category ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="sd-chk"><input type="checkbox" id="sd-pinned"' + (d.pinned ? ' checked' : '') + '> 📌 Pin to top</label>' +
      '<label class="sd-chk' + (d.pinned ? '' : ' off') + '" title="Only applies while the script is pinned"><input type="checkbox" id="sd-pinshow"' + (d.pinShow ? ' checked' : '') + (d.pinned ? '' : ' disabled') + '> Also show in its category</label>' +
      '<label class="sd-chk"><input type="checkbox" id="sd-ask"' + (d.askFirst ? ' checked' : '') + '> Ask before running</label></div>' +
      '<p class="sd-help" style="margin-top:10px">A pinned script is shown in Pinned and, unless you untick “Also show in its category”, in its category too. Unpinned, it is always back in its category.' + (S.data.catsShared ? ' Categories are shared with User Scripts Enhanced.' : '') + '</p>';
    return h;
  }
  function suggest(s, icons) {
    var hay = (s.id + ' ' + s.plain + ' ' + s.desc).toLowerCase(), out = [], seen = {};
    function add(t, v) { var k = t + v; if (!seen[k]) { seen[k] = 1; out.push({ t: t, v: v }); } }
    var m = s.plain.match(/(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/gu);
    (m || []).forEach(function (e) { add('emoji', e); });
    icons.docker.forEach(function (d) { var k = d.toLowerCase().replace(/[-_].*$/, ''); if (k.length >= 4 && hay.indexOf(k) >= 0) add('docker', d); });
    icons.plugins.forEach(function (p) { var k = p.p.split('/')[0].toLowerCase().replace(/^(dynamix\.|ca\.)/, '').split('.')[0]; if (k.length >= 4 && hay.indexOf(k) >= 0) add('plugin', p.p); });
    var words = { backup: 'archive', log: 'file-text-o', disk: 'hdd-o', docker: 'cube', clean: 'magic', delete: 'trash', music: 'music', movie: 'film', kodi: 'tv', plex: 'film', fan: 'tachometer', nvidia: 'microchip', mount: 'plug', update: 'refresh', camera: 'camera', health: 'heartbeat' };
    Object.keys(words).forEach(function (w) { if (hay.indexOf(w) >= 0) add('fa', words[w]); });
    ['terminal', 'cog', 'bolt', 'star', 'clock-o', 'database', 'server', 'shield'].forEach(function (f) { add('fa', f); });
    return out.slice(0, 18);
  }
  /* ---------- schedule (the same choices as User Scripts, saved the same way) ---------- */
  var FREQS = [
    ['disabled', '✋', 'Manual only', 'Schedule disabled'], ['hourly', '🕐', 'Hourly', ''], ['daily', '📅', 'Daily', ''],
    ['weekly', '🗓️', 'Weekly', ''], ['monthly', '📆', 'Monthly', ''], ['custom', '⚙️', 'Custom', 'Your own times'],
    ['start', '▶️', 'Array start', 'Each time the array starts'], ['stop', '⏹️', 'Array stop', 'When the array stops'],
    ['boot', '🔌', 'First array start', 'Only the first start after boot']
  ];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function parseCron(c) {
    var f = String(c || '').trim().split(/\s+/), n = /^\d+$/, x;
    if (f.length !== 5) return { mode: 'cron' };
    var rest = function (a) { return a.every(function (v) { return v === '*'; }); };
    if ((x = /^\*\/(\d+)$/.exec(f[0])) && rest(f.slice(1))) return { mode: 'min', n: +x[1] };
    if (n.test(f[0]) && f[1] === '*' && rest(f.slice(2))) return { mode: 'hour', n: 1, m: +f[0] };
    if (n.test(f[0]) && (x = /^\*\/(\d+)$/.exec(f[1])) && rest(f.slice(2))) return { mode: 'hour', n: +x[1], m: +f[0] };
    if (n.test(f[0]) && n.test(f[1])) {
      var t = pad(+f[1]) + ':' + pad(+f[0]);
      if (rest(f.slice(2))) return { mode: 'day', t: t };
      if (f[2] === '*' && f[3] === '*' && /^[0-7](,[0-7])*$/.test(f[4])) return { mode: 'week', t: t, days: f[4].split(',').map(function (d) { return +d % 7; }) };
      if (n.test(f[2]) && f[3] === '*' && f[4] === '*') return { mode: 'month', t: t, dom: +f[2] };
    }
    return { mode: 'cron' };
  }
  function buildCron(b, raw) {
    var tm = (b.t || '03:00').split(':'), H = +tm[0] || 0, M = +tm[1] || 0;
    switch (b.mode) {
      case 'min': return '*/' + Math.max(1, Math.min(59, b.n || 5)) + ' * * * *';
      case 'hour': return (b.m || 0) + ' ' + ((b.n || 1) > 1 ? '*/' + b.n : '*') + ' * * *';
      case 'day': return M + ' ' + H + ' * * *';
      case 'week': return M + ' ' + H + ' * * ' + ((b.days && b.days.length) ? b.days.slice().sort().join(',') : '0');
      case 'month': return M + ' ' + H + ' ' + Math.max(1, Math.min(31, b.dom || 1)) + ' * *';
      default: return raw || '0 3 * * *';
    }
  }
  function editSchedule(s) {
    var d = S.modal.draft, ft = S.data.freqTexts || {};
    var h = '<div class="sd-field"><span class="sd-k">When should it run?</span><div class="sd-freqs">';
    FREQS.forEach(function (f) {
      var sub = f[3] || ft[f[0]] || '';
      h += '<button type="button" class="sd-freq' + (d.freq === f[0] ? ' on' : '') + '" data-freq="' + f[0] + '" aria-pressed="' + (d.freq === f[0]) + '">' +
        '<span class="e">' + f[1] + '</span><span class="l">' + f[2] + '</span><span class="s">' + esc(sub) + '</span></button>';
    });
    h += '</div></div>';
    if (d.freq === 'custom') {
      var b = d.builder;
      h += '<div class="sd-field sd-builder"><span class="sd-k">Custom schedule</span><div class="sd-brow">' +
        '<label class="sd-blab">Repeat <select class="sd-select" id="sd-bmode" style="min-width:200px">' +
        [['min', 'Every few minutes'], ['hour', 'Every few hours'], ['day', 'Every day'], ['week', 'On certain weekdays'], ['month', 'Once a month'], ['cron', 'Advanced (cron line)']].map(function (o) {
          return '<option value="' + o[0] + '"' + (b.mode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select></label>';
      if (b.mode === 'min') h += '<label class="sd-blab">every <input class="sd-input sd-num" id="sd-bn" type="number" min="1" max="59" value="' + (b.n || 5) + '"> minutes</label>';
      if (b.mode === 'hour') h += '<label class="sd-blab">every <input class="sd-input sd-num" id="sd-bn" type="number" min="1" max="23" value="' + (b.n || 1) + '"> hour(s)</label><label class="sd-blab">at minute <input class="sd-input sd-num" id="sd-bm" type="number" min="0" max="59" value="' + (b.m || 0) + '"></label>';
      if (b.mode === 'day' || b.mode === 'week' || b.mode === 'month') {
        if (b.mode === 'month') h += '<label class="sd-blab">on day <input class="sd-input sd-num" id="sd-bdom" type="number" min="1" max="31" value="' + (b.dom || 1) + '"></label>';
        h += '<label class="sd-blab">at <input class="sd-input sd-time" id="sd-btime" type="time" value="' + esc(b.t || '03:00') + '"></label>';
      }
      h += '</div>';
      if (b.mode === 'week') {
        h += '<div class="sd-days" role="group" aria-label="Weekdays">';
        DAYS.forEach(function (n, i) { h += '<button type="button" class="sd-day' + ((b.days || []).indexOf(i) >= 0 ? ' on' : '') + '" data-day="' + i + '" aria-pressed="' + ((b.days || []).indexOf(i) >= 0) + '">' + n + '</button>'; });
        h += '</div>';
      }
      h += '<div class="sd-brow"><label class="sd-blab">Cron line <input class="sd-input sd-mono sd-cronin" id="sd-cron" type="text" value="' + esc(d.cron) + '" spellcheck="false"></label></div>' +
        '<div class="sd-cronprev" id="sd-cronprev" aria-live="polite"></div></div>';
    }
    var v = s.vars || {};
    if (v.foregroundOnly && d.freq !== 'disabled') h += '<p class="sd-warn">⚠ This script is marked <span class="sd-mono">foregroundOnly</span>, so User Scripts skips it on every schedule.</p>';
    if (v.arrayStarted && d.freq !== 'disabled') h += '<p class="sd-help">This script only runs while the array is started.</p>';
    h += '<p class="sd-help" style="margin-top:14px">Hourly, Daily, Weekly and Monthly use the times Unraid uses for its own scheduled jobs. Saved exactly like the classic User Scripts page, so both always show the same schedule.</p>';
    return h;
  }
  var cronTimer = null;
  function previewCron() {
    var el = $('#sd-cronprev', ov), d = S.modal && S.modal.draft;
    if (!el || !d) return;
    clearTimeout(cronTimer);
    cronTimer = setTimeout(function () {
      get({ a: 'cron', expr: d.cron }).then(function (r) {
        if (!$('#sd-cronprev', ov)) return;
        el.className = 'sd-cronprev' + (r.valid ? '' : ' bad');
        el.innerHTML = r.valid ? '<strong>' + esc(r.text) + '</strong> · next: ' + r.next.map(function (t) { return esc(whenNext(t)); }).join(', ')
          : 'Not a valid cron line. It needs 5 fields: minute hour day-of-month month weekday.';
      });
    }, 250);
  }
  function builderChanged() {
    var d = S.modal.draft;
    d.cron = buildCron(d.builder, d.cron);
    var c = $('#sd-cron', ov); if (c && c.value !== d.cron) c.value = d.cron;
    S.modal.dirty = true;
    previewCron();
  }
  function editScript(s) {
    var d = S.modal.draft;
    if (d.script == null) {
      get({ a: 'script', id: s.id }).then(function (r) { if (S.modal && S.modal.edit) { d.script = r.text; d.scriptOrig = r.text; renderModal(); } });
      return '<div class="sd-empty">Loading script…</div>';
    }
    return '<textarea class="sd-code" id="sd-code" spellcheck="false" aria-label="Script">' + esc(d.script) + '</textarea>' +
      '<p class="sd-help">Saved to <span class="sd-mono">/boot/config/plugins/user.scripts/scripts/' + esc(s.id) + '/script</span>. The previous version is kept as <span class="sd-mono">/boot/config/plugins/script.deck/last-edit-backup.sh</span>.</p>';
  }
  function saveEdit() {
    var m = S.modal, s = byId(m.id), d = m.draft, rich = $('#sd-rich', ov);
    var btn = $('[data-save]', ov);
    if (btn && btn.disabled) return;                       // already saving
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    var unlock = function () { var b = $('[data-save]', ov); if (b) { b.disabled = false; b.textContent = 'Save'; } };
    if (rich) d.title = rich.innerHTML;
    var p = { a: 'save', id: s.id, title: d.title, desc: d.desc, icon: JSON.stringify(d.icon || {}), tint: d.tint, bg: d.bg, pinned: d.pinned ? '1' : '0', pinHide: d.pinned && !d.pinShow ? '1' : '0', askFirst: d.askFirst ? '1' : '0' };
    if (d.category !== (s.category || '')) p.category = d.category;
    var jobs = [post(p)];
    if (d.freq !== s.schedule.freq || (d.freq === 'custom' && d.cron.trim() !== (s.schedule.custom || '').trim())) {
      jobs.push(post({ a: 'schedule', id: s.id, frequency: d.freq, custom: d.freq === 'custom' ? d.cron : '' }));
    }
    if (d.script != null && d.script !== d.scriptOrig) jobs.push(post({ a: 'saveScript', id: s.id, text: d.script }));
    Promise.all(jobs).then(function () {
      // Saved on the server: leave edit mode right away, then fetch fresh data.
      m.edit = false; m.dirty = false;
      toast('Saved');
      try { if (S.modal === m) renderModal(); } catch (er) { console.error(er); }
      refresh().then(function () { try { if (S.modal === m && !m.edit) renderModal(true); } catch (er) { console.error(er); } });
    }, function (e) {
      unlock();
      toast('Not saved: ' + e.message, true);
    });
  }
  function uploadFile(f) {
    if (!f || !/^image\/(png|svg\+xml|jpeg|webp|gif)$/.test(f.type)) return toast('Use a PNG, SVG, JPG, WEBP or GIF image', true);
    if (f.size > 262144) return toast('Images must be under 256 KB', true);
    var rd = new FileReader(), m = S.modal;
    rd.onload = function () {
      post({ a: 'upload', data: rd.result }).then(function (r) {
        m.draft.icon = { t: 'upload', v: r.file }; m.dirty = true; m.draft.src = 'upload';
        return get({ a: 'icons' }).then(function (d) { m.icons = d; renderEditBody(); toast('Icon uploaded'); });
      }).catch(function (er) { toast(er.message, true); });
    };
    rd.readAsDataURL(f);
  }

  /* ---------- category manager ---------- */
  function openCats() {
    ensureOverlay();
    S.modal = { kind: 'cats', list: null, dirty: false };
    get({ a: 'cats' }).then(function (d) {
      if (!S.modal || S.modal.kind !== 'cats') return;
      var list = d.cats.slice();
      // "Other" (scripts without a category) is a row too: rename and move it, but it can't be deleted.
      var oth = { id: '__other', name: otherName(), count: S.data.scripts.filter(function (s) { return !s.category; }).length, special: true };
      var pos = S.other && S.other.pos != null ? Math.min(S.other.pos, list.length) : list.length;
      list.splice(pos, 0, oth);
      S.modal.list = list; S.modal.shared = d.shared; renderModal();
    });
    renderModal();
    showOverlay();
  }
  function catsHtml() {
    var m = S.modal;
    var h = '<div class="sd-mh"><div style="flex:1"><h2>Categories</h2><p>Add, rename, delete, or drag to reorder. Deleting a category keeps its scripts; they move to “' + esc(otherName()) + '”.' +
      (m.shared ? ' Shared with User Scripts Enhanced, so changes show there too.' : '') + '</p></div>' +
      '<button type="button" class="sd-x" data-close aria-label="Close">' + svg(I.x, 16) + '</button></div><div class="sd-mbody" style="padding-top:4px">';
    if (!m.list) return h + '<div class="sd-empty">Loading…</div></div>';
    h += '<ul class="sd-catlist">';
    m.list.forEach(function (c, i) {
      h += '<li class="sd-catrow" data-ci="' + i + '"><span class="grip" data-grip title="Drag to reorder" aria-hidden="true">⋮⋮</span>' +
        '<input class="sd-input" data-cname="' + i + '" value="' + esc(c.name) + '" aria-label="Category name">' +
        '<span class="sd-badge" title="Scripts in this category">' + (c.count || 0) + '</span>' +
        '<button type="button" class="sd-ibtn" data-cup="' + i + '" aria-label="Move up"' + (i ? '' : ' disabled') + '>' + svg(I.up, 16) + '</button>' +
        '<button type="button" class="sd-ibtn" data-cdown="' + i + '" aria-label="Move down"' + (i < m.list.length - 1 ? '' : ' disabled') + '>' + svg(I.down, 16) + '</button>' +
        (c.special
          ? '<button type="button" class="sd-ibtn" disabled aria-label="Cannot be deleted" title="“' + esc(c.name) + '” holds every script without a category, so it can’t be deleted. Rename or move it freely.">' + svg(I.trash, 16) + '</button></li>'
          : '<button type="button" class="sd-ibtn del" data-cdel="' + i + '" aria-label="Delete category">' + svg(I.trash, 16) + '</button></li>');
    });
    h += '</ul><p class="sd-help" style="margin:12px 2px 0">Tip: start a name with an emoji, e.g. “💾 Backups”. Categories named like “Backups - Daily” and “Backups - Weekly” share one “Backups” button on the main page, with a section for each.</p></div>' +
      // The buttons stay pinned to the bottom of the window; only the list scrolls.
      '<div class="sd-catfoot"><button type="button" class="sd-btn" data-cadd>' + svg(I.plus, 14) + 'Add category</button>' +
      '<span class="push"><button type="button" class="sd-btn" data-close>Cancel</button><button type="button" class="sd-btn accent" data-csave>Save</button></span></div>';
    return h;
  }
  function saveCats() {
    var all = S.modal.list.filter(function (c) { return c.special || c.name.trim(); });
    var real = all.filter(function (c) { return !c.special; }).map(function (c) { return { id: c.id || '', name: c.name }; });
    var oi = -1;
    all.forEach(function (c, i) { if (c.special) oi = i; });
    var oth = all[oi] || { name: 'Other' };
    // Position = how many real categories come before it; at the very end = "last" (null).
    var other = { name: oth.name.trim() || 'Other', pos: oi < 0 || oi >= real.length ? null : oi };
    post({ a: 'cats', cats: JSON.stringify(real) }).then(function () {
      return post({ a: 'ui', other: JSON.stringify(other) });
    }).then(function () {
      S.other = other;
      toast('Categories saved'); S.modal.dirty = false; closeModal(); refresh();
    }).catch(function (e) { toast(e.message, true); });
  }

  /* ---------- events ---------- */
  function onClick(e) {
    var t = e.target.closest('button, a, [data-open], label');
    if (!t) return;
    var ds = t.dataset;
    if (ds.tab) { S.tab = ds.tab; save('tab', S.tab); renderPage(); return; }
    if (ds.sec) { var sh = !S.shut[ds.sec]; toggleSection(ds.sec, sh); return; }
    if (ds.allsec) { var shut = ds.allsec === 'shut'; flatSecs().forEach(function (x) { toggleSection(x.key, shut); }); return; }
    if (ds.managecats !== undefined) return openCats();
    if (ds.arrange) { S.reorder = ds.arrange; renderPage(); return; }
    if (ds.arrcancel !== undefined) { S.reorder = null; renderPage(); return; }
    if (ds.arrdone) { saveOrder(ds.arrdone); return; }
    if (ds.mv) { moveCard(t.closest('.sd-card.arr'), +ds.mv); return; }
    if (ds.run) { e.stopPropagation(); run(ds.run, false); return; }
    if (ds.runwatch) { e.stopPropagation(); run(ds.runwatch, true); return; }
    if (ds.stop) { e.stopPropagation(); stop(ds.stop); return; }
    if (ds.pin) { var s0 = byId(ds.pin); pin(ds.pin, !s0.pinned); return; }
    if (ds.open !== undefined && t.classList.contains('sd-card')) {
      if (selectionIn(t)) return;              // the user was selecting text in the tile, not opening it
      openModal(ds.open); return;
    }
    if (!S.modal) return;
    var m = S.modal;
    if (ds.close !== undefined) return closeModal();
    if (m.kind === 'run') {
      if (ds.rclose !== undefined) return closeRun();
      if (ds.ans !== undefined) { m.ask.value = ds.ans; return renderModal(true); }
      if (ds.rrun !== undefined) return startRun('live');
      if (ds.rbg !== undefined) return startRun('bg');
      if (ds.rdone !== undefined) return closeModal();
      if (ds.rdetails !== undefined) { var rid = m.id; closeModal(); setTimeout(function () { openModal(rid); }, 320); return; }
      if (ds.fmt) { m.fmt = ds.fmt; S.fmtPref = ds.fmt; post({ a: 'ui', fmt: ds.fmt }).catch(function () {}); return renderModal(true); }
      return;
    }
    if (m.kind === 'cats') {
      if (!m.list) return;
      if (ds.cadd !== undefined) { m.list.push({ id: '', name: 'New category', count: 0 }); m.dirty = true; renderModal(); var ins = ov.querySelectorAll('[data-cname]'); var last = ins[ins.length - 1]; if (last) { last.focus(); last.select(); } return; }
      if (ds.cup) { var i = +ds.cup; m.list.splice(i - 1, 0, m.list.splice(i, 1)[0]); m.dirty = true; return renderModal(); }
      if (ds.cdown) { var j = +ds.cdown; m.list.splice(j + 1, 0, m.list.splice(j, 1)[0]); m.dirty = true; return renderModal(); }
      if (ds.cdel) { var c = m.list[+ds.cdel]; if (c.count && !confirm('Delete “' + c.name + '”? Its ' + c.count + ' script(s) move to “Other”.')) return; m.list.splice(+ds.cdel, 1); m.dirty = true; return renderModal(); }
      if (ds.csave !== undefined) return saveCats();
      return;
    }
    if (ds.mtab) { e.preventDefault(); m.tab = ds.mtab; renderModal(); if (m.tab === 'log') loadLog(); return; }
    if (ds.fmt) {                                  // remembered for every script, on the server
      m.fmt = ds.fmt; S.fmtPref = ds.fmt;
      post({ a: 'ui', fmt: ds.fmt }).catch(function () {});
      return renderModal(true);
    }
    if (ds.runi) { m.run = +ds.runi; m.follow = m.run === m.log.runs.length - 1; renderModal(true); return; }
    if (ds.download !== undefined) return download();
    if (ds.clearlog !== undefined) {
      if (!confirm('Delete this script’s current log? (Runs since the last reboot. Runs already saved to history are kept.)')) return;
      return post({ a: 'clearLog', id: m.id }).then(function () { m.run = null; loadLog(); refresh(); }).catch(function (er) { toast(er.message, true); });
    }
    if (ds.edit !== undefined) return startEdit(byId(m.id));
    if (ds.cancel !== undefined) { if (m.dirty && !confirm('Discard your changes?')) return; m.edit = false; m.dirty = false; return renderModal(); }
    if (ds.save !== undefined) return saveEdit();
    if (ds.etab) { var rich = $('#sd-rich', ov); if (rich) m.draft.title = rich.innerHTML; m.etab = ds.etab; renderModal(); if (m.etab === 'schedule') previewCron(); return; }
    if (ds.freq && m.draft) { m.draft.freq = ds.freq; m.dirty = true; return renderEditBody(); }
    if (ds.day !== undefined && m.draft) {
      var b = m.draft.builder, dd = +ds.day; b.days = b.days || [];
      var at = b.days.indexOf(dd); if (at >= 0) b.days.splice(at, 1); else b.days.push(dd);
      t.classList.toggle('on', at < 0); t.setAttribute('aria-pressed', String(at < 0));
      return builderChanged();
    }
    var d = m.draft;
    if (!d) return;
    if (ds.cmd) { e.preventDefault(); focusRich(); document.execCommand(ds.cmd, false, null); return changed(); }
    if (ds.color) { e.preventDefault(); applyColor(ds.color); return; }
    if (ds.emojis !== undefined) { var r = $('#sd-rich', ov); if (r) d.title = r.innerHTML; d.emojiOpen = !d.emojiOpen; return renderEditBody(); }
    if (ds.insert) { e.preventDefault(); focusRich(); document.execCommand('insertText', false, ds.insert); return changed(); }
    if (ds.src) { d.src = ds.src; return renderEditBody(); }
    if (ds.pick) { d.icon = ds.pick === 'auto' ? null : { t: ds.pick.split(':')[0], v: ds.pick.slice(ds.pick.indexOf(':') + 1) }; m.dirty = true; return renderEditBody(); }
    if (ds.ownemoji !== undefined) return useOwnEmoji();
    if (ds.tint !== undefined) { d.tint = ds.tint; m.dirty = true; return renderEditBody(); }
    if (ds.bg !== undefined) { d.bg = ds.bg; m.dirty = true; return renderEditBody(); }
  }
  var savedRange = null;
  function focusRich() {
    var r = $('#sd-rich', ov);
    if (!r) return;
    r.focus();
    if (savedRange) { var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(savedRange); }
  }
  function applyColor(c) { focusRich(); document.execCommand('styleWithCSS', false, true); document.execCommand('foreColor', false, c); changed(); }
  function changed() {
    var r = $('#sd-rich', ov);
    if (r && S.modal && S.modal.draft) { S.modal.draft.title = r.innerHTML; S.modal.dirty = true; updatePreview(); }
  }
  document.addEventListener('selectionchange', function () {
    var r = ov && $('#sd-rich', ov), sel = window.getSelection();
    if (r && sel.rangeCount && r.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  });
  /* Any emoji the user types or pastes (also a short symbol or two letters). */
  function useOwnEmoji() {
    var inp = $('#sd-emoji-in', ov), v = inp ? inp.value.trim() : '';
    if (!v) { toast('Type or paste an emoji first', true); return; }
    if (Array.from(v).length > 8) { toast('That is too long for an icon: use one emoji', true); return; }
    S.modal.draft.icon = { t: 'emoji', v: v };
    S.modal.dirty = true;
    renderEditBody();
  }
  function onKey(e) {
    if (e.target.id === 'sd-emoji-in' && e.key === 'Enter') { e.preventDefault(); useOwnEmoji(); return; }
    if (e.target.id === 'sd-arg' && e.key === 'Enter') { e.preventDefault(); startRun('live'); return; }
    if (e.target.id === 'sd-rich' && e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); changed(); }
  }
  function onInput(e) {
    var t = e.target, m = S.modal;
    if (t.id === 'sd-q') { S.q = t.value; renderPage(); return; }
    if (!m) return;
    if (t.id === 'sd-arg' && m.ask) { m.ask.value = t.value; return; }
    if (t.dataset && t.dataset.cname !== undefined) { m.list[+t.dataset.cname].name = t.value; m.dirty = true; return; }
    if (t.id === 'sd-find') { m.find = t.value; renderModal(true); return; }
    if (t.id === 'sd-rich') return changed();
    if (t.id === 'sd-desc') { m.draft.desc = t.value; m.dirty = true; return updatePreview(); }
    if (t.id === 'sd-code') { m.draft.script = t.value; m.dirty = true; return; }
    if (t.id === 'sd-cron') { m.draft.cron = t.value; m.draft.builder = parseCron(t.value).mode === m.draft.builder.mode ? parseCron(t.value) : m.draft.builder; m.dirty = true; return previewCron(); }
    if (t.id === 'sd-bn') { m.draft.builder.n = +t.value; return builderChanged(); }
    if (t.id === 'sd-bm') { m.draft.builder.m = +t.value; return builderChanged(); }
    if (t.id === 'sd-bdom') { m.draft.builder.dom = +t.value; return builderChanged(); }
    if (t.id === 'sd-btime') { m.draft.builder.t = t.value; return builderChanged(); }
    if (t.id === 'sd-tintpick') { m.draft.tint = t.value; m.dirty = true; return updatePreview(); }
    if (t.id === 'sd-bgpick') { m.draft.bg = t.value; m.dirty = true; return updatePreview(); }
  }
  function onChange(e) {
    var t = e.target, m = S.modal;
    if (t.id === 'sd-badges') {                     // counts on the category buttons: fade, keep the layout
      S.badges = t.checked;
      var nav = $('.sd-cats', app); if (nav) nav.classList.toggle('nobadges', !S.badges);
      post({ a: 'ui', badges: S.badges ? '1' : '0' }).catch(function () {});
      return;
    }
    if (t.id === 'sd-emoji-sys') {
      S.emoji = t.checked ? 'system' : '';
      save('emoji', S.emoji);
      applyEmojiStyle();
      post({ a: 'ui', emoji: S.emoji }).catch(function () {});
      return;
    }
    if (!m) return;
    if (t.id === 'sd-follow') { m.follow = t.checked; if (m.follow && m.log) m.run = m.log.runs.length - 1; renderModal(true); return; }
    if (t.id === 'sd-pinned') {
      m.draft.pinned = t.checked; m.dirty = true;
      var ps = $('#sd-pinshow', ov);
      if (ps) { ps.disabled = !t.checked; ps.parentNode.classList.toggle('off', !t.checked); }
      return updatePreview();
    }
    if (t.id === 'sd-pinshow') { m.draft.pinShow = t.checked; m.dirty = true; return; }
    if (t.id === 'sd-ask') { m.draft.askFirst = t.checked; m.dirty = true; return updatePreview(); }
    if (t.id === 'sd-cat') { m.draft.category = t.value; m.dirty = true; return; }
    if (t.id === 'sd-bmode') {
      var nb = { mode: t.value }, old = m.draft.builder;
      nb.t = old.t || '03:00'; nb.n = t.value === 'min' ? 5 : 1; nb.m = 0; nb.dom = 1; nb.days = [0];
      m.draft.builder = nb;
      if (t.value !== 'cron') m.draft.cron = buildCron(nb, m.draft.cron);
      m.dirty = true;
      return renderEditBody();
    }
    if (t.id === 'sd-anycolor') return applyColor(t.value);
    if (t.id === 'sd-tintpick' || t.id === 'sd-bgpick') return renderEditBody();
    if (t.id === 'sd-upload' && t.files[0]) uploadFile(t.files[0]);
  }
  /* Drag and drop: image files onto the icon area; category rows to reorder. */
  var dragCat = null;
  function onDragStart(e) {
    var row = e.target.closest && e.target.closest('.sd-catrow');
    if (!row) return;
    dragCat = +row.dataset.ci;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(dragCat)); } catch (er) {}
  }
  function onDragOver(e) {
    var zone = e.target.closest && e.target.closest('#sd-drop');
    if (zone && e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); zone.classList.add('over'); return; }
    var row = e.target.closest && e.target.closest('.sd-catrow');
    if (row && dragCat !== null) { e.preventDefault(); ov.querySelectorAll('.sd-catrow.over').forEach(function (x) { x.classList.remove('over'); }); row.classList.add('over'); }
  }
  function onDragLeave(e) {
    var zone = e.target.closest && e.target.closest('#sd-drop');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('over');
  }
  function onDrop(e) {
    var zone = e.target.closest && e.target.closest('#sd-drop');
    if (zone && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); zone.classList.remove('over'); uploadFile(e.dataTransfer.files[0]); return; }
    var row = e.target.closest && e.target.closest('.sd-catrow');
    if (row && dragCat !== null && S.modal && S.modal.kind === 'cats') {
      e.preventDefault();
      var to = +row.dataset.ci, l = S.modal.list;
      l.splice(to, 0, l.splice(dragCat, 1)[0]);
      S.modal.dirty = true; dragCat = null; renderModal();
    }
  }
  function onDragEnd() {
    dragCat = null;
    if (ov) ov.querySelectorAll('.sd-catrow').forEach(function (x) { x.classList.remove('dragging', 'over'); x.draggable = false; });
  }
  // Rows become draggable only from their grip, so the name field still works normally.
  document.addEventListener('mousedown', function (e) { var g = e.target.closest && e.target.closest('[data-grip]'); if (g) g.parentNode.draggable = true; });

  function download() {
    var m = S.modal, s = byId(m.id), r = m.log && (m.log.runs[m.run] || m.log.runs[m.log.runs.length - 1]);
    var blob = new Blob([r ? r.text : ''], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = s.id.replace(/[^\w.-]+/g, '_') + (r ? '-' + new Date(r.start * 1000).toISOString().slice(0, 16).replace(/[:T]/g, '') : '') + '.log';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  app.addEventListener('click', onClick);
  app.addEventListener('input', onInput);
  app.addEventListener('change', onChange);
  app.addEventListener('keydown', function (e) {
    var c = e.target.closest && e.target.closest('[data-open]');
    if (c && (e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); openModal(c.dataset.open); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.modal) { e.preventDefault(); if (S.modal.kind === 'run') closeRun(); else closeModal(); return; }
    var tag = (e.target.tagName || '').toLowerCase();
    if (e.key === '/' && !S.modal && tag !== 'input' && tag !== 'textarea' && !e.target.isContentEditable) { var q = $('#sd-q'); if (q) { e.preventDefault(); q.focus(); } }
  });

  /* ---------- polling ---------- */
  refresh();
  // While a script is starting or running in the open window, fetch its output every second.
  setInterval(function () {
    var m = S.modal;
    if (document.hidden || !m || (m.kind !== 'view' && m.kind !== 'run') || m.edit) return;
    var cur = byId(m.id);
    var starting = m.kind === 'run' ? runState(m, cur).phase === 'starting' : m.starting;
    if (starting || (cur && cur.running) || (m.log && m.log.running)) loadLog();
    if (m.kind === 'run') {                                   // tick the elapsed time
      var el = ov && ov.querySelector('.sd-rstat .el'), st = runState(m, cur);
      if (el && st.run && st.run.start) el.textContent = elapsed(st.run.start);
      if (!starting && m.startAt && st.phase === 'idle') { m.startAt = null; m.mode = null; renderModal(true); }  // gave up waiting
    }
  }, 1000);
  setInterval(function () {
    if (document.hidden) return;
    if (S.modal && (S.modal.edit || S.modal.kind === 'cats')) return;
    refresh();
  }, 3000);
})();
