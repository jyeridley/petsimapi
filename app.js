/* PS99 Toolkit — a static utility site for the public Pet Simulator 99 API.
 * Docs: https://github.com/BIG-Games-LLC/ps99-public-api-docs
 * No build step, no dependencies. */
(() => {
  'use strict';

  const API = 'https://ps99.biggamesapi.io';
  let view = document.getElementById('view');

  /* ======================================================================
   * Utilities
   * ==================================================================== */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const nf = new Intl.NumberFormat('en-US');

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  function fmt(n) { return n == null || Number.isNaN(+n) ? '—' : nf.format(Math.round(+n)); }
  function compact(n) {
    if (n == null || Number.isNaN(+n)) return '—';
    n = +n; const a = Math.abs(n);
    for (const [v, s] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
      if (a >= v) { const x = n / v; return parseFloat(x.toFixed(Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2)) + s; }
    }
    return nf.format(Math.round(n));
  }
  const num = (n) => `<span title="${esc(fmt(n))}">${compact(n)}</span>`;
  const toMs = (ts) => (ts == null ? NaN : typeof ts === 'number' ? (ts < 1e12 ? ts * 1000 : ts) : Date.parse(ts));
  function ago(ts) {
    const t = toMs(ts); if (!t) return '—';
    const d = (t - Date.now()) / 1000; const a = Math.abs(d);
    for (const [s, l] of [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']]) {
      if (a >= s) { const v = Math.floor(a / s); return d < 0 ? `${v}${l} ago` : `in ${v}${l}`; }
    }
    return 'just now';
  }
  function dateStr(ts, time = false) {
    const t = toMs(ts); if (!t) return '—';
    return new Date(t).toLocaleString(undefined, time ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
  }
  function duration(sec) {
    if (sec == null) return '—';
    sec = Math.max(0, Math.round(sec));
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
  }
  const pretty = (id) => String(id ?? '').replace(/_/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const initials = (s) => String(s || '?').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  function hue(seed) { let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
  function flag(cc) {
    if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return '';
    return String.fromCodePoint(...cc.toUpperCase().split('').map((c) => 127397 + c.charCodeAt(0)));
  }
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1800);
  }

  /* ======================================================================
   * API client — in-memory cache, de-duplication and a client-side rate cap
   * ==================================================================== */
  class ApiError extends Error { constructor(msg, status, code) { super(msg); this.status = status; this.code = code; } }
  const CODE_MESSAGES = {
    player_not_found: 'Player not found — they may not have linked their account or have no public views.',
    internal_error: 'The PS99 API had an internal error. Try again shortly.',
    invalid_query: 'Invalid request.',
  };
  const memCache = new Map();
  const inflight = new Map();
  const stamps = [];
  async function throttle() {
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0] > 60000) stamps.shift();
      if (stamps.length < 90) { stamps.push(now); return; }
      await new Promise((r) => setTimeout(r, 60000 - (now - stamps[0]) + 50));
    }
  }
  async function api(path, ttl = 60000) {
    const hit = memCache.get(path);
    if (hit && Date.now() - hit.t < ttl) return hit.d;
    if (inflight.has(path)) return inflight.get(path);
    const p = (async () => {
      await throttle();
      let res;
      try { res = await fetch(API + path, { headers: { Accept: 'application/json' } }); } catch {
        throw new ApiError('Could not reach the PS99 API. Check your connection and try again.', 0);
      }
      if (res.status === 429) {
        const ra = parseInt(res.headers.get('Retry-After'), 10) || 10;
        throw new ApiError(`Rate limited by the API — try again in ${ra}s.`, 429);
      }
      let body;
      try { body = await res.json(); } catch { throw new ApiError(`Unexpected response from the API (HTTP ${res.status}).`, res.status); }
      if (!body || body.status !== 'ok') {
        const e = (body && body.error) || {};
        throw new ApiError(e.message || CODE_MESSAGES[e.code] || `Request failed (HTTP ${res.status}).`, res.status, e.code);
      }
      memCache.set(path, { t: Date.now(), d: body.data });
      return body.data;
    })();
    inflight.set(path, p);
    try { return await p; } finally { inflight.delete(path); }
  }

  /* ======================================================================
   * Images & items
   * ==================================================================== */
  function imgUrl(icon) {
    if (!icon) return null;
    const s = String(icon);
    if (/^https?:\/\//.test(s)) return s;
    const m = s.match(/(\d{4,})/);
    return m ? `${API}/image/${m[1]}` : null;
  }
  const IMG_ERR = "this.parentNode.classList.add('noimg');this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:this.dataset.ph||'?'}))";
  function thumb(icon, { size = '', variant = '', label = '', ikey = '' } = {}) {
    const u = imgUrl(icon);
    const ph = esc(initials(label));
    const cls = `thumb ${size} ${variant ? 'v-' + variant : ''}`;
    const attr = ikey ? ` data-ikey="${esc(ikey)}"` : '';
    return `<span class="${cls}"${attr}>${u ? `<img loading="lazy" src="${esc(u)}" alt="" data-ph="${ph}" onerror="${IMG_ERR}">` : `<span class="ph">${ph}</span>`}</span>`;
  }
  function setThumb(el, icon) {
    const u = imgUrl(icon); if (!u) return;
    const ph = el.querySelector('.ph')?.textContent || '?';
    el.innerHTML = `<img loading="lazy" src="${esc(u)}" alt="" data-ph="${esc(ph)}" onerror="${IMG_ERR}">`;
  }
  const variantOf = (pt, sh) => (pt === 2 ? 'rainbow' : pt === 1 ? 'golden' : sh ? 'shiny' : '');
  const variantName = (pt, sh) => [sh ? 'Shiny' : '', pt === 1 ? 'Golden' : pt === 2 ? 'Rainbow' : ''].filter(Boolean).join(' ');
  function variantChips(pt, sh) {
    let h = '';
    if (sh) h += '<span class="chip shiny">Shiny</span>';
    if (pt === 1) h += '<span class="chip golden">Golden</span>';
    if (pt === 2) h += '<span class="chip rainbow">Rainbow</span>';
    return h;
  }
  function variantFromString(v) {
    v = String(v || '').toLowerCase();
    return { sh: v.includes('shiny'), pt: v.includes('rainbow') ? 2 : v.includes('gold') ? 1 : 0 };
  }

  /* ---- Price database (RAP + exists merged) ---- */
  const CAT_COLL = {
    Pet: 'Pets', Egg: 'Eggs', Charm: 'Charms', Enchant: 'Enchants', Potion: 'Potions', Hoverboard: 'Hoverboards',
    Booth: 'Booths', Lootbox: 'Lootboxes', Fruit: 'Fruits', Misc: 'MiscItems', XPPotion: 'XPPotions', Ultimate: 'Ultimates',
    Box: 'Boxes', Seed: 'Seeds', Card: 'CardItems', Shovel: 'Shovels', FishingRod: 'FishingRods', WateringCan: 'WateringCans',
    Sprinkler: 'Sprinklers', Boost: 'Boosts', Buff: 'Buffs',
  };
  let priceDB = null;
  let pricePromise = null;
  const priceKey = (cat, d) => [cat, d.id, d.pt || 0, d.sh ? 1 : 0, d.tn || 0].join('|');
  function itemName(o) { const v = variantName(o.pt, o.sh); return `${v ? v + ' ' : ''}${o.id}${o.tn ? ` (Tier ${o.tn})` : ''}`; }
  function loadPrices() {
    if (priceDB) return Promise.resolve(priceDB);
    if (pricePromise) return pricePromise;
    pricePromise = (async () => {
      const [rap, exists] = await Promise.all([api('/api/rap', 4 * 3600e3), api('/api/exists', 10 * 60e3).catch(() => [])]);
      const map = new Map();
      for (const r of rap || []) {
        const d = r.configData || {}; if (d.id == null) continue;
        const k = priceKey(r.category, d);
        map.set(k, { key: k, category: r.category, id: String(d.id), pt: d.pt || 0, sh: !!d.sh, tn: d.tn || 0, rap: r.value, exists: null });
      }
      for (const r of exists || []) {
        const d = r.configData || {}; if (d.id == null) continue;
        const k = priceKey(r.category, d);
        const o = map.get(k);
        if (o) o.exists = r.value;
        else map.set(k, { key: k, category: r.category, id: String(d.id), pt: d.pt || 0, sh: !!d.sh, tn: d.tn || 0, rap: null, exists: r.value });
      }
      const items = [...map.values()];
      for (const o of items) { o.name = itemName(o); o.lname = o.name.toLowerCase() + ' ' + o.category.toLowerCase(); }
      priceDB = { items, byKey: map, loadedAt: Date.now() };
      return priceDB;
    })();
    pricePromise.catch(() => { pricePromise = null; });
    return pricePromise;
  }

  /* ---- Collection icon lookup (lazy, only for categories on screen) ---- */
  const collections = {};
  const iconCache = new Map();
  function loadCollection(name) {
    if (!collections[name]) {
      collections[name] = api(`/api/collection/${enc(name)}`, 30 * 60e3).then((rows) => {
        const m = new Map();
        for (const r of rows || []) {
          m.set(String(r.configName).toLowerCase(), r);
          const nm = r.configData && (r.configData.name || r.configData.DisplayName);
          if (nm && !m.has(String(nm).toLowerCase())) m.set(String(nm).toLowerCase(), r);
        }
        return m;
      }).catch(() => { delete collections[name]; return new Map(); });
    }
    return collections[name];
  }
  function iconFromConfig(row, pt, tn) {
    const c = (row && row.configData) || {};
    if (pt === 1 && c.goldenThumbnail) return c.goldenThumbnail;
    if (Array.isArray(c.Tiers) && c.Tiers.length) {
      const t = c.Tiers[(tn || 1) - 1] || c.Tiers[0];
      if (t && (t.Icon || t.icon || t.thumbnail)) return t.Icon || t.icon || t.thumbnail;
    }
    return c.thumbnail || c.Icon || c.icon || c.Thumbnail || null;
  }
  function hydrateIcons(root) {
    if (!priceDB) return;
    const groups = {};
    for (const el of $$('[data-ikey]', root)) {
      const key = el.dataset.ikey;
      if (iconCache.has(key)) { const ic = iconCache.get(key); if (ic) setThumb(el, ic); el.removeAttribute('data-ikey'); continue; }
      const o = priceDB.byKey.get(key); if (!o) continue;
      const coll = CAT_COLL[o.category]; if (!coll) continue;
      (groups[coll] ||= []).push([el, o]);
    }
    for (const [coll, list] of Object.entries(groups)) {
      loadCollection(coll).then((m) => {
        for (const [el, o] of list) {
          const id = o.id.toLowerCase();
          const row = m.get(id) || m.get(`${o.category} | ${o.id}`.toLowerCase()) || m.get(`${coll.replace(/s$/, '')} | ${o.id}`.toLowerCase());
          const ic = row ? iconFromConfig(row, o.pt, o.tn) : null;
          iconCache.set(o.key, ic);
          if (ic && el.isConnected) setThumb(el, ic);
        }
      });
    }
  }

  /* ======================================================================
   * Shared UI fragments
   * ==================================================================== */
  const loadingHTML = (msg = 'Loading…') => `<div class="loading"><span class="spinner"></span>${esc(msg)}</div>`;
  const errorHTML = (e) => `<div class="error-box"><b>Something went wrong.</b> ${esc(e && e.message ? e.message : e)}</div>`;
  const searchIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  const tile = (label, value, sub = '') => `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  function stateChip(state) {
    const s = String(state || '').toLowerCase();
    if (s === 'live') return '<span class="chip good"><span class="dot live-dot"></span>Live</span>';
    if (s === 'upcoming') return '<span class="chip accent">Upcoming</span>';
    if (s === 'ended') return '<span class="chip warn">Ended</span>';
    if (s === 'final') return '<span class="chip accent">Final</span>';
    return `<span class="chip">${esc(pretty(state) || 'Inactive')}</span>`;
  }
  function rankCell(r) { return `<td class="rank ${r <= 3 ? 'r' + r : ''}">${r == null ? '—' : '#' + fmt(r)}</td>`; }
  function playerLink(uid, name) {
    if (!uid) return esc(name || 'Unknown');
    return `<a href="#/player/${enc(uid)}">${esc(name || uid)}</a> <a class="tiny muted" href="https://www.roblox.com/users/${enc(uid)}/profile" target="_blank" rel="noopener" title="Roblox profile">↗</a>`;
  }
  function pager(page, totalPages, total, label = 'results') {
    return `<div class="pager"><span class="small muted">${total != null ? `${fmt(total)} ${label} · ` : ''}Page ${fmt(page)}${totalPages ? ` of ${fmt(totalPages)}` : ''}</span>
      <div class="row"><button class="btn sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← Prev</button>
      <button class="btn sm" data-page="${page + 1}" ${totalPages && page >= totalPages ? 'disabled' : ''}>Next →</button></div></div>`;
  }
  function rewardItem(it) {
    if (!it) return '';
    const v = variantFromString(it.variant);
    return `<div class="item-row">${thumb(it.icon, { size: 'sm', variant: variantOf(v.pt, v.sh), label: it.id })}
      <div style="min-width:0"><div class="item-name">${it.amount > 1 ? fmt(it.amount) + '× ' : ''}${esc(it.id)}</div>
      <div class="item-meta">${variantChips(v.pt, v.sh)}${it.collection ? `<span class="chip">${esc(it.collection)}</span>` : ''}</div></div></div>`;
  }
  function countdown(start, finish) {
    const now = Date.now() / 1000;
    if (start && now < start) return `Starts ${ago(start)}`;
    if (finish && now < finish) return `Ends ${ago(finish)}`;
    if (finish) return `Ended ${ago(finish)}`;
    return '';
  }

  /* ======================================================================
   * Trade calculator state
   * ==================================================================== */
  const TRADE_KEY = 'ps99.trade.v1';
  const getTrade = () => {
    const t = store.get(TRADE_KEY, null);
    return t && Array.isArray(t.give) && Array.isArray(t.get) ? t : { give: [], get: [], giveGems: 0, getGems: 0 };
  };
  const saveTrade = (t) => store.set(TRADE_KEY, t);
  function tradeAdd(side, key) {
    const t = getTrade();
    const ex = t[side].find((e) => e.key === key);
    if (ex) ex.qty += 1; else t[side].push({ key, qty: 1 });
    saveTrade(t);
    const o = priceDB && priceDB.byKey.get(key);
    toast(`Added ${o ? o.name : 'item'} to ${side === 'give' ? 'your offer' : 'their offer'}`);
  }

  /* ======================================================================
   * Item autocomplete
   * ==================================================================== */
  function attachItemAC(input, list, onPick) {
    let opts = []; let hl = -1;
    const close = () => { list.classList.remove('open'); hl = -1; };
    const paint = () => $$('.ac-opt', list).forEach((el, i) => el.classList.toggle('hl', i === hl));
    const update = () => {
      const q = input.value.trim().toLowerCase();
      if (!q || !priceDB) { close(); return; }
      const toks = q.split(/\s+/);
      opts = priceDB.items.filter((i) => toks.every((t) => i.lname.includes(t)))
        .sort((a, b) => (b.rap || 0) - (a.rap || 0)).slice(0, 12);
      list.innerHTML = opts.length
        ? opts.map((o, i) => `<div class="ac-opt" data-i="${i}">${thumb(null, { size: 'sm', variant: variantOf(o.pt, o.sh), label: o.id, ikey: o.key })}<span class="ellipsis">${esc(o.name)}</span><span class="r">${compact(o.rap)} 💎</span></div>`).join('')
        : '<div class="ac-opt muted">No matching items</div>';
      list.classList.add('open'); hl = opts.length ? 0 : -1; paint();
      hydrateIcons(list);
    };
    const pick = (i) => { const o = opts[i]; if (!o) return; onPick(o); input.value = ''; close(); input.focus(); };
    input.addEventListener('input', update);
    input.addEventListener('focus', () => { if (input.value) update(); });
    input.addEventListener('keydown', (e) => {
      if (!list.classList.contains('open')) return;
      if (e.key === 'ArrowDown') { hl = Math.min(opts.length - 1, hl + 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { hl = Math.max(0, hl - 1); paint(); e.preventDefault(); }
      else if (e.key === 'Enter') { pick(hl); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    });
    list.addEventListener('mousedown', (e) => { const el = e.target.closest('.ac-opt[data-i]'); if (el) { e.preventDefault(); pick(+el.dataset.i); } });
    input.addEventListener('blur', () => setTimeout(close, 120));
  }

  /* ======================================================================
   * VIEW: Prices
   * ==================================================================== */
  async function viewPrices(r, alive) {
    view.innerHTML = loadingHTML('Loading RAP and exist counts…');
    const db = await loadPrices(); if (!alive()) return;
    const cats = [...new Set(db.items.map((i) => i.category))].sort();
    const saved = store.get('ps99.prices', {});
    const st = { q: '', cat: cats.includes('Pet') ? 'Pet' : 'all', variant: 'all', sort: 'rap-desc', ...saved, limit: 60 };
    if (r.query.q) { st.q = r.query.q; st.cat = 'all'; }
    if (st.cat !== 'all' && !cats.includes(st.cat)) st.cat = 'all';

    const withRap = db.items.filter((i) => i.rap != null);
    const top = withRap.reduce((a, b) => (b.rap > (a ? a.rap : -1) ? b : a), null);
    const rarest = db.items.filter((i) => i.exists > 0 && i.rap != null).reduce((a, b) => (!a || b.exists < a.exists ? b : a), null);

    view.innerHTML = `
      <div class="page-head"><div><h1>Prices</h1><p>Recent average price (RAP, in diamonds) and exist counts across every tradeable item.</p></div>
        <span class="chip">Updated ${esc(ago(db.loadedAt))}</span></div>
      <div class="grid grid-tiles" style="margin-bottom:16px">
        ${tile('Items tracked', fmt(db.items.length), `${fmt(withRap.length)} with RAP`)}
        ${tile('Categories', fmt(cats.length))}
        ${top ? tile('Highest RAP', `${compact(top.rap)} 💎`, esc(top.name)) : ''}
        ${rarest ? tile('Rarest valued item', `${fmt(rarest.exists)} exist`, esc(rarest.name)) : ''}
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="row">
          <div class="search-wrap">${searchIcon}<input id="pq" class="input" placeholder="Search items, e.g. huge cat, rainbow, titanic…" value="${esc(st.q)}" autocomplete="off"></div>
          <select id="pcat" class="select"><option value="all">All categories</option>${cats.map((c) => `<option value="${esc(c)}" ${c === st.cat ? 'selected' : ''}>${esc(pretty(c))}</option>`).join('')}</select>
          <div class="seg" id="pvar">${['all', 'normal', 'golden', 'rainbow', 'shiny'].map((v) => `<button data-v="${v}" class="${st.variant === v ? 'on' : ''}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
          <select id="psort" class="select">
            ${[['rap-desc', 'RAP: high → low'], ['rap-asc', 'RAP: low → high'], ['exists-asc', 'Rarest first'], ['exists-desc', 'Most common first'], ['name', 'Name A → Z']].map(([v, l]) => `<option value="${v}" ${st.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="small muted" id="pcount" style="margin-top:10px"></div>
      </div>
      <div id="plist" class="price-list"></div>
      <div id="pmore" style="text-align:center;margin-top:16px"></div>`;

    const list = $('#plist'); const more = $('#pmore'); const count = $('#pcount');
    let filtered = [];
    const cmpNullLast = (a, b, f, dir) => (a[f] == null) - (b[f] == null) || dir * ((a[f] || 0) - (b[f] || 0));
    function apply(reset = true) {
      if (reset) st.limit = 60;
      store.set('ps99.prices', { q: st.q, cat: st.cat, variant: st.variant, sort: st.sort });
      const toks = st.q.toLowerCase().split(/\s+/).filter(Boolean);
      filtered = db.items.filter((i) => {
        if (st.cat !== 'all' && i.category !== st.cat) return false;
        if (st.variant === 'normal' && (i.pt || i.sh)) return false;
        if (st.variant === 'golden' && i.pt !== 1) return false;
        if (st.variant === 'rainbow' && i.pt !== 2) return false;
        if (st.variant === 'shiny' && !i.sh) return false;
        return toks.every((t) => i.lname.includes(t));
      });
      const s = st.sort;
      filtered.sort((a, b) => s === 'name' ? a.name.localeCompare(b.name)
        : s === 'rap-asc' ? cmpNullLast(a, b, 'rap', 1) : s === 'exists-asc' ? cmpNullLast(a, b, 'exists', 1)
          : s === 'exists-desc' ? cmpNullLast(a, b, 'exists', -1) : cmpNullLast(a, b, 'rap', -1));
      count.textContent = `${fmt(filtered.length)} item${filtered.length === 1 ? '' : 's'}`;
      const shown = filtered.slice(0, st.limit);
      list.innerHTML = shown.length ? shown.map((o) => `
        <div class="price-card">
          ${thumb(null, { variant: variantOf(o.pt, o.sh), label: o.id, ikey: o.key })}
          <div class="info">
            <div class="item-name" title="${esc(o.name)}">${esc(o.name)}</div>
            <div class="item-meta"><span class="chip">${esc(pretty(o.category))}</span>${variantChips(o.pt, o.sh)}</div>
            <div class="nums"><span><span class="muted">RAP</span> <b>${num(o.rap)}</b></span><span><span class="muted">Exists</span> <b>${num(o.exists)}</b></span></div>
          </div>
          <div class="actions">
            <button class="btn sm" data-add="give" data-key="${esc(o.key)}" title="Add to the side you give">+ Give</button>
            <button class="btn sm" data-add="get" data-key="${esc(o.key)}" title="Add to the side you receive">+ Get</button>
          </div>
        </div>`).join('') : '<div class="empty card" style="grid-column:1/-1">No items match those filters.</div>';
      more.innerHTML = filtered.length > st.limit ? `<button class="btn" id="pmorebtn">Show more (${fmt(filtered.length - st.limit)} left)</button>` : '';
      hydrateIcons(list);
    }
    $('#pq').addEventListener('input', debounce((e) => { st.q = e.target.value; apply(); }, 150));
    $('#pcat').addEventListener('change', (e) => { st.cat = e.target.value; apply(); });
    $('#psort').addEventListener('change', (e) => { st.sort = e.target.value; apply(); });
    $('#pvar').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      st.variant = b.dataset.v; $$('#pvar button').forEach((x) => x.classList.toggle('on', x === b)); apply();
    });
    more.addEventListener('click', (e) => { if (e.target.id === 'pmorebtn') { st.limit += 90; apply(false); } });
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (b) tradeAdd(b.dataset.add, b.dataset.key); });
    apply();
  }

  /* ======================================================================
   * VIEW: Trade calculator
   * ==================================================================== */
  async function viewTrade(r, alive) {
    view.innerHTML = loadingHTML('Loading item values…');
    const db = await loadPrices(); if (!alive()) return;
    const side = (k, title) => `
      <div class="card">
        <div class="card-head"><h2>${title}</h2><button class="btn sm" data-clear="${k}">Clear</button></div>
        <div class="ac"><div class="search-wrap">${searchIcon}<input class="input" id="ac-${k}" placeholder="Add an item…" autocomplete="off"></div><div class="ac-list" id="acl-${k}"></div></div>
        <div class="trade-items" id="items-${k}"></div>
        <div class="row" style="margin-top:12px"><label class="small muted" for="gems-${k}">💎 Diamonds</label><input class="input grow" id="gems-${k}" inputmode="numeric" placeholder="0"></div>
        <div class="row" style="justify-content:space-between;margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
          <span class="muted small">Total value</span><span class="side-total" id="total-${k}">0</span></div>
      </div>`;
    view.innerHTML = `
      <div class="page-head"><div><h1>Trade Calculator</h1><p>Compare both sides of a trade by RAP. Add items here or with the <b>+ Give / + Get</b> buttons on the Prices page.</p></div>
        <div class="row"><button class="btn" id="tswap">⇄ Swap sides</button><button class="btn" id="tcopy">Copy summary</button></div></div>
      <div class="trade-grid">
        ${side('give', 'You give')}
        <div class="trade-mid card"><span class="small muted">Verdict</span><div class="verdict" id="verdict">—</div><div class="small muted right" id="vdiff" style="text-align:center"></div></div>
        ${side('get', 'You get')}
      </div>
      <p class="small muted" style="margin-top:16px">RAP is a recent average of in-game trades and booth sales — real trade value can differ, especially for items with few sales. Items without RAP count as 0.</p>`;

    const parseGems = (s) => { const m = String(s || '').trim().toLowerCase().replace(/,/g, '').match(/^(\d*\.?\d+)\s*([kmbt]?)$/); if (!m) return 0; return Math.round(parseFloat(m[1]) * ({ '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2]])); };
    function totals(t) {
      const sum = (k) => t[k].reduce((a, e) => a + ((db.byKey.get(e.key)?.rap) || 0) * e.qty, 0) + (t[k + 'Gems'] || 0);
      return { give: sum('give'), get: sum('get') };
    }
    function render() {
      const t = getTrade();
      for (const k of ['give', 'get']) {
        const box = $('#items-' + k);
        box.innerHTML = t[k].length ? t[k].map((e, i) => {
          const o = db.byKey.get(e.key);
          const name = o ? o.name : e.key.split('|')[1];
          return `<div class="trade-item">${thumb(null, { size: 'sm', variant: o ? variantOf(o.pt, o.sh) : '', label: name, ikey: e.key })}
            <div class="grow"><div class="item-name small">${esc(name)}</div><div class="tiny muted">${o && o.rap != null ? `${compact(o.rap)} each` : 'No RAP'}</div></div>
            <input class="input qty" type="number" min="1" value="${e.qty}" data-qty="${k}:${i}" aria-label="Quantity">
            <button class="btn sm icon" data-rm="${k}:${i}" aria-label="Remove">✕</button></div>`;
        }).join('') : '<div class="empty-drop">No items yet</div>';
        const g = $('#gems-' + k); if (document.activeElement !== g) g.value = t[k + 'Gems'] ? compact(t[k + 'Gems']) : '';
        hydrateIcons(box);
      }
      const tot = totals(t);
      $('#total-give').innerHTML = num(tot.give); $('#total-get').innerHTML = num(tot.get);
      const v = $('#verdict'); const d = $('#vdiff');
      if (!tot.give && !tot.get) { v.textContent = '—'; v.className = 'verdict'; d.textContent = 'Add items to compare'; return; }
      const diff = tot.get - tot.give;
      const pct = tot.give ? diff / tot.give : 1;
      const cls = Math.abs(pct) < 0.05 ? 'fair' : diff > 0 ? 'win' : 'loss';
      v.textContent = cls === 'fair' ? 'Fair' : cls === 'win' ? 'W' : 'L';
      v.className = 'verdict ' + cls;
      d.innerHTML = `${diff >= 0 ? '+' : '−'}${compact(Math.abs(diff))} 💎${tot.give ? `<br>${diff >= 0 ? '+' : '−'}${(Math.abs(pct) * 100).toFixed(1)}%` : ''}`;
    }
    for (const k of ['give', 'get']) {
      attachItemAC($('#ac-' + k), $('#acl-' + k), (o) => { const t = getTrade(); const ex = t[k].find((e) => e.key === o.key); if (ex) ex.qty++; else t[k].push({ key: o.key, qty: 1 }); saveTrade(t); render(); });
      $('#gems-' + k).addEventListener('input', debounce((e) => { const t = getTrade(); t[k + 'Gems'] = parseGems(e.target.value); saveTrade(t); render(); }, 250));
    }
    view.addEventListener('change', (e) => {
      const q = e.target.dataset.qty; if (!q) return;
      const [k, i] = q.split(':'); const t = getTrade();
      t[k][+i].qty = Math.max(1, parseInt(e.target.value, 10) || 1); saveTrade(t); render();
    });
    view.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]'); const cl = e.target.closest('[data-clear]');
      if (rm) { const [k, i] = rm.dataset.rm.split(':'); const t = getTrade(); t[k].splice(+i, 1); saveTrade(t); render(); }
      if (cl) { const k = cl.dataset.clear; const t = getTrade(); t[k] = []; t[k + 'Gems'] = 0; saveTrade(t); render(); }
    });
    $('#tswap').addEventListener('click', () => { const t = getTrade(); saveTrade({ give: t.get, get: t.give, giveGems: t.getGems, getGems: t.giveGems }); render(); });
    $('#tcopy').addEventListener('click', async () => {
      const t = getTrade(); const tot = totals(t);
      const lines = (k) => t[k].map((e) => `  ${e.qty}× ${db.byKey.get(e.key)?.name || e.key}`).concat(t[k + 'Gems'] ? [`  ${compact(t[k + 'Gems'])} diamonds`] : []).join('\n') || '  (nothing)';
      const text = `PS99 trade check\nI give (${compact(tot.give)}):\n${lines('give')}\nI get (${compact(tot.get)}):\n${lines('get')}\nResult: ${$('#verdict').textContent}`;
      try { await navigator.clipboard.writeText(text); toast('Summary copied'); } catch { toast('Could not access the clipboard'); }
    });
    render();
  }

  /* ======================================================================
   * VIEW: Players
   * ==================================================================== */
  function playerCard(p) {
    const name = p.displayName || p.username;
    return `<a class="card player-card" href="#/player/${enc(p.username || p.robloxUserId)}">
      <span class="mini-avatar" style="background:hsl(${hue(p.robloxUserId)} 70% 55%)">${esc(initials(name))}</span>
      <span style="min-width:0"><div class="item-name">${esc(name)}</div><div class="tiny muted ellipsis">@${esc(p.username)}</div></span></a>`;
  }
  async function viewPlayers(r, alive) {
    view.innerHTML = `
      <div class="hero" style="margin-bottom:18px">
        <h1>Player lookup</h1><p>Search any player who has made their PS99 profile public — stats, inventory value, trades and more.</p>
        <div class="ac" style="margin-top:16px;max-width:560px">
          <div class="search-wrap">${searchIcon}<input id="psearch" class="input lg" placeholder="Username, display name or Roblox ID" autocomplete="off" style="padding-left:38px;color:var(--text)"></div>
        </div>
        <div class="row" style="margin-top:12px" id="ptotal"></div>
      </div>
      <div id="presults"></div>
      <div class="card-head" style="margin-top:8px"><h2>Recently active public players</h2></div>
      <div id="featured" class="grid grid-cards">${loadingHTML()}</div>`;
    const input = $('#psearch'); const out = $('#presults');
    api('/v1/players/total', 300000).then((n) => { if (alive()) $('#ptotal').innerHTML = `<span class="chip">${fmt(n)} public profiles</span>`; }).catch(() => {});
    api('/v1/players/featured?limit=24', 60000).then((d) => {
      if (!alive()) return;
      const list = (d && d.results) || [];
      $('#featured').innerHTML = list.length ? list.map(playerCard).join('') : '<div class="empty">No featured players right now.</div>';
    }).catch((e) => { if (alive()) $('#featured').innerHTML = errorHTML(e); });
    const doSearch = debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) { out.innerHTML = ''; return; }
      out.innerHTML = loadingHTML('Searching…');
      try {
        const d = await api(`/v1/players/search?q=${enc(q)}&limit=24`, 30000);
        if (!alive() || input.value.trim() !== q) return;
        const list = (d && d.results) || [];
        out.innerHTML = `<div class="card-head"><h2>Results</h2><span class="small muted">Press Enter to open “${esc(q)}” directly</span></div>
          <div class="grid grid-cards" style="margin-bottom:18px">${list.length ? list.map(playerCard).join('') : '<div class="empty">No public players match. Try their exact username or Roblox ID and press Enter.</div>'}</div>`;
      } catch (e) { if (alive()) out.innerHTML = errorHTML(e); }
    }, 300);
    input.addEventListener('input', doSearch);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) location.hash = `#/player/${enc(input.value.trim())}`; });
    input.focus();
  }

  const VIEW_KEYS = [['profile', 'Profile'], ['inventory', 'Inventory'], ['extendedProfile', 'Purchases'], ['itemIndex', 'Item index'], ['trades', 'Trades'], ['booth', 'Booth'], ['mail', 'Mail']];

  function enrichedName(it) {
    const raw = it.rawData || {};
    const v = it.variant ? variantFromString(it.variant) : { pt: raw.pt || 0, sh: !!raw.sh };
    const base = it.displayName || it.id || raw.id || 'Unknown item';
    const vn = variantName(v.pt, v.sh);
    return { name: vn && !base.startsWith(vn) ? `${vn} ${base}` : base, ...v, icon: v.pt === 1 && it.goldenIcon ? it.goldenIcon : it.icon };
  }
  function miniItems(items) {
    if (!items || !items.length) return '<span class="tiny muted">Nothing</span>';
    return `<div class="mini-items">${items.map((it) => {
      const n = enrichedName(it); const c = it.count || (it.rawData && it.rawData._am) || 1;
      return `<span class="mini-item" title="${esc(n.name)}${it.rap ? ' · RAP ' + fmt(it.rap) : ''}">${thumb(n.icon, { variant: variantOf(n.pt, n.sh), label: n.name })}<span class="ellipsis">${c > 1 ? fmt(c) + '× ' : ''}${esc(n.name)}</span></span>`;
    }).join('')}</div>`;
  }
  const itemsValue = (items) => (items || []).reduce((a, it) => a + (it.rap || 0) * (it.count || (it.rawData && it.rawData._am) || 1), 0);

  async function viewPlayer(r, alive) {
    const slug = r.params[0];
    view.innerHTML = loadingHTML(`Loading ${slug}…`);
    const d = await api(`/v1/players/${enc(slug)}?include=*`, 120000); if (!alive()) return;
    const acc = d.account || {}; const views = d.views || {};
    const name = acc.displayName || acc.username;
    const avail = (k) => views[k] && views[k].available;
    const tabs = VIEW_KEYS.filter(([k]) => avail(k) && k !== 'extendedProfile');
    const fetched = Object.values(views).map((v) => v && v.fetchedAt).filter(Boolean).sort().pop();

    view.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="profile-head">
          <div class="avatar" style="background:linear-gradient(135deg,hsl(${hue(acc.robloxUserId)} 75% 55%),hsl(${(hue(acc.robloxUserId) + 60) % 360} 75% 60%))">${esc(initials(name))}</div>
          <div class="grow">
            <h1>${esc(name)}</h1>
            <div class="muted">@${esc(acc.username)} · <span class="mono">${esc(acc.robloxUserId)}</span></div>
            <div class="row" style="margin-top:8px;gap:6px">${VIEW_KEYS.map(([k, l]) => `<span class="chip ${acc.publicViews && acc.publicViews[k] ? 'accent' : ''}" title="${acc.publicViews && acc.publicViews[k] ? 'Public' : 'Private'}">${acc.publicViews && acc.publicViews[k] ? '' : '🔒 '}${l}</span>`).join('')}</div>
          </div>
          <div class="stack" style="gap:8px;align-items:flex-end">
            <a class="btn" href="https://www.roblox.com/users/${enc(acc.robloxUserId)}/profile" target="_blank" rel="noopener">Roblox profile ↗</a>
            ${fetched ? `<span class="tiny muted">Snapshot ${esc(ago(fetched))}</span>` : ''}
          </div>
        </div>
      </div>
      ${tabs.length ? `<div class="tabs" id="ptabs">${tabs.map(([k, l], i) => `<button data-tab="${k}" class="${i === 0 ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
      <div id="ptab"></div>`;

    const unavailable = VIEW_KEYS.filter(([k]) => views[k] && !views[k].available && views[k].reason === 'no_recent_data');
    const body = $('#ptab');
    const renderTab = (k) => {
      const v = views[k]; const data = v && v.data;
      const stale = v && v.isStale ? '<div class="chip warn" style="margin-bottom:12px">This snapshot is over 7 days old</div>' : '';
      if (k === 'profile') body.innerHTML = stale + renderProfile(data, avail('extendedProfile') ? views.extendedProfile.data : null);
      else if (k === 'inventory') { renderInventory(body, data, stale); return; }
      else if (k === 'itemIndex') body.innerHTML = stale + renderIndex(data);
      else body.innerHTML = stale + renderFeed(k, data);
      hydrateIcons(body);
    };
    if (tabs.length) {
      renderTab(tabs[0][0]);
      $('#ptabs').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        $$('#ptabs button').forEach((x) => x.classList.toggle('on', x === b)); renderTab(b.dataset.tab);
      });
    } else if (avail('extendedProfile')) {
      body.innerHTML = renderProfile(null, views.extendedProfile.data);
    } else {
      body.innerHTML = `<div class="card empty">${unavailable.length ? 'This player opted in, but no save snapshot exists yet. Reload in a minute — viewing the profile triggers a refresh.' : 'This player has no public views with data.'}</div>`;
    }
  }

  function renderProfile(p, ext) {
    let h = '';
    if (p) {
      const st = p.Statistics || {};
      const gems = p.Currency && p.Currency.Diamonds ? p.Currency.Diamonds._am : null;
      const zones = p.UnlockedZones ? Object.keys(p.UnlockedZones).length : null;
      h += `<div class="grid grid-tiles" style="margin-bottom:16px">
        ${p.Rank != null ? tile('Rank', fmt(p.Rank), p.RankStars != null ? `${fmt(p.RankStars)} stars` : '') : ''}
        ${p.Rebirths != null ? tile('Rebirths', fmt(p.Rebirths)) : ''}
        ${gems != null ? tile('Diamonds', `${num(gems)} 💎`) : ''}
        ${p.EggsHatched != null || st['Eggs Opened'] != null ? tile('Eggs hatched', num(p.EggsHatched ?? st['Eggs Opened'])) : ''}
        ${st['Huge Pets Opened'] != null ? tile('Huges hatched', fmt(st['Huge Pets Opened'])) : ''}
        ${st.Playtime != null ? tile('Playtime', `${fmt(st.Playtime / 3600)}h`) : ''}
        ${p.TotalSessions != null ? tile('Sessions', fmt(p.TotalSessions)) : ''}
        ${zones != null ? tile('Zones unlocked', fmt(zones)) : ''}
        ${p.GoalsCompleted != null ? tile('Goals completed', fmt(p.GoalsCompleted)) : ''}
        ${p.BoothDiamondsEarned != null ? tile('Booth earnings', `${num(p.BoothDiamondsEarned)} 💎`) : ''}
        ${p.FirstJoinTimestamp ? tile('First joined', esc(dateStr(p.FirstJoinTimestamp)), esc(ago(p.FirstJoinTimestamp))) : ''}
        ${p.LastJoinTimestamp ? tile('Last joined', esc(ago(p.LastJoinTimestamp)), esc(dateStr(p.LastJoinTimestamp, true))) : ''}
        ${ext && ext.RobuxSpent != null ? tile('Robux spent', fmt(ext.RobuxSpent)) : ''}
      </div>`;
      const cur = Object.values(p.Currency || {}).filter((c) => c && c._am).sort((a, b) => b._am - a._am);
      const mastery = Object.entries(p.Mastery || {}).filter(([, v]) => typeof v === 'number').sort((a, b) => b[1] - a[1]);
      h += '<div class="grid grid-2" style="margin-bottom:16px">';
      h += `<div class="card"><div class="card-head"><h2>Currencies</h2></div>${cur.length ? `<dl class="kv">${cur.map((c) => `<dt>${esc(pretty(c.id))}</dt><dd title="${fmt(c._am)}">${compact(c._am)}</dd>`).join('')}</dl>` : '<div class="muted small">None</div>'}</div>`;
      const mMax = Math.max(99, ...mastery.map(([, v]) => v));
      h += `<div class="card"><div class="card-head"><h2>Mastery</h2></div>${mastery.length ? mastery.map(([k, v]) => `<div style="margin-bottom:8px"><div class="row small" style="justify-content:space-between"><span>${esc(pretty(k))}</span><b>${fmt(v)}</b></div><div class="bar"><span style="width:${(v / mMax) * 100}%"></span></div></div>`).join('') : '<div class="muted small">None</div>'}</div>`;
      h += '</div>';
      const stats = Object.entries(st).filter(([, v]) => typeof v === 'number').sort((a, b) => a[0].localeCompare(b[0]));
      if (stats.length) h += `<details class="card" style="margin-bottom:16px"><summary><b>All statistics</b> <span class="muted small">(${stats.length})</span></summary><dl class="kv" style="margin-top:12px">${stats.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${fmt(v)}</dd>`).join('')}</dl></details>`;
      const ach = Object.entries(p.Achievements || {});
      if (ach.length) h += `<details class="card" style="margin-bottom:16px"><summary><b>Achievements</b> <span class="muted small">(${ach.length})</span></summary><dl class="kv" style="margin-top:12px">${ach.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v && v.Stage != null ? 'Stage ' + fmt(v.Stage) : ''}${v && v.Progress != null ? ` · ${compact(v.Progress)}` : ''}</dd>`).join('')}</dl></details>`;
    }
    if (ext) {
      const gp = Object.keys(ext.Gamepasses || {}).filter((k) => ext.Gamepasses[k]);
      h += `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Gamepasses</h2>${ext.RobuxSpent != null ? `<span class="chip accent">${fmt(ext.RobuxSpent)} Robux spent</span>` : ''}</div>
        <div class="row" style="gap:6px">${gp.length ? gp.map((g) => `<span class="chip">${esc(g)}</span>`).join('') : '<span class="muted small">None owned</span>'}</div></div>`;
    }
    if (p) h += `<details class="card"><summary><b>Raw profile JSON</b></summary><pre class="json" style="margin-top:12px">${esc(JSON.stringify(p, null, 2))}</pre></details>`;
    return h || '<div class="card empty">No profile data.</div>';
  }

  function renderInventory(body, inv, prefix = '') {
    const items = (inv && inv.items) || [];
    const val = (it) => (it.rap || 0) * (it.count || 1);
    const total = items.reduce((a, it) => a + val(it), 0);
    const huges = items.filter((it) => /^(huge|titanic|gargantuan)\b/i.test(it.displayName || it.id || '')).reduce((a, it) => a + (it.count || 1), 0);
    const eq = (inv && inv.equipped) || {};
    const pets = (eq.pets && eq.pets.list) || [];
    const classes = [...new Set(items.map((i) => i.class).filter(Boolean))].sort();
    const st = { q: '', cls: 'all', sort: 'value', limit: 100 };
    body.innerHTML = `${prefix}
      <div class="grid grid-tiles" style="margin-bottom:16px">
        ${tile('Inventory value', `${num(total)} 💎`, 'Sum of RAP × count')}
        ${tile('Item stacks', fmt(items.length), `${fmt(items.reduce((a, i) => a + (i.count || 1), 0))} total items`)}
        ${tile('Huge / Titanic / Garg', fmt(huges))}
        ${eq.pets ? tile('Pets equipped', `${fmt(eq.pets.equippedCount)} / ${fmt(eq.pets.maxEquipped)}`) : ''}
      </div>
      ${pets.length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Equipped pets</h2>
        <div class="row small muted">${eq.ultimate && eq.ultimate.id ? `<span>Ultimate: <b>${esc(eq.ultimate.displayName || eq.ultimate.id)}</b></span>` : ''}${eq.hoverboard ? `<span>Hoverboard: <b>${esc(eq.hoverboard.displayName)}</b></span>` : ''}${eq.booth ? `<span>Booth: <b>${esc(eq.booth.displayName)}</b></span>` : ''}</div></div>
        <div class="equipped">${pets.map((p) => { const vn = variantName(p.rainbow ? 2 : p.golden ? 1 : 0, p.shiny); return `<div class="pet">${thumb(p.golden && p.goldenIcon ? p.goldenIcon : p.icon, { size: 'lg', variant: variantOf(p.rainbow ? 2 : p.golden ? 1 : 0, p.shiny), label: p.displayName })}<span>${esc((vn ? vn + ' ' : '') + p.displayName)}</span></div>`; }).join('')}</div>
        ${eq.enchants && eq.enchants.list && eq.enchants.list.length ? `<div class="row" style="margin-top:14px;gap:6px"><span class="small muted">Enchants:</span>${eq.enchants.list.map((e) => `<span class="chip ${e.paid ? 'accent' : ''}">${esc(e.displayName || e.id)}</span>`).join('')}</div>` : ''}
      </div>` : ''}
      <div class="card flush">
        <div class="card-head"><h2>Items</h2>
          <div class="row"><div class="search-wrap" style="min-width:180px">${searchIcon}<input class="input" id="iq" placeholder="Filter items" autocomplete="off"></div>
          <select class="select" id="icls"><option value="all">All types</option>${classes.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
          <select class="select" id="isort"><option value="value">Total value</option><option value="rap">RAP each</option><option value="exists">Rarest</option><option value="count">Count</option><option value="newest">Newest</option></select></div></div>
        <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Item</th><th>Type</th><th class="num">Count</th><th class="num">RAP</th><th class="num">Exists</th><th class="num">Value</th></tr></thead><tbody id="ibody"></tbody></table></div>
        <div id="imore" style="text-align:center;padding:12px"></div>
      </div>`;
    function apply(reset = true) {
      if (reset) st.limit = 100;
      const toks = st.q.toLowerCase().split(/\s+/).filter(Boolean);
      const rows = items.map((it) => ({ it, n: enrichedName(it) })).filter(({ it, n }) => (st.cls === 'all' || it.class === st.cls) && toks.every((t) => n.name.toLowerCase().includes(t)));
      const created = (it) => (it.rawData && it.rawData.createdAt) || 0;
      rows.sort((a, b) => st.sort === 'rap' ? (b.it.rap || 0) - (a.it.rap || 0)
        : st.sort === 'exists' ? ((a.it.exists || Infinity) - (b.it.exists || Infinity))
          : st.sort === 'count' ? (b.it.count || 0) - (a.it.count || 0)
            : st.sort === 'newest' ? created(b.it) - created(a.it) : val(b.it) - val(a.it));
      $('#ibody').innerHTML = rows.slice(0, st.limit).map(({ it, n }) => `<tr>
        <td><div class="item-row">${thumb(n.icon, { size: 'sm', variant: variantOf(n.pt, n.sh), label: n.name })}<div style="min-width:0"><div class="item-name">${esc(n.name)}</div><div class="item-meta">${variantChips(n.pt, n.sh)}${it.rarity ? `<span class="chip">${esc(it.rarity)}</span>` : ''}</div></div></div></td>
        <td class="small muted">${esc(it.class || '')}</td><td class="num">${fmt(it.count || 1)}</td>
        <td class="num">${it.rap ? num(it.rap) : '—'}${it.rapApproximate ? '<span class="muted" title="Approximate RAP">~</span>' : ''}</td>
        <td class="num">${it.exists != null ? num(it.exists) : '—'}</td><td class="num"><b>${val(it) ? num(val(it)) : '—'}</b></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No items match.</td></tr>';
      $('#imore').innerHTML = rows.length > st.limit ? `<button class="btn" id="imorebtn">Show more (${fmt(rows.length - st.limit)} left)</button>` : '';
    }
    $('#iq').addEventListener('input', debounce((e) => { st.q = e.target.value; apply(); }, 150));
    $('#icls').addEventListener('change', (e) => { st.cls = e.target.value; apply(); });
    $('#isort').addEventListener('change', (e) => { st.sort = e.target.value; apply(); });
    $('#imore').addEventListener('click', (e) => { if (e.target.id === 'imorebtn') { st.limit += 200; apply(false); } });
    apply();
  }

  function renderIndex(d) {
    const idx = (d && d.ItemIndex) || {};
    const cats = Object.entries(idx).map(([k, v]) => [k, v && typeof v === 'object' ? Object.keys(v).length : 0]).sort((a, b) => b[1] - a[1]);
    if (!cats.length) return '<div class="card empty">Item index is empty.</div>';
    const pets = idx.Pet || {};
    const petNames = new Set(Object.keys(pets).map((k) => { try { return JSON.parse(k).id; } catch { return k; } }));
    return `<div class="grid grid-tiles" style="margin-bottom:16px">${tile('Unique pets discovered', fmt(petNames.size), `${fmt(Object.keys(pets).length)} incl. variants`)}${cats.filter(([k]) => k !== 'Pet').map(([k, n]) => tile(pretty(k), fmt(n))).join('')}</div>
      <details class="card"><summary><b>Raw item index JSON</b></summary><pre class="json" style="margin-top:12px">${esc(JSON.stringify(idx, null, 2))}</pre></details>`;
  }

  function renderFeed(kind, d) {
    const entries = (d && d.entries) || [];
    if (!entries.length) return '<div class="card empty">No entries.</div>';
    const shown = entries.slice(0, 100);
    const rows = shown.map((e) => {
      if (kind === 'mail') {
        return `<div class="feed-entry"><div class="row small"><span class="chip">${esc(pretty(e.type || 'Mail'))}</span>
          <span>${e.sender ? playerLink(e.sender.uid, e.sender.displayName) : 'System'} → ${e.receiver ? playerLink(e.receiver.uid, e.receiver.displayName) : '—'}</span>
          <span class="muted grow right" title="${esc(dateStr(e.timestamp, true))}">${esc(ago(e.timestamp))}</span></div>
          ${e.item ? miniItems([e.item]) : ''}${e.diamonds ? `<div class="small" style="margin-top:6px">💎 ${fmt(e.diamonds)} diamonds</div>` : ''}</div>`;
      }
      const g = itemsValue(e.given); const rv = itemsValue(e.received);
      return `<div class="feed-entry"><div class="row small">${kind === 'booth' ? `<span class="chip ${e.kind === 'sale' ? 'good' : 'accent'}">${e.kind === 'sale' ? 'Sold' : 'Bought'}</span>` : '<span class="chip">Trade</span>'}
        <span>with ${e.otherParty ? playerLink(e.otherParty.uid, e.otherParty.displayName) : 'unknown'}</span>
        <span class="muted grow right" title="${esc(dateStr(e.timestamp, true))}">${esc(ago(e.timestamp))}</span></div>
        <div class="grid grid-2" style="margin-top:6px;gap:8px">
          <div><div class="tiny muted">Gave${g ? ` · ${compact(g)} RAP` : ''}</div>${miniItems(e.given)}</div>
          <div><div class="tiny muted">Received${rv ? ` · ${compact(rv)} RAP` : ''}</div>${miniItems(e.received)}</div>
        </div></div>`;
    }).join('');
    return `<div class="card"><div class="card-head"><h2>${esc({ trades: 'Trade', booth: 'Booth', mail: 'Mail' }[kind] || pretty(kind))} history</h2><span class="small muted">${fmt(entries.length)} entries${entries.length > 100 ? ' · showing latest 100' : ''}</span></div>${rows}</div>`;
  }

  /* ======================================================================
   * VIEW: Clans
   * ==================================================================== */
  async function viewClans(r, alive) {
    const st = { page: 1, sort: 'Points' };
    view.innerHTML = `
      <div class="page-head"><div><h1>Clans</h1><p>Clan rankings, the active clan battle and clan lookup.</p></div>
        <form class="row" id="cform"><div class="search-wrap">${searchIcon}<input class="input" id="cname" placeholder="Clan name (exact)" autocomplete="off"></div><button class="btn primary">Open clan</button></form></div>
      <div class="grid grid-tiles" id="ctiles" style="margin-bottom:16px"></div>
      <div id="battle" style="margin-bottom:16px"></div>
      <div class="card flush"><div class="card-head"><h2>Top clans</h2>
        <div class="seg" id="csort"><button data-s="Points" class="on">Points</button><button data-s="DepositedDiamonds">Diamonds</button></div></div>
        <div id="ctable" style="margin-top:12px">${loadingHTML()}</div></div>`;
    $('#cform').addEventListener('submit', (e) => { e.preventDefault(); const n = $('#cname').value.trim(); if (n) location.hash = `#/clan/${enc(n)}`; });
    let total = null;
    api('/api/clansTotal', 300000).then((n) => { total = n; if (alive()) $('#ctiles').innerHTML = tile('Total clans', fmt(n)); }).catch(() => {});
    api('/api/activeClanBattle', 60000).then((b) => {
      if (!alive() || !b) return;
      const rewards = (b.configData && b.configData.PlacementRewards) || [];
      const cd = b.configData || {};
      $('#battle').innerHTML = `<a class="card release-card" href="#/battle/${enc(b.configName)}" style="display:block">
        <div class="card-head" style="margin-bottom:6px"><div><span class="small muted">Active clan battle</span><h2>${esc(cd.Title || pretty(b.configName))}</h2></div>
        <span class="row">${cd.StartTime || cd.FinishTime ? `<span class="chip">${esc(countdown(cd.StartTime, cd.FinishTime))}</span>` : ''}<span class="btn sm">View standings →</span></span></div>
        ${rewards.length ? `<div class="row small muted" style="gap:6px">Rewards: ${rewards.slice(0, 6).map((rw) => `<span class="chip">${esc(rw.Best === rw.Worst ? '#' + rw.Best : `#${rw.Best}–${rw.Worst}`)}: ${esc((rw.Item && rw.Item._data && rw.Item._data.id) || 'Reward')}</span>`).join('')}</div>` : ''}
      </a>`;
    }).catch(() => {});
    async function load() {
      const box = $('#ctable'); box.innerHTML = loadingHTML();
      try {
        const rows = await api(`/api/clans?page=${st.page}&pageSize=25&sort=${st.sort}&sortOrder=desc`, 60000);
        if (!alive()) return;
        const base = (st.page - 1) * 25;
        box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>#</th><th>Clan</th><th class="num">Members</th><th class="num">Points</th><th class="num">Diamonds</th><th class="num">Created</th></tr></thead><tbody>
          ${(rows || []).map((c, i) => `<tr class="clickable" data-href="#/clan/${enc(c.Name)}">${rankCell(base + i + 1)}
            <td><div class="item-row">${thumb(c.Icon, { size: 'sm', label: c.Name })}<b>${esc(c.Name)}</b> <span title="${esc(c.CountryCode)}">${flag(c.CountryCode)}</span></div></td>
            <td class="num">${fmt(c.Members)}<span class="muted">/${fmt(c.MemberCapacity)}</span></td><td class="num"><b>${num(c.Points)}</b></td>
            <td class="num">${num(c.DepositedDiamonds)}</td><td class="num small muted">${esc(dateStr(c.Created))}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No clans.</td></tr>'}
          </tbody></table></div>${pager(st.page, total ? Math.ceil(total / 25) : null, total, 'clans')}`;
        hydrateIcons(box);
      } catch (e) { if (alive()) box.innerHTML = `<div style="padding:16px">${errorHTML(e)}</div>`; }
    }
    $('#csort').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.sort = b.dataset.s; st.page = 1; $$('#csort button').forEach((x) => x.classList.toggle('on', x === b)); load(); });
    $('#ctable').addEventListener('click', (e) => { const p = e.target.closest('[data-page]'); if (p && !p.disabled) { st.page = +p.dataset.page; load(); } });
    load();
  }

  async function viewClan(r, alive) {
    const name = r.params[0];
    const c = await api(`/api/clan/${enc(name)}`, 60000); if (!alive()) return;
    if (!c) throw new ApiError('Clan not found.', 404);
    const members = [...(c.Members || [])];
    if (c.Owner && !members.some((m) => m.UserID === c.Owner)) members.unshift({ UserID: c.Owner, PermissionLevel: Infinity, JoinTime: c.Created });
    members.sort((a, b) => (b.UserID === c.Owner) - (a.UserID === c.Owner) || b.PermissionLevel - a.PermissionLevel || a.JoinTime - b.JoinTime);
    const contrib = Object.entries(c.Contribution || {});
    view.innerHTML = `
      <div class="card" style="margin-bottom:16px"><div class="profile-head">
        ${thumb(c.Icon, { size: 'xl', label: c.Name })}
        <div class="grow"><h1>${esc(c.Name)} <span title="${esc(c.CountryCode)}">${flag(c.CountryCode)}</span></h1>
          ${c.Desc ? `<p class="muted" style="margin:6px 0 0">${esc(c.Desc)}</p>` : ''}
          <div class="row" style="margin-top:8px;gap:6px">${c.GuildLevel != null ? `<span class="chip accent">Level ${fmt(c.GuildLevel)}</span>` : ''}
            <span class="chip golden">🥇 ${fmt(c.GoldMedals || 0)}</span><span class="chip">🥈 ${fmt(c.SilverMedals || 0)}</span><span class="chip warn">🥉 ${fmt(c.BronzeMedals || 0)}</span></div></div>
      </div></div>
      <div class="grid grid-tiles" style="margin-bottom:16px">
        ${tile('Members', `${fmt((c.Members || []).length)} / ${fmt(c.MemberCapacity)}`)}
        ${c.OfficerCapacity != null ? tile('Officer slots', fmt(c.OfficerCapacity)) : ''}
        ${c.DepositedDiamonds != null ? tile('Deposited', `${num(c.DepositedDiamonds)} 💎`) : ''}
        ${tile('Created', esc(dateStr(c.Created)), esc(ago(c.Created)))}
        ${c.LastKickTimestamp ? tile('Last kick', esc(ago(c.LastKickTimestamp))) : ''}
      </div>
      <div class="grid grid-2">
        <div class="card flush"><div class="card-head"><h2>Roster</h2><span class="small muted">${fmt(members.length)}</span></div>
          <div class="table-wrap" style="margin-top:12px;max-height:560px"><table><thead><tr><th>Player</th><th>Role</th><th class="num">Joined</th></tr></thead><tbody>
          ${members.map((m) => `<tr><td>${playerLink(m.UserID, String(m.UserID))}</td><td>${m.UserID === c.Owner ? '<span class="chip golden">Owner</span>' : `<span class="chip">Level ${esc(m.PermissionLevel)}</span>`}</td><td class="num small muted">${esc(ago(m.JoinTime))}</td></tr>`).join('')}
          </tbody></table></div></div>
        <div class="stack">${contrib.length ? contrib.map(([k, list]) => {
          const sorted = [...(list || [])].sort((a, b) => b.Points - a.Points); const max = sorted[0] ? sorted[0].Points : 1;
          return `<div class="card"><div class="card-head"><h2>${esc(pretty(k))} contributions</h2><span class="small muted">${fmt(sorted.reduce((a, x) => a + x.Points, 0))} pts</span></div>
            ${sorted.slice(0, 50).map((x, i) => `<div style="margin-bottom:8px"><div class="row small" style="justify-content:space-between"><span>#${i + 1} ${playerLink(x.UserID, String(x.UserID))}</span><b>${num(x.Points)}</b></div><div class="bar"><span style="width:${(x.Points / max) * 100}%"></span></div></div>`).join('')}</div>`;
        }).join('') : '<div class="card empty">No contribution data.</div>'}</div>
      </div>
      <p class="small muted">Player links open their PS99 profile if it's public. Names aren't included in clan data, so Roblox IDs are shown.</p>`;
  }

  async function viewBattle(r, alive) {
    const id = r.params[0];
    const d = await api(`/v1/clans/battles/${enc(id)}`, 60000); if (!alive()) return;
    const m = d.meta || {}; const s = d.stats || {};
    const medal = (x) => ({ gold: '🥇', silver: '🥈', bronze: '🥉', good: '🎖️' }[x] || '');
    view.innerHTML = `
      <div class="hero" style="margin-bottom:16px"><div class="row"><span class="chip">Clan battle</span>${stateChip(m.state)}<span class="chip">${esc(countdown(m.startTime, m.finishTime))}</span></div>
        <h1 style="margin-top:10px">${esc(m.title || pretty(m.id))}</h1><p>${esc(dateStr(m.startTime, true))} → ${esc(dateStr(m.finishTime, true))} · ${esc(duration(m.durationSeconds))}</p></div>
      <div class="grid grid-tiles" style="margin-bottom:16px">
        ${tile('Clans sampled', fmt(s.sampledClans))}${tile('Total points', num(s.totalClanPoints))}${tile('Contributors', fmt(s.totalContributors))}
        ${tile('Awards', s.awardsProcessed ? 'Paid out' : m.state === 'past' ? 'Pending' : '—')}
      </div>
      ${m.headlineReward || (m.placementRewards || []).length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Rewards</h2></div>${(m.placementRewards || []).map((b) => `<div class="reward-band"><span class="chip accent" style="min-width:70px;justify-content:center">${esc(b.placement)}</span>${(b.items || []).map(rewardItem).join('')}</div>`).join('') || rewardItem(m.headlineReward)}</div>` : ''}
      <div class="grid grid-2">
        <div class="card flush"><div class="card-head"><h2>Top clans</h2></div><div class="table-wrap" style="margin-top:12px;max-height:640px"><table><thead><tr><th>#</th><th>Clan</th><th class="num">Points</th></tr></thead><tbody>
          ${(d.topClans || []).map((c) => `<tr class="clickable" data-href="#/clan/${enc(c.name)}">${rankCell(c.rank)}<td><div class="item-row">${thumb(c.icon, { size: 'sm', label: c.name })}<b>${esc(c.name)}</b> ${flag(c.countryCode)} ${medal(c.medal)}</div></td><td class="num"><b>${num(c.points)}</b></td></tr>`).join('') || '<tr><td colspan="3" class="empty">No clans yet.</td></tr>'}
        </tbody></table></div></div>
        <div class="card flush"><div class="card-head"><h2>Top players</h2></div><div class="table-wrap" style="margin-top:12px;max-height:640px"><table><thead><tr><th>#</th><th>Player</th><th>Clan</th><th class="num">Points</th></tr></thead><tbody>
          ${(d.topPlayers || []).map((p) => `<tr>${rankCell(p.rank)}<td>${playerLink(p.userId, p.displayName)}</td><td class="small"><a href="#/clan/${enc(p.clan && p.clan.name)}">${esc(p.clan && p.clan.name)}</a></td><td class="num"><b>${num(p.points)}</b><div class="tiny muted">${(p.share * 100).toFixed(2)}%</div></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No players yet.</td></tr>'}
        </tbody></table></div></div>
      </div>`;
  }

  /* ======================================================================
   * VIEW: Leagues
   * ==================================================================== */
  async function viewLeagues(r, alive) {
    const data = await api('/v1/leagues/seasons', 60000); if (!alive()) return;
    const seasons = (data.seasons || []).filter((s) => s.run);
    const seasonId = r.query.season || data.active || (seasons[0] && seasons[0].id);
    const s = (data.seasons || []).find((x) => x.id.toLowerCase() === String(seasonId).toLowerCase()) || seasons[0];
    if (!s) { view.innerHTML = '<div class="card empty">No league seasons are configured.</div>'; return; }
    const st = { page: 1, search: '', tab: 'board' };
    view.innerHTML = `
      <div class="page-head"><div><h1>Leagues</h1><p>Four-player teams competing each season for placement rewards.</p></div>
        <select class="select" id="lseason">${seasons.map((x) => `<option value="${esc(x.id)}" ${x.id === s.id ? 'selected' : ''}>${esc(x.title)}${x.id === data.active ? ' (active)' : ''} · ${esc(pretty(x.state))}</option>`).join('')}</select></div>
      <div class="hero" style="margin-bottom:16px"><div class="profile-head">
        ${s.headlineReward ? thumb(s.headlineReward.icon, { size: 'xl', label: s.headlineReward.id }) : ''}
        <div class="grow"><div class="row">${stateChip(s.state)}<span class="chip">${esc(countdown(s.startTime, s.finishTime))}</span>${s.finalized ? `<span class="chip">${s.finalized.paid ? 'Rewards paid' : 'Standings final'}</span>` : ''}</div>
          <h1 style="margin-top:8px">${esc(s.title)}</h1><p>${esc(dateStr(s.startTime, true))} → ${esc(dateStr(s.finishTime, true))} · ${esc(duration(s.durationSeconds))}</p>
          ${s.headlineReward ? `<p>Headline reward: <b>${esc(variantName(variantFromString(s.headlineReward.variant).pt, variantFromString(s.headlineReward.variant).sh))} ${esc(s.headlineReward.id)}</b></p>` : ''}</div></div></div>
      ${s.finalized ? `<div class="grid grid-tiles" style="margin-bottom:16px">${tile('Ranked leagues', fmt(s.finalized.rankedTeams))}${tile('Players rewarded', fmt(s.finalized.winnerCount))}${tile('Rewarded through', '#' + fmt(s.finalized.rewardedThroughRank))}</div>` : ''}
      <div class="tabs" id="ltabs"><button data-t="board" class="on">Leaderboard</button><button data-t="players">Top players</button><button data-t="rewards">Rewards</button></div>
      <div id="lbody"></div>`;
    $('#lseason').addEventListener('change', (e) => { location.hash = `#/leagues?season=${enc(e.target.value)}`; });
    const body = $('#lbody');
    async function board() {
      body.innerHTML = `<div class="card flush"><div class="card-head"><h2>Standings</h2><div class="search-wrap" style="max-width:280px">${searchIcon}<input class="input" id="lq" placeholder="League name starts with…" value="${esc(st.search)}" autocomplete="off"></div></div><div id="ltable" style="margin-top:12px">${loadingHTML()}</div></div>`;
      $('#lq').addEventListener('input', debounce((e) => { st.search = e.target.value.trim(); st.page = 1; table(); }, 300));
      table();
    }
    async function table() {
      const box = $('#ltable'); if (!box) return; box.innerHTML = loadingHTML();
      try {
        const d = await api(`/v1/leagues?season=${enc(s.id)}&page=${st.page}&pageSize=25${st.search ? `&search=${enc(st.search)}` : ''}`, 60000);
        if (!alive() || !box.isConnected) return;
        box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>#</th><th>League</th><th class="num">Members</th><th class="num">Points</th><th class="num">Created</th></tr></thead><tbody>
          ${(d.leagues || []).map((l) => `<tr class="clickable" data-href="#/league/${enc(l.Name)}?season=${enc(s.id)}">${rankCell(l.Rank)}<td><div class="item-row">${thumb(l.Icon, { size: 'sm', label: l.Name })}<b>${esc(l.Name)}</b></div></td><td class="num">${fmt(l.Members)}<span class="muted">/${fmt(l.MemberCapacity)}</span></td><td class="num"><b>${num(l.Points)}</b></td><td class="num small muted">${esc(dateStr(l.Created))}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No leagues match.</td></tr>'}
          </tbody></table></div>${pager(d.page || st.page, Math.ceil((d.total || 0) / 25) || 1, d.total, 'leagues')}`;
      } catch (e) { if (alive()) box.innerHTML = `<div style="padding:16px">${errorHTML(e)}</div>`; }
    }
    async function players() {
      body.innerHTML = loadingHTML();
      try {
        const d = await api(`/v1/leagues/seasons/${enc(s.id)}`, 120000); if (!alive()) return;
        body.innerHTML = `<div class="card flush"><div class="card-head"><h2>Top contributors</h2><span class="small muted">Across the top ${fmt(d.stats && d.stats.sampledLeagues)} leagues</span></div>
          <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>#</th><th>Player</th><th>League</th><th class="num">Points</th></tr></thead><tbody>
          ${(d.topPlayers || []).map((p) => `<tr>${rankCell(p.rank)}<td>${playerLink(p.userId, p.displayName)}</td><td><a href="#/league/${enc(p.league.name)}?season=${enc(s.id)}">${esc(p.league.name)}</a> <span class="tiny muted">#${fmt(p.league.place)}</span></td><td class="num"><b>${num(p.points)}</b></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No contributors yet.</td></tr>'}
          </tbody></table></div></div>`;
      } catch (e) { if (alive()) body.innerHTML = errorHTML(e); }
    }
    function rewards() {
      body.innerHTML = `<div class="card">${(s.placementRewards || []).map((b) => `<div class="reward-band"><span class="chip accent" style="min-width:80px;justify-content:center">${esc(b.placement)}</span><div class="grow">${(b.items || []).map(rewardItem).join('')}</div></div>`).join('') || '<div class="empty">No rewards listed.</div>'}</div>`;
    }
    const tabsFn = { board, players, rewards };
    $('#ltabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $$('#ltabs button').forEach((x) => x.classList.toggle('on', x === b)); tabsFn[b.dataset.t](); });
    body.addEventListener('click', (e) => { const p = e.target.closest('[data-page]'); if (p && !p.disabled) { st.page = +p.dataset.page; table(); } });
    board();
  }

  async function viewLeague(r, alive) {
    const name = r.params[0]; const season = r.query.season;
    const l = await api(`/v1/leagues/${enc(name)}${season ? `?season=${enc(season)}` : ''}`, 60000); if (!alive()) return;
    const roster = [l.Owner && l.Owner.UserID ? { UserID: l.Owner.UserID, DisplayName: l.Owner.DisplayName, owner: true } : null, ...(l.Members || [])].filter(Boolean);
    const contrib = l.PointContributions || []; const max = Math.max(1, ...contrib.map((c) => c.Points));
    view.innerHTML = `
      <p class="small"><a href="#/leagues${l.Season ? `?season=${enc(l.Season.ID)}` : ''}">← ${esc(l.Season ? pretty(l.Season.ID) : 'Leagues')}</a></p>
      <div class="card" style="margin-bottom:16px"><div class="profile-head">${thumb(l.Icon, { size: 'xl', label: l.Name })}
        <div class="grow"><h1>${esc(l.Name)}</h1><div class="row" style="margin-top:8px">${l.Season ? stateChip(l.Season.State) : ''}${l.Season && l.Season.Finalized ? '<span class="chip accent">Finalized</span>' : ''}<span class="chip">Level ${fmt(l.Level)}</span></div></div>
        ${l.Reward ? `<div><div class="tiny muted" style="margin-bottom:6px">Reward for ${esc(l.Reward.placement)}</div>${(l.Reward.items || []).map(rewardItem).join('')}</div>` : ''}</div></div>
      <div class="grid grid-tiles" style="margin-bottom:16px">${tile('Place', l.Place ? '#' + fmt(l.Place) : '—')}${tile('Points', num(l.Points))}${tile('Roster', `${fmt(roster.length)} / ${fmt(l.MemberCapacity)}`)}${tile('Created', esc(dateStr(l.Created)))}</div>
      <div class="grid grid-2">
        <div class="card"><div class="card-head"><h2>Roster</h2></div>${roster.map((m) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>${playerLink(m.UserID, m.DisplayName)}</span>${m.owner ? '<span class="chip golden">Owner</span>' : `<span class="tiny muted">joined ${esc(ago(m.JoinTime))}</span>`}</div>`).join('')}</div>
        <div class="card"><div class="card-head"><h2>Contributions</h2></div>${contrib.map((c) => `<div style="margin-bottom:10px;${c.Counted ? '' : 'opacity:.55'}"><div class="row small" style="justify-content:space-between"><span>${playerLink(c.UserID, c.DisplayName)} ${c.Counted ? '' : '<span class="chip">Left · not counted</span>'}</span><b>${num(c.Points)}</b></div><div class="bar"><span style="width:${(c.Points / max) * 100}%"></span></div></div>`).join('') || '<div class="empty">No contributions yet.</div>'}</div>
      </div>`;
  }

  /* ======================================================================
   * VIEW: Leaderboards
   * ==================================================================== */
  async function viewBoards(r, alive) {
    const d = await api('/v1/leaderboards', 60000); if (!alive()) return;
    const boards = d.leaderboards || [];
    const st = { state: 'active', q: '' };
    const counts = boards.reduce((a, b) => ((a[b.state] = (a[b.state] || 0) + 1), a), {});
    view.innerHTML = `
      <div class="page-head"><div><h1>Leaderboards</h1><p>In-game event contests and permanent boards — live standings and the final results rewards were paid from.</p></div></div>
      <div class="card" style="margin-bottom:16px"><div class="row">
        <div class="search-wrap">${searchIcon}<input class="input" id="bq" placeholder="Search boards" autocomplete="off"></div>
        <div class="seg" id="bstate">${[['active', 'Active'], ['live', `Live (${counts.live || 0})`], ['ended', `Ended (${counts.ended || 0})`], ['final', `Final (${counts.final || 0})`], ['all', 'All']].map(([v, l]) => `<button data-v="${v}" class="${v === st.state ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
      <div class="grid grid-cards" id="blist"></div>`;
    function apply() {
      const q = st.q.toLowerCase();
      const list = boards.filter((b) => (st.state === 'all' || (st.state === 'active' ? b.state !== 'inactive' : b.state === st.state)) && (pretty(b.id).toLowerCase().includes(q) || b.id.toLowerCase().includes(q)));
      $('#blist').innerHTML = list.map((b) => `<a class="card release-card" href="#/board/${enc(b.id)}">
        <div class="row" style="justify-content:space-between">${stateChip(b.state)}${b.listSize ? `<span class="tiny muted">Top ${fmt(b.listSize)}</span>` : ''}</div>
        <h3 style="margin-top:10px">${esc(pretty(b.id))}</h3>
        <div class="small muted" style="margin-top:4px">${b.scoringEndsAt ? esc(Date.now() / 1000 < b.scoringEndsAt ? `Scoring ends ${ago(b.scoringEndsAt)}` : `Scoring ended ${ago(b.scoringEndsAt)}`) : 'Permanent board'}</div>
        ${b.final ? `<div class="tiny muted" style="margin-top:4px">Rewards through #${fmt(b.final.rewardedThroughRank)}</div>` : b.live && b.live.updatedAt ? `<div class="tiny muted" style="margin-top:4px">Updated ${esc(ago(b.live.updatedAt))}</div>` : ''}
      </a>`).join('') || '<div class="card empty" style="grid-column:1/-1">No boards match.</div>';
    }
    $('#bq').addEventListener('input', debounce((e) => { st.q = e.target.value; apply(); }, 120));
    $('#bstate').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.state = b.dataset.v; $$('#bstate button').forEach((x) => x.classList.toggle('on', x === b)); apply(); });
    apply();
  }

  async function viewBoard(r, alive) {
    const id = r.params[0];
    const st = { page: 1, source: r.query.source || '' };
    view.innerHTML = loadingHTML();
    const first = await api(`/v1/leaderboards/${enc(id)}?page=1&pageSize=50${st.source ? `&source=${st.source}` : ''}`, 60000); if (!alive()) return;
    const meta = first.leaderboard || {};
    st.source = first.source;
    const encoded = (meta.codec && meta.codec !== 'Integer') || /speedrun/i.test(meta.id);
    const fmtVal = (v) => (encoded ? `<span class="mono" title="Encoded value">${esc(v)}</span>` : num(v));
    view.innerHTML = `
      <p class="small"><a href="#/boards">← All leaderboards</a></p>
      <div class="hero" style="margin-bottom:16px"><div class="row">${stateChip(meta.state)}${meta.codec ? `<span class="chip">${esc(meta.codec)}</span>` : ''}</div>
        <h1 style="margin-top:10px">${esc(pretty(meta.id))}</h1>
        <p>${meta.scoringEndsAt ? `Scoring ${Date.now() / 1000 < meta.scoringEndsAt ? 'ends' : 'ended'} ${esc(dateStr(meta.scoringEndsAt, true))} (${esc(ago(meta.scoringEndsAt))})` : 'Permanent board'}${meta.final ? ` · Rewards paid through #${fmt(meta.final.rewardedThroughRank)}` : ''}</p></div>
      ${encoded ? '<div class="chip warn" style="margin-bottom:12px">This board stores an encoded score, so raw values are shown as-is. Ranking is still correct.</div>' : ''}
      <div class="card" style="margin-bottom:16px"><form class="row" id="bfind"><span class="small muted">Find a player:</span><input class="input grow" id="buid" inputmode="numeric" placeholder="Roblox user ID" style="max-width:240px"><button class="btn primary">Look up</button>
        ${meta.live && meta.final ? `<span class="grow"></span><div class="seg" id="bsrc"><button data-s="final" class="${st.source === 'final' ? 'on' : ''}">Final</button><button data-s="live" class="${st.source === 'live' ? 'on' : ''}">Live</button></div>` : ''}</form>
        <div id="bfound"></div></div>
      <div class="card flush"><div id="btable"></div></div>`;
    const rowHTML = (e) => `<tr>${rankCell(e.Rank)}<td>${playerLink(e.UserID, e.DisplayName || e.Name)}${e.Name && e.DisplayName && e.Name !== e.DisplayName ? ` <span class="tiny muted">@${esc(e.Name)}</span>` : ''}</td><td class="num"><b>${fmtVal(e.Value)}</b></td>${st.source === 'final' ? `<td class="num">${e.RewardTier ? `<span class="chip accent">Top ${fmt(e.RewardTier)}</span>` : '<span class="muted">—</span>'}</td>` : ''}</tr>`;
    function paint(d) {
      const pages = Math.ceil((d.total || 0) / 50) || 1;
      $('#btable').innerHTML = `<div class="card-head" style="margin-bottom:0;padding-bottom:12px"><h2>${st.source === 'final' ? 'Final standings' : 'Live standings'}</h2><span class="small muted">${d.updatedAt ? 'Updated ' + esc(ago(d.updatedAt)) : ''}</span></div>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th class="num">Score</th>${st.source === 'final' ? '<th class="num">Reward tier</th>' : ''}</tr></thead><tbody>
        ${(d.entries || []).map(rowHTML).join('') || '<tr><td colspan="4" class="empty">No rows on this page.</td></tr>'}</tbody></table></div>${pager(st.page, pages, d.total, 'rows')}`;
    }
    async function load() {
      $('#btable').innerHTML = loadingHTML();
      try { const d = await api(`/v1/leaderboards/${enc(id)}?page=${st.page}&pageSize=50&source=${st.source}`, 60000); if (alive()) paint(d); } catch (e) { if (alive()) $('#btable').innerHTML = `<div style="padding:16px">${errorHTML(e)}</div>`; }
    }
    paint(first);
    $('#btable').addEventListener('click', (e) => { const p = e.target.closest('[data-page]'); if (p && !p.disabled) { st.page = +p.dataset.page; load(); } });
    const src = $('#bsrc');
    if (src) src.addEventListener('click', (e) => { e.preventDefault(); const b = e.target.closest('button'); if (!b) return; st.source = b.dataset.s; st.page = 1; $$('#bsrc button').forEach((x) => x.classList.toggle('on', x === b)); load(); });
    $('#bfind').addEventListener('submit', async (e) => {
      e.preventDefault();
      const uid = $('#buid').value.trim(); const out = $('#bfound');
      if (!/^\d+$/.test(uid)) { out.innerHTML = '<p class="small muted">Enter a numeric Roblox user ID.</p>'; return; }
      out.innerHTML = loadingHTML();
      try {
        const d = await api(`/v1/leaderboards/${enc(id)}/players/${uid}?source=${st.source}`, 60000);
        out.innerHTML = `<div class="table-wrap" style="margin-top:12px"><table><tbody>${rowHTML(d.entry)}</tbody></table></div>`;
      } catch (err) { out.innerHTML = `<p class="small" style="margin:12px 0 0">${esc(err.message)}</p>`; }
    });
  }

  /* ======================================================================
   * VIEW: Updates (releases)
   * ==================================================================== */
  async function viewUpdates(r, alive) {
    const st = { page: 1, hideEmpty: store.get('ps99.hideEmpty', true) };
    view.innerHTML = `
      <div class="page-head"><div><h1>Game updates</h1><p>Every PS99 version imported by the API, and the items it added or changed.</p></div>
        <label class="row small"><input type="checkbox" id="hideEmpty" ${st.hideEmpty ? 'checked' : ''}> Hide updates with no item changes</label></div>
      <div id="rlist" class="stack"></div>`;
    $('#hideEmpty').addEventListener('change', (e) => { st.hideEmpty = e.target.checked; store.set('ps99.hideEmpty', st.hideEmpty); load(); });
    async function load() {
      const box = $('#rlist'); box.innerHTML = loadingHTML();
      try {
        const d = await api(`/v1/releases?page=${st.page}&pageSize=30`, 300000); if (!alive()) return;
        const list = (d.releases || []).filter((x) => !st.hideEmpty || x.added || x.changed);
        box.innerHTML = list.map((x) => `<a class="card release-card" href="#/release/${x.version}">
          <div class="row" style="justify-content:space-between"><div class="row"><h2>v${esc(x.version)}</h2>${x.added ? `<span class="chip good">+${fmt(x.added)} added</span>` : ''}${x.changed ? `<span class="chip warn">${fmt(x.changed)} changed</span>` : ''}${!x.added && !x.changed ? '<span class="chip">No item changes</span>' : ''}</div>
            <span class="small muted" title="${esc(dateStr(x.publishedAt || x.importedAt, true))}">${esc(ago(x.publishedAt || x.importedAt))}</span></div>
          ${Object.keys(x.collections || {}).length ? `<div class="row" style="margin-top:10px;gap:6px">${Object.entries(x.collections).map(([k, v]) => `<span class="chip">${esc(k)} ${v.added ? `<b style="color:var(--good)">+${v.added}</b>` : ''} ${v.changed ? `<b style="color:var(--warn)">~${v.changed}</b>` : ''}</span>`).join('')}</div>` : ''}
        </a>`).join('') || '<div class="card empty">No updates with item changes on this page.</div>';
        box.insertAdjacentHTML('beforeend', `<div class="card flush">${pager(st.page, Math.ceil((d.total || 0) / 30) || 1, d.total, 'releases')}</div>`);
      } catch (e) { if (alive()) box.innerHTML = errorHTML(e); }
    }
    $('#rlist').addEventListener('click', (e) => { const p = e.target.closest('[data-page]'); if (p && !p.disabled) { e.preventDefault(); st.page = +p.dataset.page; load(); window.scrollTo(0, 0); } });
    load();
  }

  const short = (v) => { if (v === undefined) return '∅'; const s = JSON.stringify(v); return s.length > 140 ? s.slice(0, 137) + '…' : s; };
  async function viewRelease(r, alive) {
    const ver = r.params[0] || 'latest';
    const d = await api(`/v1/releases/${enc(ver)}`, 600000); if (!alive()) return;
    const colls = Object.entries(d.collections || {});
    view.innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:12px"><a class="small" href="#/updates">← All updates</a>
        <div class="row">${d.previous ? `<a class="btn sm" href="#/release/${d.previous}">← v${d.previous}</a>` : ''}${d.next ? `<a class="btn sm" href="#/release/${d.next}">v${d.next} →</a>` : ''}</div></div>
      <div class="hero" style="margin-bottom:16px"><div class="row"><span class="chip">Version ${esc(d.version)}</span><span class="chip">+${fmt(d.added)} added</span><span class="chip">${fmt(d.changed)} changed</span></div>
        <h1 style="margin-top:10px">Update v${esc(d.version)}</h1><p>Published ${esc(dateStr(d.publishedAt, true))} · imported ${esc(ago(d.importedAt))}</p></div>
      <div class="stack">${colls.length ? colls.map(([name, c]) => `
        <div class="card"><div class="card-head"><h2>${esc(name)}</h2><div class="row">${c.added.length ? `<span class="chip good">+${c.added.length}</span>` : ''}${c.changed.length ? `<span class="chip warn">~${c.changed.length}</span>` : ''}</div></div>
          ${c.added.length ? `<h3 class="small muted" style="margin-bottom:8px">Added</h3><div class="grid grid-cards" style="margin-bottom:14px">${c.added.map((it) => `<a class="item-row card" style="padding:10px;color:var(--text)" href="#/data/${enc(name)}?q=${enc(it.configName)}">${thumb(it.icon, { label: it.displayName })}<div style="min-width:0"><div class="item-name">${esc(it.displayName)}</div><div class="item-meta">${it.category ? `<span class="chip">${esc(it.category)}</span>` : ''}${it.rarity ? `<span class="chip accent">${esc(it.rarity)}</span>` : ''}</div></div></a>`).join('')}</div>` : ''}
          ${c.changed.length ? `<h3 class="small muted" style="margin-bottom:8px">Changed</h3>${c.changed.map((it) => `<details style="border-top:1px solid var(--border);padding:8px 0"><summary class="item-row" style="display:flex">${thumb(it.icon, { size: 'sm', label: it.displayName })}<span class="item-name">${esc(it.displayName)}</span><span class="tiny muted">${it.changes ? `${it.changes.length + (it.more || 0)} field${it.changes.length + (it.more || 0) === 1 ? '' : 's'}` : 'details not recorded'}</span></summary>
            ${it.changes && it.changes.length ? `<div class="diff" style="margin-top:8px">${it.changes.map((ch) => `<div><span class="path">${esc(ch.path.join('.'))}</span>: ${'before' in ch ? `<span class="before">${esc(short(ch.before))}</span> → ` : ''}<span class="after">${'after' in ch ? esc(short(ch.after)) : '<i>removed</i>'}</span></div>`).join('')}${it.more ? `<div class="muted">…and ${fmt(it.more)} more</div>` : ''}</div>` : ''}</details>`).join('')}` : ''}
        </div>`).join('') : '<div class="card empty">This update didn\'t add or change any items.</div>'}</div>`;
  }

  /* ======================================================================
   * VIEW: Game data explorer
   * ==================================================================== */
  async function viewData(r, alive) {
    const list = await api('/api/collections', 3600e3); if (!alive()) return;
    const sel = r.params[0] || '';
    view.innerHTML = `
      <div class="page-head"><div><h1>Game data</h1><p>Browse the game's raw configuration — pets, eggs, enchants, zones and more.</p></div></div>
      <div class="row" style="gap:6px;margin-bottom:16px">${(list || []).map((c) => `<a class="chip ${c === sel ? 'accent' : ''}" href="#/data/${enc(c)}">${esc(pretty(c))}</a>`).join('')}</div>
      <div id="dbody">${sel ? loadingHTML(`Loading ${sel}…`) : '<div class="card empty">Pick a collection above.</div>'}</div>`;
    if (!sel) return;
    const rows = await api(`/api/collection/${enc(sel)}`, 30 * 60e3); if (!alive()) return;
    const cats = [...new Set(rows.map((x) => x.category).filter(Boolean))].sort();
    const st = { q: r.query.q || '', cat: 'all', limit: 80 };
    $('#dbody').innerHTML = `<div class="card flush"><div class="card-head"><h2>${esc(pretty(sel))} <span class="muted small">${fmt(rows.length)} entries</span></h2>
      <div class="row"><div class="search-wrap" style="min-width:200px">${searchIcon}<input class="input" id="dq" placeholder="Filter by name" value="${esc(st.q)}" autocomplete="off"></div>
      ${cats.length > 1 ? `<select class="select" id="dcat"><option value="all">All categories</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select>` : ''}</div></div>
      <div id="drows" style="padding:8px 16px 0"></div><div id="dmore" style="text-align:center;padding:12px"></div></div>`;
    function apply(reset = true) {
      if (reset) st.limit = 80;
      const q = st.q.toLowerCase();
      const f = rows.filter((x) => (st.cat === 'all' || x.category === st.cat) && (String(x.configName).toLowerCase().includes(q) || String((x.configData && x.configData.name) || '').toLowerCase().includes(q)));
      $('#drows').innerHTML = f.slice(0, st.limit).map((x, i) => {
        const cd = x.configData || {};
        return `<details style="border-bottom:1px solid var(--border);padding:8px 0" data-i="${rows.indexOf(x)}"><summary class="item-row" style="display:flex">${thumb(iconFromConfig(x), { size: 'sm', label: x.configName })}
          <div style="min-width:0" class="grow"><div class="item-name">${esc(cd.name || x.configName)}</div><div class="tiny muted ellipsis">${esc(x.configName)}${x.category ? ' · ' + esc(x.category) : ''}</div></div>
          ${x.dateModified ? `<span class="tiny muted nowrap">changed ${esc(ago(x.dateModified))}</span>` : ''}</summary><pre class="json" style="margin-top:8px"></pre></details>`;
      }).join('') || '<div class="empty">No entries match.</div>';
      $('#dmore').innerHTML = f.length > st.limit ? `<button class="btn" id="dmorebtn">Show more (${fmt(f.length - st.limit)} left)</button>` : '';
    }
    $('#drows').addEventListener('toggle', (e) => {
      const det = e.target; if (!det.open) return; const pre = det.querySelector('pre');
      if (pre && !pre.textContent) pre.textContent = JSON.stringify(rows[+det.dataset.i], null, 2);
    }, true);
    $('#dq').addEventListener('input', debounce((e) => { st.q = e.target.value; apply(); }, 150));
    const dc = $('#dcat'); if (dc) dc.addEventListener('change', (e) => { st.cat = e.target.value; apply(); });
    $('#dmore').addEventListener('click', (e) => { if (e.target.id === 'dmorebtn') { st.limit += 150; apply(false); } });
    apply();
  }

  /* ======================================================================
   * Router & boot
   * ==================================================================== */
  const routes = {
    prices: viewPrices, trade: viewTrade, players: viewPlayers, player: viewPlayer, clans: viewClans, clan: viewClan,
    battle: viewBattle, leagues: viewLeagues, league: viewLeague, boards: viewBoards, board: viewBoard,
    updates: viewUpdates, release: viewRelease, data: viewData,
  };
  const navFor = { player: 'players', clan: 'clans', battle: 'clans', league: 'leagues', board: 'boards', release: 'updates' };
  const titles = { prices: 'Prices', trade: 'Trade Calculator', players: 'Players', player: 'Player', clans: 'Clans', clan: 'Clan', battle: 'Clan Battle', leagues: 'Leagues', league: 'League', boards: 'Leaderboards', board: 'Leaderboard', updates: 'Updates', release: 'Update', data: 'Game Data' };
  let token = 0; let lastRoute = '';
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [p, q = ''] = h.split('?');
    const parts = p.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
    return { name: routes[parts[0]] ? parts[0] : 'prices', params: parts.slice(1), query: Object.fromEntries(new URLSearchParams(q)) };
  }
  async function router() {
    const r = parseHash();
    const my = ++token; const alive = () => my === token;
    const navKey = navFor[r.name] || r.name;
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === navKey));
    const sub = r.params[0] ? ` · ${r.params[0]}` : '';
    document.title = `${titles[r.name]}${sub} — PS99 Toolkit`;
    // Swap in a fresh <main> so per-view listeners never stack up across navigations.
    const fresh = view.cloneNode(false); view.replaceWith(fresh); view = fresh;
    if (location.hash !== lastRoute) window.scrollTo(0, 0);
    lastRoute = location.hash;
    view.innerHTML = loadingHTML();
    try { await routes[r.name](r, alive); } catch (e) {
      if (alive()) view.innerHTML = `${errorHTML(e)}<p style="margin-top:12px"><button class="btn" onclick="location.reload()">Retry</button></p>`;
    }
  }
  // Clickable table rows
  document.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, select, summary')) return;
    const tr = e.target.closest('[data-href]'); if (tr) location.hash = tr.dataset.href;
  });

  // Theme
  const root = document.documentElement;
  const savedTheme = store.get('ps99.theme', null);
  if (savedTheme) root.dataset.theme = savedTheme;
  document.getElementById('themeToggle').addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark'; store.set('ps99.theme', root.dataset.theme);
  });

  window.addEventListener('hashchange', router);
  router();
})();
