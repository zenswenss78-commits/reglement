// BLACKLIFE RP — interface du règlement (lecture publique + administration via Discord)
'use strict';

const state = {
  data: null,        // réponse de /api/data
  civilView: false,  // une personne connectée peut voir le site comme un visiteur
  dirty: false,      // modifications non enregistrées dans l'éditeur
  lastHash: location.hash,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const me = () => state.data && state.data.user;
const loggedIn = () => !!me();
const can = perm => loggedIn() && (me().owner || !!me().perms[perm]);
const editing = () => can('edit') && !state.civilView;

// Avatar Discord (ou avatar par défaut si la personne n'en a pas).
const avatarUrl = u => u.avatar
  ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
  : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;
const fmtDate = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const PERM_LABELS = {
  edit: ['Modifier le règlement', 'Créer, modifier, organiser et supprimer catégories et articles'],
  publish: ['Publier', 'Publier ou dépublier catégories et articles'],
  appearance: ['Apparence', 'Couleurs, logo, nom du serveur'],
};

const ICON = {
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  eye: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.5M2 2l20 20"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z"/><path d="M14 3v5h5M12 11v6M9 14h6"/></svg>',
  folder: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M12 11v5M9.5 13.5h5"/></svg>',
  link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  left: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(method, url, body, headers = {}) {
  const opts = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body instanceof Blob) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
  return json;
}

async function loadData() {
  state.data = await api('GET', '/api/data');
  if (!loggedIn()) state.civilView = false;
  applyTheme();
}

function uploadImage(file) {
  if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error('Image trop lourde (5 Mo max).'));
  return api('POST', '/api/upload', file, { 'Content-Type': file.type });
}

function pickImage() {
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp' });
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

// ---------------------------------------------------------------------------
// Données & numérotation
// ---------------------------------------------------------------------------

// Ce que voit l'utilisateur courant (en « vue civile », uniquement le publié).
function visible() {
  const { categories, articles } = state.data;
  if (!state.civilView) return { categories, articles };
  const byId = new Map(categories.map(c => [c.id, c]));
  const ok = c => c && c.published && (!c.parentId || ok(byId.get(c.parentId)));
  const cats = categories.filter(ok);
  const ids = new Set(cats.map(c => c.id));
  return { categories: cats, articles: articles.filter(a => a.published && ids.has(a.categoryId)) };
}

const byOrder = (a, b) => a.order - b.order;
const childCats = (v, parentId) => v.categories.filter(c => (c.parentId || null) === parentId).sort(byOrder);
const catArticles = (v, catId) => v.articles.filter(a => a.categoryId === catId).sort(byOrder);
const findCat = (v, id) => v.categories.find(c => c.id === id);

// Numéros hiérarchiques : catégories « 2.1 », articles « 2.1.3 ».
function numbering(v) {
  const cat = new Map(), art = new Map();
  const walk = (parentId, prefix) => childCats(v, parentId).forEach((c, i) => {
    const n = prefix ? `${prefix}.${i + 1}` : String(i + 1);
    cat.set(c.id, n);
    catArticles(v, c.id).forEach((a, j) => art.set(a.id, `${n}.${j + 1}`));
    walk(c.id, n);
  });
  walk(null, '');
  return { cat, art };
}

function ancestors(v, catId) {
  const out = [];
  let c = findCat(v, catId);
  while (c) { out.unshift(c); c = c.parentId ? findCat(v, c.parentId) : null; }
  return out;
}

function countArticlesDeep(v, catId) {
  return catArticles(v, catId).length + childCats(v, catId).reduce((n, c) => n + countArticlesDeep(v, c.id), 0);
}

// ---------------------------------------------------------------------------
// Nettoyage HTML (liste blanche) — appliqué à tout contenu affiché ou enregistré
// ---------------------------------------------------------------------------

const ALLOWED = {
  P: [], BR: [], STRONG: [], B: [], EM: [], I: [], U: [], S: [], STRIKE: [], DEL: [], MARK: [], SPAN: [],
  H2: [], H3: [], H4: [], UL: [], OL: [], LI: [], BLOCKQUOTE: [], HR: [], DIV: ['class'], A: ['href'], IMG: ['src', 'alt'],
};
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'META', 'LINK', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT']);

function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const clean = node => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); continue; }
      const tag = child.tagName;
      if (DROP.has(tag)) { child.remove(); continue; }
      clean(child);
      if (tag === 'H1') { const h = doc.createElement('h2'); h.append(...child.childNodes); child.replaceWith(h); continue; }
      if (!ALLOWED[tag]) { child.replaceWith(...child.childNodes); continue; }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        const val = attr.value.trim();
        let keep = ALLOWED[tag].includes(name);
        if (keep && name === 'href') keep = /^(https?:|mailto:|#)/i.test(val);
        if (keep && name === 'src') keep = /^(\/uploads\/|https:)/i.test(val);
        if (keep && name === 'class') keep = /^callout callout-(info|warn|danger)$/.test(val);
        if (!keep) child.removeAttribute(attr.name);
      }
      if (tag === 'DIV' && !child.hasAttribute('class')) {
        const p = doc.createElement('p'); p.append(...child.childNodes); child.replaceWith(p);
      }
      if (tag === 'A' && /^https?:/i.test(child.getAttribute('href') || '')) {
        child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer');
      }
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
}

const textOf = html => new DOMParser().parseFromString(html || '', 'text/html').body.textContent.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Thème
// ---------------------------------------------------------------------------

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function applyTheme(settings = state.data.settings) {
  const root = document.documentElement.style;
  const c = settings.colors;
  root.setProperty('--accent', c.accent);
  root.setProperty('--bg', c.background);
  root.setProperty('--surface', c.surface);
  root.setProperty('--text', c.text);
  root.setProperty('--on-accent', luminance(c.accent) > 0.45 ? '#0b0b10' : '#ffffff');
  document.documentElement.style.colorScheme = luminance(c.background) > 0.5 ? 'light' : 'dark';
  $('#favicon').href = settings.logo || `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${c.accent}"/><text x="16" y="22" font-family="Arial" font-weight="700" font-size="16" text-anchor="middle" fill="#fff">${esc(initials(settings.siteName))}</text></svg>`)}`;
}

const initials = name => (String(name).match(/\b\w/g) || ['R']).slice(0, 2).join('').toUpperCase();
const logoHtml = (s, cls) => s.logo ? `<img class="${cls}" src="${esc(s.logo)}" alt="">` : `<div class="${cls === 'hero-logo' ? 'hero-mark' : 'brand-mark'}">${esc(initials(s.siteName))}</div>`;

// ---------------------------------------------------------------------------
// UI commune
// ---------------------------------------------------------------------------

function toast(msg, error = false) {
  const el = Object.assign(document.createElement('div'), { className: `toast${error ? ' error' : ''}`, textContent: msg });
  $('#toasts').append(el);
  setTimeout(() => el.remove(), error ? 5000 : 2800);
}

async function attempt(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(e.message, true); throw e; }
}

function modal(title, bodyHtml, { submitLabel = 'Enregistrer', danger = false, onSubmit } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<form class="modal" role="dialog" aria-modal="true">
    <h2>${esc(title)}</h2>${bodyHtml}
    <p class="error-msg" data-err></p>
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel>Annuler</button>
      <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(submitLabel)}</button>
    </div></form>`;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  $('[data-cancel]', wrap).onclick = close;
  wrap.firstElementChild.onsubmit = async e => {
    e.preventDefault();
    const btn = $('button[type=submit]', wrap);
    btn.disabled = true;
    try { await onSubmit(new FormData(e.target), wrap); close(); }
    catch (err) { $('[data-err]', wrap).textContent = err.message; btn.disabled = false; }
  };
  document.body.append(wrap);
  ($('input, textarea, select', wrap) || $('button[type=submit]', wrap)).focus();
  return wrap;
}

const confirmBox = (title, text, label = 'Supprimer') =>
  new Promise(resolve => {
    const m = modal(title, `<p>${text}</p>`, { submitLabel: label, danger: true, onSubmit: async () => resolve(true) });
    $('[data-cancel]', m).addEventListener('click', () => resolve(false));
  });

function renderShell() {
  const s = state.data.settings;
  const route = location.hash;
  $('#topbar').innerHTML = `
    <div class="topbar-inner">
      <a class="brand" href="#/">${logoHtml(s, '')}<span>${esc(s.siteName)}</span></a>
      <label class="top-search">${ICON.search}<input type="search" id="top-search" placeholder="Rechercher une règle…" aria-label="Rechercher dans le règlement"></label>
      <nav class="top-nav">
        <a class="nav-link ${route.startsWith('#/c/') ? 'active' : ''}" href="#/reglement">Règlement</a>
        ${loggedIn() ? `<a class="nav-link ${route.startsWith('#/admin') ? 'active' : ''}" href="#/admin">Administration</a>` : ''}
      </nav>
    </div>
    ${loggedIn() ? `<div class="founder-bar"><div class="founder-bar-inner">
      <img class="mini-avatar" src="${avatarUrl(me())}" alt=""><span>Connecté : <strong>${esc(me().username)}</strong></span>
      ${me().owner ? '<span class="role-pill">PROPRIÉTAIRE</span>' : ''}
      <span class="spacer"></span>
      <label class="toggle" title="Afficher le site exactement comme un joueur (contenu publié uniquement, sans brouillons)"><input type="checkbox" id="civil-toggle" ${state.civilView ? 'checked' : ''}> Voir comme un joueur</label>
      <button class="linkish" id="logout">Déconnexion</button>
    </div></div>` : ''}`;
  $('#footer').innerHTML = `<div class="footer-inner">
    <span>© ${new Date().getFullYear()} ${esc(s.siteName)} — Règlement officiel</span>
    ${loggedIn() ? '' : '<a href="#/connexion">Connexion staff</a>'}</div>`;

  const search = $('#top-search');
  if (route.startsWith('#/recherche')) search.value = searchQuery();
  search.addEventListener('input', () => goSearch(search.value));
  search.addEventListener('keydown', e => { if (e.key === 'Escape') { search.value = ''; goSearch(''); } });
  if (loggedIn()) {
    $('#civil-toggle').onchange = e => { state.civilView = e.target.checked; render(); };
    $('#logout').onclick = async () => {
      if (!confirmLeave()) return;
      await api('POST', '/api/logout');
      await loadData();
      location.hash = '#/';
      render();
    };
  }
}

// ---------------------------------------------------------------------------
// Routeur
// ---------------------------------------------------------------------------

function parseRoute() {
  const [pathPart, query = ''] = location.hash.replace(/^#/, '').split('?');
  return { parts: pathPart.split('/').filter(Boolean), params: new URLSearchParams(query) };
}

function confirmLeave() {
  if (!state.dirty) return true;
  if (!confirm('Des modifications ne sont pas enregistrées. Quitter quand même ?')) return false;
  state.dirty = false;
  return true;
}

window.addEventListener('hashchange', () => {
  if (!confirmLeave()) { history.replaceState(null, '', state.lastHash); return; }
  state.dirty = false;
  render();
});
window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

function render() {
  state.lastHash = location.hash;
  app.onclick = app.onkeydown = null;
  renderShell();
  const { parts, params } = parseRoute();
  const [p0, p1, p2] = parts;
  window.scrollTo(0, 0);

  if (!p0) return renderHome();
  if (p0 === 'reglement') return renderReglement();
  if (p0 === 'c') return renderCategory(p1, p2);
  if (p0 === 'recherche') return renderSearch();
  if (p0 === 'connexion') return loggedIn() ? (location.hash = '#/admin') : renderLogin(params);
  if (p0 === 'admin') {
    if (!loggedIn()) { location.hash = '#/connexion'; return; }
    if (p1 === 'article') return can('edit') ? renderEditor(p2, params.get('cat')) : renderDenied();
    if (p1 === 'apparence') return can('appearance') ? renderAppearance() : renderDenied();
    if (p1 === 'acces') return me().owner ? renderAccess() : renderDenied();
    if (can('edit') || can('publish')) return renderAdminTree();
    if (can('appearance')) { history.replaceState(null, '', '#/admin/apparence'); return renderAppearance(); }
    return renderDenied();
  }
  renderNotFound();
}

function renderDenied() {
  app.innerHTML = `${adminHeader(null)}<div class="empty">Vous n'avez pas encore d'accès sur cette partie. Demandez au propriétaire de vous en donner.</div>`;
}

function renderNotFound() {
  app.innerHTML = `<div class="empty"><h2>Page introuvable</h2><p><a href="#/">Retour à l'accueil</a></p></div>`;
}

// ---------------------------------------------------------------------------
// Accueil
// ---------------------------------------------------------------------------

function renderHome() {
  const s = state.data.settings;
  const v = visible();
  const nums = numbering(v);
  const tops = childCats(v, null);
  const lastUpdate = v.articles.reduce((m, a) => Math.max(m, a.updatedAt || 0), 0);
  const recent = v.articles.filter(a => a.updatedAt).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  document.title = `${s.siteName} — Règlement`;
  app.innerHTML = `
    <section class="hero">
      ${logoHtml(s, 'hero-logo')}
      <h1>${esc(s.siteName)}</h1>
      ${s.tagline ? `<p>${esc(s.tagline)}</p>` : ''}
      <label class="hero-search">${ICON.search}<input type="search" id="hero-search" placeholder="Rechercher une règle, un mot-clé… (ex. freekill)" aria-label="Rechercher dans le règlement"></label>
      ${tops.length ? `<a class="btn btn-primary btn-lg" href="#/c/${tops[0].id}">Lire le règlement</a>` : ''}
      ${v.articles.length ? `<div class="hero-stats">
        <span><strong>${tops.length}</strong> catégorie${tops.length > 1 ? 's' : ''}</span>
        <span><strong>${v.articles.length}</strong> article${v.articles.length > 1 ? 's' : ''}</span>
        ${lastUpdate ? `<span>Mis à jour le <strong>${fmtDate(lastUpdate)}</strong></span>` : ''}
      </div>` : ''}
    </section>

    ${tops.length ? `<h2 class="section-title">Comment lire ce règlement</h2>
    <div class="guide-grid">
      <div class="guide-card"><span class="guide-ico">📖</span><h3>Les numéros</h3>
        <p>Chaque règle a un numéro. <strong>Article 2.1.3</strong> = catégorie 2, section 1, article 3. Citez ce numéro quand vous parlez d'une règle au staff.</p></div>
      <div class="guide-card"><span class="guide-ico">🔎</span><h3>Trouver une règle</h3>
        <p>Tapez un mot dans la barre de recherche (<em>freekill</em>, <em>braquage</em>…) : les règles concernées s'affichent tout de suite.</p></div>
      <div class="guide-card"><span class="guide-ico">🎨</span><h3>Les encadrés</h3>
        <p><span class="chip chip-info">ℹ Information</span> conseil ou précision<br>
        <span class="chip chip-warn">⚠ Important</span> point à ne pas rater<br>
        <span class="chip chip-danger">⛔ Sanction</span> punition prévue</p></div>
      <div class="guide-card"><span class="guide-ico">🔗</span><h3>Partager</h3>
        <p>Sous chaque article, le bouton <strong>« Copier le lien »</strong> donne un lien direct à coller sur Discord.</p></div>
    </div>
    <p class="accept-note">En jouant sur ${esc(s.siteName)}, vous vous engagez à connaître et respecter ce règlement. Le non-respect peut entraîner des sanctions.</p>

    <h2 class="section-title">Catégories du règlement</h2>
      <div class="cat-grid">${tops.map(c => {
        const subs = childCats(v, c.id);
        const n = countArticlesDeep(v, c.id);
        const arts = catArticles(v, c.id);
        return `<a class="cat-card" href="#/c/${c.id}">
          <div class="cat-card-top"><span class="cat-num">${nums.cat.get(c.id)}</span>${c.published ? '' : '<span class="badge badge-draft">Brouillon</span>'}</div>
          <h3>${esc(c.title)}</h3>
          ${c.description ? `<p>${esc(c.description)}</p>` : ''}
          ${arts.length ? `<ul class="cat-preview">${arts.slice(0, 3).map(a => `<li><span>${nums.art.get(a.id)}</span>${esc(a.title)}</li>`).join('')}
            ${arts.length > 3 ? `<li class="more">et ${arts.length - 3} autre${arts.length - 3 > 1 ? 's' : ''}…</li>` : ''}</ul>` : ''}
          <div class="meta">${plural(n, 'article')}${subs.length ? ` · ${plural(subs.length, 'sous-catégorie')}` : ''}<span class="go">Lire ${ICON.right}</span></div>
        </a>`;
      }).join('')}</div>

    ${recent.length ? `<h2 class="section-title">Dernières modifications</h2>
      <div class="recent">${recent.map(a => `<a href="#/c/${a.categoryId}/${a.id}">
        <span class="recent-num">Art. ${nums.art.get(a.id)}</span>
        <span class="recent-title">${esc(a.title)}</span>
        <span class="recent-date">${fmtDate(a.updatedAt)}</span></a>`).join('')}</div>` : ''}`
      : `<div class="empty">${editing() ? 'Aucune catégorie pour le moment. <a href="#/admin">Créer la première catégorie</a>.' : "Le règlement n'est pas encore publié."}</div>`}`;
  $('#hero-search').addEventListener('input', e => goSearch(e.target.value));
}

// ---------------------------------------------------------------------------
// Lecture du règlement
// ---------------------------------------------------------------------------

function renderReglement() {
  const first = childCats(visible(), null)[0];
  if (first) { history.replaceState(null, '', `#/c/${first.id}`); return render(); }
  renderHome();
}

function sidebarHtml(v, nums, activeId) {
  const activePath = new Set(ancestors(v, activeId).map(c => c.id));
  const list = parentId => {
    const cats = childCats(v, parentId);
    if (!cats.length) return '';
    return `<ul>${cats.map(c => `<li>
      <a href="#/c/${c.id}" class="${c.id === activeId ? 'active' : ''}"><span class="n">${nums.cat.get(c.id)}</span><span>${esc(c.title)}</span></a>
      ${activePath.has(c.id) || parentId === null ? list(c.id) : ''}</li>`).join('')}</ul>`;
  };
  return `<aside class="sidebar"><details open><summary>Sommaire</summary>
    <p class="sidebar-title">Sommaire</p>${list(null)}</details></aside>`;
}

function articleHtml(a, num, preview = false) {
  return `<article class="rule ${a.published ? '' : 'is-draft'}" id="art-${a.id}">
    <header class="rule-head">
      <span class="rule-num">Article ${esc(num)}</span>
      <h3>${esc(a.title)}</h3>
      ${a.published || preview ? '' : '<span class="badge badge-draft">Brouillon</span>'}
      ${!preview && editing() ? `<span class="tools"><a class="btn btn-sm" href="#/admin/article/${a.id}">${ICON.edit} Modifier</a></span>` : ''}
    </header>
    <div class="prose">${sanitize(a.content)}</div>
    ${preview ? '' : `<footer class="rule-foot">
      ${a.updatedAt ? `<span>Mis à jour le ${fmtDate(a.updatedAt)}</span>` : '<span></span>'}
      <button type="button" class="linkish" data-copy="#/c/${a.categoryId}/${a.id}">${ICON.link} Copier le lien</button>
    </footer>`}
  </article>`;
}

function sectionHtml(v, nums, c, depth) {
  const arts = catArticles(v, c.id);
  const subs = childCats(v, c.id);
  const H = depth === 0 ? 'h1' : 'h2';
  return `<section class="cat-section" id="cat-${c.id}">
    <div class="cat-head">
      <span class="num">${depth === 0 ? 'Catégorie' : 'Section'} ${nums.cat.get(c.id)}</span>
      ${c.published ? '' : ' <span class="badge badge-draft">Brouillon</span>'}
      <${H}>${esc(c.title)}</${H}>
      ${c.description ? `<p>${esc(c.description)}</p>` : ''}
    </div>
    ${arts.map(a => articleHtml(a, nums.art.get(a.id))).join('')}
    ${!arts.length && !subs.length ? `<div class="empty">Aucun article dans cette catégorie.${editing() ? ` <a href="#/admin/article/new?cat=${c.id}">Ajouter un article</a>` : ''}</div>` : ''}
    ${subs.map(sc => sectionHtml(v, nums, sc, depth + 1)).join('')}
  </section>`;
}

function renderCategory(id, articleId) {
  const v = visible();
  const c = findCat(v, id);
  if (!c) return renderNotFound();
  const nums = numbering(v);
  const path = ancestors(v, id);
  // Tous les articles affichés sur la page (catégorie + sous-sections), dans l'ordre de lecture.
  const pageArticles = [];
  const collect = cid => { pageArticles.push(...catArticles(v, cid)); childCats(v, cid).forEach(sc => collect(sc.id)); };
  collect(c.id);
  // Catégorie précédente / suivante dans l'ordre du sommaire.
  const flat = [];
  const walk = parentId => childCats(v, parentId).forEach(x => { flat.push(x); walk(x.id); });
  walk(null);
  const i = flat.findIndex(x => x.id === id);
  const prev = flat[i - 1], next = flat[i + 1];
  document.title = `${c.title} — ${state.data.settings.siteName}`;
  app.innerHTML = `<div class="reader">
    ${sidebarHtml(v, nums, id)}
    <div>
      <nav class="crumbs"><a href="#/">Accueil</a>${path.map(p => ` › <a href="#/c/${p.id}">${esc(p.title)}</a>`).join('')}</nav>
      ${editing() ? `<p style="margin:-6px 0 18px"><a class="btn btn-sm" href="#/admin/article/new?cat=${c.id}">${ICON.plus} Ajouter un article ici</a></p>` : ''}
      ${pageArticles.length > 1 ? `<nav class="page-toc"><span class="page-toc-title">Dans cette page · ${plural(pageArticles.length, 'article')}</span>
        <div>${pageArticles.map(a => `<a href="#" data-jump="${a.id}"><span>${nums.art.get(a.id)}</span>${esc(a.title)}</a>`).join('')}</div></nav>` : ''}
      ${sectionHtml(v, nums, c, 0)}
      <nav class="pager">
        ${prev ? `<a class="pager-link" href="#/c/${prev.id}">${ICON.left}<span><small>Précédent</small>${nums.cat.get(prev.id)}. ${esc(prev.title)}</span></a>` : '<span></span>'}
        ${next ? `<a class="pager-link next" href="#/c/${next.id}"><span><small>Suivant</small>${nums.cat.get(next.id)}. ${esc(next.title)}</span>${ICON.right}</a>` : '<span></span>'}
      </nav>
    </div></div>`;

  const jumpTo = artId => {
    const el = document.getElementById(`art-${artId}`);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1800);
  };
  if (articleId) requestAnimationFrame(() => jumpTo(articleId));

  app.onclick = e => {
    const jump = e.target.closest('[data-jump]');
    if (jump) { e.preventDefault(); return jumpTo(jump.dataset.jump); }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const url = `${location.origin}/${copy.dataset.copy}`;
      navigator.clipboard.writeText(url).then(() => toast('Lien copié : collez-le sur Discord.'), () => toast(url));
    }
  };
}

// ---------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------

const searchQuery = () => parseRoute().params.get('q') || '';

function goSearch(q) {
  const hash = q.trim() ? `#/recherche?q=${encodeURIComponent(q)}` : '#/recherche';
  if (location.hash.startsWith('#/recherche')) {
    history.replaceState(null, '', hash);
    state.lastHash = hash;
    renderSearchResults();
    const top = $('#top-search');
    if (top && document.activeElement !== top) top.value = q;
  } else if (q.trim()) {
    history.pushState(null, '', hash);
    render();
    const top = $('#top-search');
    top.value = q;
    top.focus();
  }
}

function renderSearch() {
  document.title = `Recherche — ${state.data.settings.siteName}`;
  app.innerHTML = `<div class="search-head"><h1>Recherche</h1><p class="hint" id="search-count"></p></div><div id="results"></div>`;
  renderSearchResults();
  const top = $('#top-search');
  if (top && !top.value) top.focus();
}

function highlight(text, terms) {
  let out = esc(text);
  for (const t of terms) {
    if (!t) continue;
    const re = new RegExp(esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, m => `<mark>${m}</mark>`);
  }
  return out;
}

function snippet(text, term) {
  if (!term) return text.slice(0, 180);
  const i = norm(text).indexOf(norm(term));
  if (i < 0) return text.slice(0, 180) + (text.length > 180 ? '…' : '');
  const start = Math.max(0, i - 60);
  return (start ? '…' : '') + text.slice(start, start + 200) + (start + 200 < text.length ? '…' : '');
}

function renderSearchResults() {
  const results = $('#results');
  if (!results) return;
  const q = searchQuery().trim();
  const terms = norm(q).split(/\s+/).filter(Boolean);
  const count = $('#search-count');
  if (!terms.length) {
    count.textContent = 'Tapez un mot-clé dans la barre de recherche (ex. « freekill », « braquage »).';
    results.innerHTML = '';
    return;
  }
  const v = visible();
  const nums = numbering(v);
  const matches = (...fields) => terms.every(t => fields.some(f => norm(f).includes(t)));
  const where = catId => ancestors(v, catId).map(c => c.title).join(' › ');
  // Les termes saisis sont surlignés tels quels (accents compris) : on surligne la saisie brute.
  const rawTerms = q.split(/\s+/).filter(Boolean);

  const cats = v.categories.filter(c => matches(c.title, c.description));
  const arts = v.articles
    .map(a => ({ a, text: textOf(a.content) }))
    .filter(({ a, text }) => matches(a.title, text))
    .sort((x, y) => (matches(y.a.title) - matches(x.a.title)));

  const total = cats.length + arts.length;
  count.textContent = total ? `${total} résultat${total > 1 ? 's' : ''} pour « ${q} »` : `Aucun résultat pour « ${q} ».`;
  results.innerHTML = [
    ...cats.map(c => `<a class="result" href="#/c/${c.id}">
      <span class="where">Catégorie ${nums.cat.get(c.id)}</span>
      <h3>${highlight(c.title, rawTerms)}</h3>${c.description ? `<p>${highlight(c.description, rawTerms)}</p>` : ''}</a>`),
    ...arts.map(({ a, text }) => `<a class="result" href="#/c/${a.categoryId}/${a.id}">
      <span class="where">Article ${nums.art.get(a.id)} · ${esc(where(a.categoryId))}</span>
      <h3>${highlight(a.title, rawTerms)}</h3><p>${highlight(snippet(text, rawTerms[0]), rawTerms)}</p></a>`),
  ].join('');
}

// ---------------------------------------------------------------------------
// Connexion Discord
// ---------------------------------------------------------------------------

const DISCORD_LOGO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.4C.6 9-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.9-9.8-3.6-13.7ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>';

function renderLogin(params) {
  document.title = `Connexion — ${state.data.settings.siteName}`;
  const err = params.get('erreur');
  const id = params.get('id') || '';
  const messages = {
    refuse: `<p><strong>Accès refusé.</strong> Votre compte Discord n'est pas autorisé. Votre demande a été transmise au propriétaire.</p>
      <p>Votre ID Discord : <code class="copy-id" title="Cliquer pour copier">${esc(id)}</code></p>`,
    config: "<p>La connexion Discord n'est pas encore configurée sur le serveur (fichier <code>config.json</code>).</p>",
    discord: '<p>Discord a renvoyé une erreur. Réessayez dans quelques instants.</p>',
    annule: '<p>Connexion annulée ou expirée. Réessayez.</p>',
  };
  app.innerHTML = `<div class="card auth">
    <h1>Connexion staff</h1>
    <p class="hint">Réservé aux personnes autorisées par le propriétaire. Le règlement reste consultable par tous, sans connexion.</p>
    ${err && messages[err] ? `<div class="auth-alert">${messages[err]}</div>` : ''}
    ${state.data.discordReady
      ? `<a class="btn btn-discord btn-lg" href="/auth/discord" style="width:100%">${DISCORD_LOGO} Se connecter avec Discord</a>`
      : '<p class="error-msg">Connexion Discord non configurée sur le serveur (variables DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET et OWNER_DISCORD_ID).</p>'}
    <ol class="auth-steps">
      <li>Cliquez sur <strong>« Se connecter avec Discord »</strong> et acceptez.</li>
      <li>Si vous êtes autorisé, vous arrivez directement dans l'administration.</li>
      <li>Sinon, votre demande est envoyée au propriétaire : il pourra vous donner l'accès.</li>
    </ol>
  </div>`;
  const copy = $('.copy-id');
  if (copy) copy.onclick = () => navigator.clipboard.writeText(id).then(() => toast('ID copié.'));
}

// ---------------------------------------------------------------------------
// Administration — organisation du règlement
// ---------------------------------------------------------------------------

function adminHeader(active, extra = '') {
  const tab = (href, key, label) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  return `<div class="admin-head"><h1>Administration</h1><span class="spacer"></span>${extra}</div>
    <nav class="tabs">${can('edit') || can('publish') ? tab('#/admin', 'tree', 'Règlement') : ''}${can('appearance') ? tab('#/admin/apparence', 'look', 'Apparence') : ''}${me().owner ? tab('#/admin/acces', 'access', 'Accès') : ''}</nav>`;
}

const statusBadge = (published, hiddenByParent) =>
  published ? (hiddenByParent ? '<span class="badge badge-hidden" title="Publié, mais masqué car une catégorie parente est en brouillon">Masqué</span>' : '<span class="badge badge-live">Publié</span>')
    : '<span class="badge badge-draft">Brouillon</span>';

function renderAdminTree() {
  document.title = `Administration — ${state.data.settings.siteName}`;
  const v = { categories: state.data.categories, articles: state.data.articles };
  const nums = numbering(v);
  const canEdit = can('edit'), canPublish = can('publish');
  const byId = new Map(v.categories.map(c => [c.id, c]));
  const parentHidden = c => !!c.parentId && (() => { const p = byId.get(c.parentId); return !p.published || parentHidden(p); })();

  const catHtml = (c, i, siblings) => {
    const arts = catArticles(v, c.id);
    const subs = childCats(v, c.id);
    const hidden = parentHidden(c);
    return `<li class="adm-cat">
      <div class="adm-row">
        <span class="n">${nums.cat.get(c.id)}</span>
        <div class="title"><strong>${esc(c.title)}</strong>${c.description ? `<small>${esc(c.description)}</small>` : ''}</div>
        ${statusBadge(c.published, hidden)}
        <div class="actions">
          ${canEdit ? `<button class="icon-btn" data-act="cat-move" data-dir="-1" data-id="${c.id}" title="Monter" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
          <button class="icon-btn" data-act="cat-move" data-dir="1" data-id="${c.id}" title="Descendre" ${i === siblings.length - 1 ? 'disabled' : ''}>${ICON.down}</button>` : ''}
          ${canEdit ? `<button class="btn btn-sm" data-act="art-new" data-id="${c.id}" title="Ajouter un article dans cette catégorie">${ICON.plus} Article</button>
          <button class="btn btn-sm" data-act="cat-new" data-id="${c.id}" title="Ajouter une sous-catégorie">${ICON.plus} Sous-catégorie</button>` : ''}
          ${canPublish ? `<button class="btn btn-sm ${c.published ? '' : 'btn-primary'}" data-act="cat-toggle" data-id="${c.id}" title="${c.published ? 'Cacher aux joueurs' : 'Rendre visible pour les joueurs'}">${c.published ? `${ICON.eyeOff} Dépublier` : `${ICON.eye} Publier`}</button>` : ''}
          ${canEdit ? `<button class="icon-btn" data-act="cat-edit" data-id="${c.id}" title="Modifier titre, description, emplacement">${ICON.edit}</button>
          <button class="icon-btn danger" data-act="cat-delete" data-id="${c.id}" title="Supprimer">${ICON.trash}</button>` : ''}
        </div>
      </div>
      <ul>${arts.length ? arts.map((a, j) => `<li class="adm-art"><div class="adm-row">
          <span class="n">${nums.art.get(a.id)}</span>
          <div class="title"><strong>${esc(a.title)}</strong></div>
          ${statusBadge(a.published, hidden || !c.published)}
          <div class="actions">
            ${canEdit ? `<button class="icon-btn" data-act="art-move" data-dir="-1" data-id="${a.id}" title="Monter" ${j === 0 ? 'disabled' : ''}>${ICON.up}</button>
            <button class="icon-btn" data-act="art-move" data-dir="1" data-id="${a.id}" title="Descendre" ${j === arts.length - 1 ? 'disabled' : ''}>${ICON.down}</button>` : ''}
            ${canPublish ? `<button class="btn btn-sm ${a.published ? '' : 'btn-primary'}" data-act="art-toggle" data-id="${a.id}" title="${a.published ? 'Cacher aux joueurs' : 'Rendre visible pour les joueurs'}">${a.published ? 'Dépublier' : 'Publier'}</button>` : ''}
            ${canEdit ? `<a class="btn btn-sm" href="#/admin/article/${a.id}" title="Ouvrir l'éditeur">${ICON.edit} Modifier</a>
            <button class="icon-btn danger" data-act="art-delete" data-id="${a.id}" title="Supprimer">${ICON.trash}</button>` : ''}
          </div></div></li>`).join('')
        : '<li class="adm-empty">Aucun article.</li>'}</ul>
      <ul class="adm-children">${subs.map(catHtml).join('')}</ul>
    </li>`;
  };

  const tops = childCats(v, null);
  const drafts = v.categories.filter(c => !c.published).length + v.articles.filter(a => !a.published).length;
  app.innerHTML = `${adminHeader('tree', canEdit ? `<button class="btn btn-primary" data-act="cat-new">${ICON.plus} Nouvelle catégorie</button>` : '')}
    <div class="adm-stats">
      <div><strong>${v.categories.length}</strong><span>catégorie${v.categories.length > 1 ? 's' : ''}</span></div>
      <div><strong>${v.articles.length}</strong><span>article${v.articles.length > 1 ? 's' : ''}</span></div>
      <div class="${drafts ? 'is-warn' : ''}"><strong>${drafts}</strong><span>brouillon${drafts > 1 ? 's' : ''} (invisible${drafts > 1 ? 's' : ''} pour les joueurs)</span></div>
    </div>
    <details class="help-box" ${tops.length ? '' : 'open'}>
      <summary>❓ Comment modifier le règlement ? (guide rapide)</summary>
      <ol class="help-steps">
        ${canEdit ? `<li><strong>Créez une catégorie</strong> avec le bouton « Nouvelle catégorie » (ex. « Règles générales », « Roleplay »).</li>
        <li><strong>Ajoutez des articles</strong> avec le bouton « + Article » de la catégorie. Un article = une règle.</li>` : ''}
        ${canPublish ? `<li><strong>Publiez</strong> : tout ce qui est en <span class="badge badge-draft">Brouillon</span> est invisible pour les joueurs. Cliquez sur « Publier » quand c'est prêt.</li>`
          : '<li>Vous ne pouvez pas publier : une personne ayant l\'accès « Publier » rendra vos articles visibles.</li>'}
        <li><strong>Vérifiez</strong> en cochant « Voir comme un joueur » dans la barre en haut : vous voyez le site exactement comme eux.</li>
      </ol>
      <div class="help-legend">
        <span><span class="badge badge-live">Publié</span> visible par tous</span>
        <span><span class="badge badge-draft">Brouillon</span> visible uniquement par le staff</span>
        <span><span class="badge badge-hidden">Masqué</span> publié, mais sa catégorie est en brouillon</span>
        ${canEdit ? `<span>${ICON.up}${ICON.down} changer l'ordre (les numéros se mettent à jour tout seuls)</span>
        <span>${ICON.edit} modifier · ${ICON.trash} supprimer</span>` : ''}
      </div>
    </details>
    ${tops.length ? `<ul class="adm-tree">${tops.map(catHtml).join('')}</ul>` : '<div class="empty">Aucune catégorie. Commencez par en créer une avec le bouton « Nouvelle catégorie ».</div>'}`;

  app.onclick = async e => {
    const b = e.target.closest('[data-act]');
    if (!b || !app.contains(b)) return;
    const { act, id } = b.dataset;
    const dir = Number(b.dataset.dir);
    try {
      if (act === 'cat-new') return categoryModal(null, id || null);
      if (act === 'cat-edit') return categoryModal(byId.get(id));
      if (act === 'art-new') { location.hash = `#/admin/article/new?cat=${id}`; return; }
      if (act === 'cat-toggle') {
        const c = byId.get(id);
        await attempt(() => api('PUT', `/api/categories/${id}`, { published: !c.published }), c.published ? 'Catégorie dépubliée.' : 'Catégorie publiée.');
      }
      if (act === 'art-toggle') {
        const a = v.articles.find(x => x.id === id);
        await attempt(() => api('PUT', `/api/articles/${id}`, { published: !a.published }), a.published ? 'Article dépublié.' : 'Article publié.');
      }
      if (act === 'cat-move') {
        const c = byId.get(id);
        await reorder('categories', childCats(v, c.parentId || null), id, dir);
      }
      if (act === 'art-move') {
        const a = v.articles.find(x => x.id === id);
        await reorder('articles', catArticles(v, a.categoryId), id, dir);
      }
      if (act === 'cat-delete') {
        const c = byId.get(id);
        const n = countArticlesDeep(v, id);
        const subs = childCats(v, id).length;
        const ok = await confirmBox('Supprimer la catégorie ?',
          `« ${esc(c.title)} » sera supprimée définitivement${n || subs ? `, avec <strong>${n} article${n > 1 ? 's' : ''}</strong>${subs ? ` et ses sous-catégories` : ''}` : ''}.`);
        if (!ok) return;
        await attempt(() => api('DELETE', `/api/categories/${id}`), 'Catégorie supprimée.');
      }
      if (act === 'art-delete') {
        const a = v.articles.find(x => x.id === id);
        if (!(await confirmBox("Supprimer l'article ?", `« ${esc(a.title)} » sera supprimé définitivement.`))) return;
        await attempt(() => api('DELETE', `/api/articles/${id}`), 'Article supprimé.');
      }
      await loadData();
      renderAdminTree();
    } catch { /* déjà signalé par toast */ }
  };
}

async function reorder(kind, list, id, dir) {
  const ids = list.map(x => x.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await attempt(() => api('POST', `/api/${kind}/reorder`, { ids }));
}

function categoryOptions(selectedId, excludeId, { allowRoot = true } = {}) {
  const v = { categories: state.data.categories, articles: [] };
  const nums = numbering(v);
  const out = allowRoot ? [`<option value="">— Aucune (catégorie principale) —</option>`] : [];
  const walk = (parentId, depth) => childCats(v, parentId).forEach(c => {
    if (c.id === excludeId) return; // exclut la catégorie et toute sa descendance
    out.push(`<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${'   '.repeat(depth)}${nums.cat.get(c.id)}. ${esc(c.title)}</option>`);
    walk(c.id, depth + 1);
  });
  walk(null, 0);
  return out.join('');
}

function categoryModal(cat, parentId = null) {
  const isNew = !cat;
  modal(isNew ? (parentId ? 'Nouvelle sous-catégorie' : 'Nouvelle catégorie') : 'Modifier la catégorie', `
    <label class="field"><span>Titre</span><input type="text" name="title" maxlength="120" required value="${esc(cat ? cat.title : '')}"></label>
    <label class="field"><span>Description</span><textarea name="description" maxlength="500" rows="3">${esc(cat ? cat.description : '')}</textarea></label>
    <label class="field"><span>Catégorie parente</span><select name="parentId">${categoryOptions(cat ? cat.parentId : parentId, cat && cat.id)}</select></label>
    ${can('publish') ? `<label class="toggle"><input type="checkbox" name="published" ${cat && cat.published ? 'checked' : ''}> Publiée (visible par tous)</label>` : ''}`,
  {
    submitLabel: isNew ? 'Créer' : 'Enregistrer',
    onSubmit: async f => {
      const body = { title: f.get('title'), description: f.get('description'), parentId: f.get('parentId') || null };
      if (can('publish')) body.published = f.get('published') === 'on';
      if (isNew) {
        await api('POST', '/api/categories', body);
        toast('Catégorie créée.');
      } else {
        await api('PUT', `/api/categories/${cat.id}`, body);
        toast('Catégorie mise à jour.');
      }
      await loadData();
      render();
    },
  });
}

// ---------------------------------------------------------------------------
// Administration — éditeur d'article
// ---------------------------------------------------------------------------

const TOOLBAR = [
  ['bold', '<b>G</b>', 'Gras (Ctrl+B)'], ['italic', '<i>I</i>', 'Italique (Ctrl+I)'], ['underline', '<u>S</u>', 'Souligné (Ctrl+U)'], ['strikeThrough', '<s>B</s>', 'Barré'],
  '|', ['h2', 'Titre', 'Gros titre'], ['h3', 'Sous-titre', 'Petit titre'], ['p', 'Texte', 'Paragraphe normal'],
  '|', ['insertUnorderedList', '• Liste', 'Liste à puces'], ['insertOrderedList', '1. Liste', 'Liste numérotée'], ['blockquote', '❝', 'Citation'],
  '|', ['callout-info', 'ℹ Info', 'Encadré information'], ['callout-warn', '⚠ Important', 'Encadré important'], ['callout-danger', '⛔ Sanction', 'Encadré sanction'],
  '|', ['link', '🔗', 'Insérer un lien'], ['image', '🖼 Image', 'Insérer une image'], ['insertHorizontalRule', '―', 'Séparateur'],
  '|', ['removeFormat', '⌫', 'Effacer la mise en forme'], ['undo', '↶', 'Annuler (Ctrl+Z)'], ['redo', '↷', 'Rétablir (Ctrl+Y)'],
];

function renderEditor(id, catParam) {
  const isNew = id === 'new';
  const existing = isNew ? null : state.data.articles.find(a => a.id === id);
  if (!isNew && !existing) return renderNotFound();
  const draft = existing
    ? { ...existing }
    : { id: null, title: '', content: '', published: false, categoryId: catParam || (childCats(state.data, null)[0] || {}).id };
  if (!draft.categoryId) {
    app.innerHTML = `<div class="empty">Créez d'abord une catégorie pour pouvoir ajouter des articles. <a href="#/admin">Organiser le règlement</a></div>`;
    return;
  }
  let previewing = false;
  document.title = `${isNew ? 'Nouvel article' : draft.title} — Éditeur`;

  app.innerHTML = `
    <nav class="crumbs"><a href="#/admin">Administration</a> › ${isNew ? 'Nouvel article' : 'Modifier un article'}</nav>
    <div class="editor-wrap">
      <div>
        <div id="edit-pane">
          <input type="text" class="editor-title" id="ed-title" placeholder="Titre de l'article" maxlength="160" value="${esc(draft.title)}">
          <div class="toolbar" id="ed-toolbar">${TOOLBAR.map(t => t === '|' ? '<span class="sep"></span>'
            : `<button type="button" data-cmd="${t[0]}" title="${esc(t[2])}">${t[1]}</button>`).join('')}</div>
          <div class="editor prose" id="ed-body" contenteditable="true" data-placeholder="Rédigez le contenu de l'article…">${sanitize(draft.content)}</div>
        </div>
        <div id="preview-pane" hidden></div>
      </div>
      <aside>
        <div class="side-card">
          <h4>Publication</h4>
          <div class="status-line" id="ed-status"></div>
          <button class="btn" id="ed-preview">${ICON.eye} Prévisualiser</button>
          <button class="btn" id="ed-save">Enregistrer</button>
          <button class="btn btn-primary" id="ed-publish"></button>
          ${can('publish') ? '' : '<p class="hint">Vous pouvez enregistrer, mais pas publier : une personne ayant l\'accès « Publier » s\'en chargera.</p>'}
          <p class="warn-note" id="ed-warn" hidden></p>
        </div>
        <div class="side-card">
          <h4>Emplacement</h4>
          <label class="field" style="margin:0"><span>Catégorie</span><select id="ed-cat">${categoryOptions(draft.categoryId, null, { allowRoot: false })}</select></label>
        </div>
        <details class="side-card help-card" open>
          <summary><h4>Aide à la rédaction</h4></summary>
          <ul>
            <li><strong>Une règle = un article</strong>, avec un titre court et clair (ex. « Freekill »).</li>
            <li>Mettez les mots importants en <b>gras</b> (sélectionnez le texte puis <b>G</b>).</li>
            <li><b>⛔ Sanction</b> : indiquez la punition prévue (ex. « avertissement puis ban 24 h »).</li>
            <li><b>⚠ Important</b> : un point à ne pas rater. <b>ℹ Info</b> : un conseil ou un exemple.</li>
            <li>Image : bouton 🖼, ou glissez / collez une image directement dans le texte.</li>
            <li><b>Ctrl + S</b> enregistre. « Prévisualiser » montre le rendu pour les joueurs.</li>
            <li>Les numéros (Article 2.1.3) sont calculés automatiquement.</li>
          </ul>
        </details>
        ${isNew ? '' : `<div class="side-card"><h4>Zone de danger</h4><button class="btn btn-danger" id="ed-delete">${ICON.trash} Supprimer l'article</button></div>`}
      </aside>
    </div>`;

  const title = $('#ed-title'), body = $('#ed-body'), catSel = $('#ed-cat');
  document.execCommand('defaultParagraphSeparator', false, 'p');
  if (!body.innerHTML.trim()) body.innerHTML = '';
  (isNew ? title : body).focus();

  const markDirty = () => { state.dirty = true; refreshStatus(); };
  title.addEventListener('input', markDirty);
  body.addEventListener('input', markDirty);
  catSel.addEventListener('change', markDirty);

  function refreshStatus() {
    $('#ed-status').innerHTML = `${draft.published ? '<span class="badge badge-live">Publié</span>' : '<span class="badge badge-draft">Brouillon</span>'}
      ${state.dirty ? '<span class="dirty-dot">● Non enregistré</span>' : (draft.id ? '<span class="hint">Enregistré</span>' : '')}`;
    $('#ed-publish').textContent = draft.published ? (state.dirty ? 'Enregistrer et garder publié' : 'Dépublier') : 'Publier';
    $('#ed-publish').className = `btn ${draft.published && !state.dirty ? '' : 'btn-primary'}`;
    $('#ed-publish').hidden = !can('publish');
    $('#ed-save').textContent = draft.published ? 'Enregistrer' : 'Enregistrer le brouillon';
    $('#ed-save').disabled = !state.dirty && !!draft.id;
    // Avertit si l'article publié reste invisible à cause d'une catégorie en brouillon.
    const cats = state.data.categories;
    const hidden = (cid) => { const c = cats.find(x => x.id === cid); return !c || !c.published || (c.parentId && hidden(c.parentId)); };
    const warn = $('#ed-warn');
    warn.hidden = !hidden(catSel.value);
    warn.textContent = 'La catégorie (ou une catégorie parente) est en brouillon : cet article restera invisible pour les joueurs tant qu\'elle n\'est pas publiée.';
  }
  refreshStatus();

  async function save(published) {
    const payload = { title: title.value.trim() || 'Sans titre', content: sanitize(body.innerHTML), categoryId: catSel.value, published };
    const saved = await attempt(() => draft.id ? api('PUT', `/api/articles/${draft.id}`, payload) : api('POST', '/api/articles', payload),
      published && !draft.published ? 'Article publié.' : !published && draft.published ? 'Article dépublié.' : 'Article enregistré.');
    Object.assign(draft, saved);
    state.dirty = false;
    await loadData();
    if (isNew) {
      history.replaceState(null, '', `#/admin/article/${saved.id}`);
      state.lastHash = location.hash;
    }
    refreshStatus();
  }

  $('#ed-save').onclick = () => save(draft.published).catch(() => {});
  $('#ed-publish').onclick = () => save(draft.published ? state.dirty : true).catch(() => {});
  if (!isNew) $('#ed-delete').onclick = async () => {
    if (!(await confirmBox("Supprimer l'article ?", `« ${esc(draft.title)} » sera supprimé définitivement.`))) return;
    await attempt(() => api('DELETE', `/api/articles/${draft.id}`), 'Article supprimé.').catch(() => {});
    state.dirty = false;
    await loadData();
    location.hash = '#/admin';
  };

  $('#ed-preview').onclick = () => {
    previewing = !previewing;
    $('#edit-pane').hidden = previewing;
    $('#preview-pane').hidden = !previewing;
    $('#ed-preview').innerHTML = previewing ? `${ICON.edit} Retour à l'édition` : `${ICON.eye} Prévisualiser`;
    if (!previewing) return body.focus();
    // Simule la numérotation qu'aura l'article une fois publié, dans sa catégorie.
    const v = { categories: state.data.categories, articles: state.data.articles };
    const nums = numbering(v);
    const list = catArticles(v, catSel.value);
    const idx = list.findIndex(a => a.id === draft.id);
    const pos = (idx >= 0 ? idx : list.length) + 1;
    const fake = { ...draft, title: title.value.trim() || 'Sans titre', content: body.innerHTML, categoryId: catSel.value, published: true };
    const crumb = ancestors(v, catSel.value).map(c => esc(c.title)).join(' › ');
    $('#preview-pane').innerHTML = `<div class="preview-banner">${ICON.eye}<span><strong>Aperçu</strong> — voici comment les joueurs verront cet article une fois publié.</span></div>
      <nav class="crumbs">Accueil › ${crumb}</nav>${articleHtml(fake, `${nums.cat.get(catSel.value)}.${pos}`, true)}`;
  };

  // Barre d'outils
  const toolbar = $('#ed-toolbar');
  toolbar.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  toolbar.addEventListener('click', async e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    body.focus();
    if (cmd === 'h2' || cmd === 'h3' || cmd === 'p' || cmd === 'blockquote') document.execCommand('formatBlock', false, cmd);
    else if (cmd.startsWith('callout-')) {
      const label = { 'callout-info': 'Information', 'callout-warn': 'Important', 'callout-danger': 'Sanction' }[cmd];
      const sel = window.getSelection().toString();
      document.execCommand('insertHTML', false, `<div class="callout ${cmd}"><p><strong>${label} :</strong> ${esc(sel) || '…'}</p></div><p><br></p>`);
    } else if (cmd === 'link') {
      const url = prompt('Adresse du lien (https://…) :', 'https://');
      if (url && /^(https?:|mailto:|#)/i.test(url.trim())) document.execCommand('createLink', false, url.trim());
      else if (url) toast('Lien invalide : il doit commencer par https://', true);
    } else if (cmd === 'image') {
      const sel = saveSelection();
      const file = await pickImage();
      if (!file) return;
      try {
        const { url } = await attempt(() => uploadImage(file), 'Image ajoutée.');
        restoreSelection(sel);
        document.execCommand('insertHTML', false, `<img src="${esc(url)}" alt="">`);
      } catch { /* toast déjà affiché */ }
    } else document.execCommand(cmd, false, null);
    markDirty();
    updateToolbarState();
  });

  const updateToolbarState = () => {
    for (const b of $$('button', toolbar)) {
      const cmd = b.dataset.cmd;
      if (['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].includes(cmd)) {
        try { b.classList.toggle('on', document.queryCommandState(cmd)); } catch { /* ignoré */ }
      }
    }
  };
  const onSel = () => {
    if (!body.isConnected) return document.removeEventListener('selectionchange', onSel);
    if (document.activeElement === body) updateToolbarState();
  };
  document.addEventListener('selectionchange', onSel);

  // Collage : on nettoie le HTML pour éviter d'importer styles et scripts.
  body.addEventListener('paste', e => {
    const file = [...(e.clipboardData.files || [])].find(f => f.type.startsWith('image/'));
    e.preventDefault();
    if (file) {
      attempt(() => uploadImage(file), 'Image ajoutée.').then(({ url }) => { document.execCommand('insertHTML', false, `<img src="${esc(url)}" alt="">`); markDirty(); }).catch(() => {});
      return;
    }
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertHTML', false, html ? sanitize(html) : esc(text).replace(/\n/g, '<br>'));
  });

  // Glisser-déposer d'images
  body.addEventListener('drop', e => {
    const file = [...(e.dataTransfer.files || [])].find(f => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    attempt(() => uploadImage(file), 'Image ajoutée.').then(({ url }) => { body.focus(); document.execCommand('insertHTML', false, `<img src="${esc(url)}" alt="">`); markDirty(); }).catch(() => {});
  });

  // Suppression d'une image : clic pour la sélectionner puis Suppr.
  body.addEventListener('click', e => {
    $$('img.selected', body).forEach(i => i.classList.remove('selected'));
    if (e.target.tagName === 'IMG') {
      e.target.classList.add('selected');
      const r = document.createRange(); r.selectNode(e.target);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    }
  });

  // Ctrl+S pour enregistrer
  app.onkeydown = e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(draft.published).catch(() => {}); }
  };
}

function saveSelection() {
  const s = window.getSelection();
  return s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
}
function restoreSelection(range) {
  $('#ed-body').focus();
  if (!range) return;
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
}

// ---------------------------------------------------------------------------
// Administration — apparence
// ---------------------------------------------------------------------------

const DEFAULT_COLORS = { accent: '#e11d48', background: '#0b0b10', surface: '#15151d', text: '#ececf1' };
const COLOR_LABELS = {
  accent: ['Couleur principale', 'Boutons, liens, numéros'],
  background: ['Fond', 'Arrière-plan du site'],
  surface: ['Cartes', 'Fond des articles et panneaux'],
  text: ['Texte', 'Couleur du texte'],
};

function renderAppearance() {
  document.title = `Apparence — ${state.data.settings.siteName}`;
  const s = structuredClone(state.data.settings);
  app.innerHTML = `${adminHeader('look')}
    <div class="grid-2">
      <form class="card" id="look-form">
        <label class="field"><span>Nom du serveur</span><input type="text" name="siteName" maxlength="60" value="${esc(s.siteName)}" required></label>
        <label class="field"><span>Sous-titre (page d'accueil)</span><input type="text" name="tagline" maxlength="160" value="${esc(s.tagline)}"></label>
        <span class="hint" style="display:block;font-weight:600;margin-bottom:8px">Logo</span>
        <div class="logo-box">
          <div class="logo-preview" id="logo-prev"></div>
          <div><button type="button" class="btn btn-sm" id="logo-up">Importer un logo</button>
          <button type="button" class="btn btn-sm btn-danger" id="logo-rm">Retirer</button>
          <p class="hint" style="margin:6px 0 0">PNG transparent conseillé, 5 Mo max.</p></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:20px">
          <button class="btn btn-primary">Enregistrer</button>
          <button type="button" class="btn" id="look-reset">Couleurs par défaut</button>
        </div>
      </form>
      <div class="card">
        <span class="hint" style="display:block;font-weight:600;margin-bottom:14px">Couleurs — aperçu en direct</span>
        ${Object.entries(COLOR_LABELS).map(([k, [l, d]]) => `<div class="color-row">
          <input type="color" data-color="${k}" value="${s.colors[k]}" aria-label="${l}">
          <span class="lbl"><strong>${l}</strong><small>${d}</small></span><code data-code="${k}">${s.colors[k]}</code></div>`).join('')}
        <p class="hint">Les couleurs s'appliquent immédiatement à cette page pour prévisualiser ; cliquez sur « Enregistrer » pour les appliquer à tous.</p>
      </div>
    </div>`;

  const drawLogo = () => { $('#logo-prev').innerHTML = s.logo ? `<img src="${esc(s.logo)}" alt="">` : '<span class="hint">Aucun</span>'; $('#logo-rm').hidden = !s.logo; };
  drawLogo();
  const preview = () => applyTheme(s);
  let saved = false;

  $$('[data-color]').forEach(inp => inp.addEventListener('input', () => {
    s.colors[inp.dataset.color] = inp.value;
    $(`[data-code="${inp.dataset.color}"]`).textContent = inp.value;
    preview();
  }));
  $('#look-reset').onclick = () => {
    Object.assign(s.colors, DEFAULT_COLORS);
    $$('[data-color]').forEach(inp => { inp.value = s.colors[inp.dataset.color]; $(`[data-code="${inp.dataset.color}"]`).textContent = inp.value; });
    preview();
  };
  $('#logo-up').onclick = async () => {
    const file = await pickImage();
    if (!file) return;
    try { s.logo = (await attempt(() => uploadImage(file))).url; drawLogo(); preview(); } catch { /* toast */ }
  };
  $('#logo-rm').onclick = () => { s.logo = null; drawLogo(); preview(); };
  $('#look-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await attempt(() => api('PUT', '/api/settings', { siteName: f.get('siteName'), tagline: f.get('tagline'), logo: s.logo, colors: s.colors }), 'Apparence enregistrée.');
      saved = true;
      await loadData();
      render();
    } catch { /* toast */ }
  };
  // Quitter sans enregistrer : on remet le thème réellement en vigueur.
  const restore = () => { if (!saved) applyTheme(); window.removeEventListener('hashchange', restore); };
  window.addEventListener('hashchange', restore);
}

// ---------------------------------------------------------------------------
// Administration — accès (propriétaire uniquement)
// ---------------------------------------------------------------------------

async function renderAccess() {
  document.title = `Accès — ${state.data.settings.siteName}`;
  app.innerHTML = `${adminHeader('access')}<div class="loading">Chargement…</div>`;
  let data;
  try { data = await api('GET', '/api/access'); } catch (e) { toast(e.message, true); return; }
  if (!location.hash.startsWith('#/admin/acces')) return;
  const date = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const permBoxes = (perms, attrs = '') => Object.entries(PERM_LABELS).map(([k, [label, desc]]) =>
    `<label class="toggle" title="${esc(desc)}"><input type="checkbox" data-perm="${k}" ${attrs} ${perms[k] ? 'checked' : ''}> ${label}</label>`).join('');
  const who = u => `<img class="avatar-img" src="${avatarUrl(u)}" alt="">
    <span class="who"><strong>${esc(u.username || u.note || 'Pas encore connecté')}</strong><small>ID ${esc(u.id)}${u.note && u.username !== u.note ? ` · ${esc(u.note)}` : ''}${u.addedAt ? ` · ajouté le ${date(u.addedAt)}` : u.at ? ` · demande du ${date(u.at)}` : ''}</small></span>`;

  app.innerHTML = `${adminHeader('access')}
    <p class="hint" style="margin-top:-8px">Vous êtes le propriétaire : vous avez tous les accès, et vous seul décidez qui peut se connecter et ce que chacun peut faire. Le règlement publié reste lisible par tout le monde sans connexion.</p>
    ${data.requests.length ? `<div class="card" style="margin-bottom:24px">
      <span class="hint" style="display:block;font-weight:600;margin-bottom:8px">Demandes d'accès (${data.requests.length})</span>
      <ul class="user-list">${data.requests.map(r => `<li>${who(r)}
        <button class="btn btn-sm btn-primary" data-approve="${r.id}">Autoriser</button>
        <button class="icon-btn danger" data-ignore="${r.id}" title="Ignorer la demande">${ICON.trash}</button></li>`).join('')}</ul>
      <p class="hint">Ces personnes ont essayé de se connecter. « Autoriser » leur donne l'accès « Modifier le règlement » ; ajustez ensuite si besoin.</p>
    </div>` : ''}
    <div class="grid-2">
      <div class="card">
        <span class="hint" style="display:block;font-weight:600;margin-bottom:8px">Personnes autorisées (${data.access.length})</span>
        ${data.access.length ? `<ul class="user-list">${data.access.map(a => `<li class="access-row">
          <div class="access-top">${who(a)}
            <button class="icon-btn danger" data-remove="${a.id}" data-name="${esc(a.username || a.note || a.id)}" title="Retirer l'accès">${ICON.trash}</button></div>
          <div class="perms">${permBoxes(a.perms, `data-for="${a.id}"`)}</div></li>`).join('')}</ul>`
          : '<p class="hint">Personne pour le moment. Ajoutez quelqu\'un avec son ID Discord, ou attendez qu\'il tente de se connecter.</p>'}
      </div>
      <form class="card" id="add-access">
        <span class="hint" style="display:block;font-weight:600;margin-bottom:14px">Donner un accès</span>
        <label class="field"><span>ID Discord</span><input type="text" name="id" required pattern="\\d{17,20}" inputmode="numeric" placeholder="ex. 123456789012345678" autocomplete="off"></label>
        <label class="field"><span>Note (facultatif)</span><input type="text" name="note" maxlength="60" placeholder="ex. Modérateur"></label>
        <div class="perms" style="margin-bottom:16px">${permBoxes({ edit: true })}</div>
        <button class="btn btn-primary">${ICON.plus} Donner l'accès</button>
        <p class="hint" style="margin-top:12px">Pour copier un ID : Discord › Paramètres › Avancés › Mode développeur, puis clic droit sur la personne › « Copier l'identifiant ».${data.botLookup ? '' : ' Ajoutez le token du bot dans config.json pour afficher automatiquement pseudo et avatar.'}</p>
      </form>
    </div>`;

  const readPerms = root => Object.fromEntries($$('[data-perm]', root).map(i => [i.dataset.perm, i.checked]));
  $('#add-access').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await attempt(() => api('POST', '/api/access', { id: f.get('id').trim(), note: f.get('note'), perms: readPerms(e.target) }), 'Accès accordé.'); renderAccess(); } catch { /* toast */ }
  };
  // Les cases s'enregistrent dès qu'on les coche.
  $$('[data-for]').forEach(box => box.onchange = async () => {
    try { await attempt(() => api('PUT', `/api/access/${box.dataset.for}`, { perms: readPerms(box.closest('.access-row')) }), 'Accès mis à jour.'); }
    catch { box.checked = !box.checked; }
  });
  app.onclick = async e => {
    const t = e.target.closest('[data-approve],[data-ignore],[data-remove]');
    if (!t) return;
    try {
      if (t.dataset.approve) await attempt(() => api('POST', '/api/access', { id: t.dataset.approve, perms: { edit: true } }), 'Accès accordé.');
      if (t.dataset.ignore) await attempt(() => api('DELETE', `/api/requests/${t.dataset.ignore}`), 'Demande ignorée.');
      if (t.dataset.remove) {
        if (!(await confirmBox("Retirer l'accès ?", `<strong>${esc(t.dataset.name)}</strong> sera déconnecté immédiatement et ne pourra plus se connecter.`, 'Retirer'))) return;
        await attempt(() => api('DELETE', `/api/access/${t.dataset.remove}`), 'Accès retiré.');
      }
      renderAccess();
    } catch { /* toast */ }
  };
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

// Bouton « remonter en haut », affiché après un peu de défilement.
const toTop = Object.assign(document.createElement('button'), { className: 'to-top', title: 'Remonter en haut', innerHTML: ICON.up });
toTop.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
document.body.append(toTop);
window.addEventListener('scroll', () => toTop.classList.toggle('show', window.scrollY > 600), { passive: true });

(async () => {
  try {
    await loadData();
    render();
  } catch (e) {
    app.innerHTML = `<div class="empty">Impossible de charger le règlement : ${esc(e.message)}</div>`;
  }
})();
