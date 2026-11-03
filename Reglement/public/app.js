// RedSide V5 — interface du règlement : lecture façon documentation + mode édition par blocs
'use strict';

// ---------------------------------------------------------------------------
// État & utilitaires
// ---------------------------------------------------------------------------

// localStorage peut être indisponible (navigation privée…) : on ne s'en sert que pour du confort.
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignoré */ } },
};

const state = {
  data: null,                                // réponse de /api/data
  editing: store.get('rs_editing', false),   // mode édition (accès « Modifier »)
  dirty: false,                              // modifications non enregistrées dans l'éditeur
  lastHash: location.hash,
  open: new Set(store.get('rs_open', [])),   // pages dépliées dans la sidebar
  heads: [],                                 // titres H2/H3 de la page affichée
  focusTitle: false,                         // nouvelle page : on sélectionne le titre
};
let editor = null; // éditeur actif (null hors du mode édition)

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const main = $('#main'), sidebar = $('#sidebar'), toc = $('#toc'), topbar = $('#topbar');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const textOf = html => new DOMParser().parseFromString(html || '', 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
const fmtDate = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtTime = t => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const byOrder = (a, b) => a.order - b.order;

const me = () => state.data && state.data.user;
const loggedIn = () => !!me();
const can = perm => loggedIn() && (me().owner || !!me().perms[perm]);

const avatarUrl = u => u.avatar
  ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
  : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;

const svg = (d, size = 16, w = 2.2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  chev: svg('<path d="m6 9 6 6 6-6"/>', 14, 2.4),
  chevR: svg('<path d="m9 6 6 6-6 6"/>', 14, 2.4),
  left: svg('<path d="m15 18-6-6 6-6"/>', 18),
  right: svg('<path d="m9 18 6-6-6-6"/>', 18),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>', 20),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 14, 2.4),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>', 14),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', 14),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 14),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>', 14),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 14),
  folder: svg('<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>', 14),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>', 14),
  up: svg('<path d="m18 15-6-6-6 6"/>', 14, 2.4),
  down: svg('<path d="m6 9 6 6 6-6"/>', 14, 2.4),
  dots: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', 16, 3),
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
  if (state.editing && !can('edit')) setEditing(false);
  applyBrand();
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

function setEditing(on) {
  state.editing = on;
  store.set('rs_editing', on);
}

// ---------------------------------------------------------------------------
// Modèle : ce que voit l'utilisateur courant
// ---------------------------------------------------------------------------
// En lecture : la version publiée, comme un joueur. En mode édition : les brouillons.

const pageStatus = raw => !raw.live ? 'draft' : JSON.stringify(raw.live) !== JSON.stringify(raw.draft) ? 'changed' : 'live';
const STATUS = { draft: 'Brouillon — jamais publié', changed: 'Modifications non publiées', live: 'Publié' };

function model() {
  const all = state.data.pages;
  const rawById = new Map(all.map(p => [p.id, p]));
  let list;
  if (state.editing) {
    list = all.map(p => ({ ...p.draft, id: p.id, categoryId: p.categoryId, parentId: p.parentId, order: p.order, updatedAt: p.updatedAt, raw: p }));
  } else {
    const ok = p => p && p.live && (!p.parentId || ok(rawById.get(p.parentId)));
    list = all.filter(ok).map(p => ({ ...p.live, id: p.id, categoryId: p.categoryId, parentId: p.parentId, order: p.order, updatedAt: p.publishedAt, raw: p }));
  }
  const byId = new Map(list.map(p => [p.id, p]));
  const kids = (catId, parentId) => list.filter(p => p.categoryId === catId && (p.parentId || null) === parentId).sort(byOrder);
  const cats = [...state.data.categories].sort(byOrder).filter(c => state.editing || kids(c.id, null).length);
  // Ordre de lecture (pour « page précédente / suivante » et l'accueil).
  const flat = [];
  const walk = (catId, parentId) => kids(catId, parentId).forEach(p => { flat.push(p); walk(catId, p.id); });
  cats.forEach(c => walk(c.id, null));
  const cat = id => state.data.categories.find(c => c.id === id) || { title: '' };
  const ancestors = id => { const out = []; let p = byId.get(id); while (p && p.parentId) { p = byId.get(p.parentId); if (p) out.unshift(p); } return out; };
  return { list, byId, kids, cats, flat, cat, ancestors };
}

// ---------------------------------------------------------------------------
// Nettoyage HTML (liste blanche) — appliqué à tout contenu affiché ou enregistré
// ---------------------------------------------------------------------------

const ALLOWED = {
  P: [], BR: [], STRONG: [], B: [], EM: [], I: [], U: [], S: [], DEL: [], SPAN: ['class'], CODE: [],
  H2: [], H3: [], UL: [], OL: [], LI: [], BLOCKQUOTE: [], HR: [], DIV: ['class'], A: ['href'], IMG: ['src', 'alt'],
  TABLE: [], THEAD: [], TBODY: [], TR: [], TH: [], TD: [],
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
      if (tag === 'H4' || tag === 'H5' || tag === 'H6') { const h = doc.createElement('h3'); h.append(...child.childNodes); child.replaceWith(h); continue; }
      if (!ALLOWED[tag]) { child.replaceWith(...child.childNodes); continue; }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        const val = attr.value.trim();
        let keep = ALLOWED[tag].includes(name);
        if (keep && name === 'href') keep = /^(https?:|mailto:|#)/i.test(val);
        if (keep && name === 'src') keep = /^(\/uploads\/|https:)/i.test(val);
        if (keep && name === 'class') keep = tag === 'SPAN' ? val === 'hl' : /^callout callout-(info|warn|danger)$/.test(val);
        if (!keep) child.removeAttribute(attr.name);
      }
      if (tag === 'DIV' && !child.hasAttribute('class')) { const p = doc.createElement('p'); p.append(...child.childNodes); child.replaceWith(p); }
      if (tag === 'SPAN' && !child.hasAttribute('class')) { child.replaceWith(...child.childNodes); continue; }
      if (tag === 'A' && /^https?:/i.test(child.getAttribute('href') || '')) { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer'); }
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
}

// ---------------------------------------------------------------------------
// UI commune : notifications, fenêtres, marque
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

function modal(title, bodyHtml, { submitLabel = 'Enregistrer', danger = false, onSubmit, onCancel } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<form class="modal" role="dialog" aria-modal="true">
    <h2>${esc(title)}</h2>${bodyHtml}
    <p class="error-msg" data-err></p>
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel>Annuler</button>
      <button type="submit" class="btn ${danger ? 'btn-danger-solid' : 'btn-accent'}">${esc(submitLabel)}</button>
    </div></form>`;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const cancel = () => { close(); if (onCancel) onCancel(); };
  const onKey = e => { if (e.key === 'Escape') cancel(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) cancel(); });
  $('[data-cancel]', wrap).onclick = cancel;
  wrap.firstElementChild.onsubmit = async e => {
    e.preventDefault();
    const btn = $('button[type=submit]', wrap);
    btn.disabled = true;
    try { await onSubmit(new FormData(e.target), wrap); close(); }
    catch (err) { $('[data-err]', wrap).textContent = err.message; btn.disabled = false; }
  };
  document.body.append(wrap);
  const first = $('input, textarea, select', wrap) || $('button[type=submit]', wrap);
  first.focus();
  if (first.select) first.select();
  return wrap;
}

const confirmBox = (title, text, label = 'Supprimer') => new Promise(resolve => {
  modal(title, `<p>${text}</p>`, { submitLabel: label, danger: true, onSubmit: async () => resolve(true), onCancel: () => resolve(false) });
});

const promptBox = (title, label, value = '', { submitLabel = 'Valider', placeholder = '' } = {}) => new Promise(resolve => {
  modal(title, `<label class="field"><span>${esc(label)}</span><input type="text" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" required></label>`,
    { submitLabel, onSubmit: async f => resolve(String(f.get('v')).trim()), onCancel: () => resolve(null) });
});

const initials = name => (String(name).match(/\b\w/g) || ['R']).slice(0, 2).join('').toUpperCase();
const logoHtml = s => s.logo ? `<img class="brand-logo" src="${esc(s.logo)}" alt="">` : `<span class="brand-mark">${esc(initials(s.siteName))}</span>`;

function applyBrand() {
  const s = state.data.settings;
  $('#favicon').href = s.logo || `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#e5484d"/><text x="16" y="22" font-family="Arial" font-weight="700" font-size="15" text-anchor="middle" fill="#fff">${esc(initials(s.siteName))}</text></svg>`)}`;
}

function closeFloating() {
  $$('.floating').forEach(el => el.remove());
  $$('.nav-dd.open').forEach(d => d.classList.remove('open'));
}

// ---------------------------------------------------------------------------
// Barre du haut
// ---------------------------------------------------------------------------

const isExternal = url => /^https?:\/\//i.test(url);
const linkAttrs = url => `href="${esc(url || '#')}"${isExternal(url) ? ' target="_blank" rel="noopener noreferrer"' : ''}`;
const navItems = () => state.data.settings.nav.filter(n => !(loggedIn() && n.url === '#/connexion'));

function renderTopbar() {
  const s = state.data.settings;
  const items = navItems().map(n => n.children.length
    ? `<div class="nav-dd"><button type="button" class="nav-link" data-dd>${esc(n.label)} ${ICON.chev}</button>
        <div class="dd-menu">${n.url ? `<a ${linkAttrs(n.url)}>${esc(n.label)}</a>` : ''}${n.children.map(c => `<a ${linkAttrs(c.url)}>${esc(c.label)}</a>`).join('')}</div></div>`
    : `<a class="nav-link" ${linkAttrs(n.url)}>${esc(n.label)}</a>`).join('');

  const u = me();
  const userArea = u ? `
    ${can('edit') ? `<button type="button" class="btn btn-sm ${state.editing ? 'btn-accent' : ''}" id="edit-toggle" title="Créer et modifier les pages">${ICON.edit}<span class="hide-sm">${state.editing ? 'Quitter l\'édition' : 'Mode édition'}</span></button>` : ''}
    <div class="nav-dd"><button type="button" class="avatar-btn" data-dd title="${esc(u.username)}"><img src="${avatarUrl(u)}" alt=""></button>
      <div class="dd-menu dd-right">
        <div class="dd-head"><strong>${esc(u.username)}</strong><small>${u.owner ? 'Propriétaire' : 'Staff'}</small></div>
        ${can('edit') ? '<a href="#/admin/historique">Historique des modifications</a>' : ''}
        ${can('settings') ? '<a href="#/admin/reglages">Réglages du site</a>' : ''}
        ${u.owner ? '<a href="#/admin/acces">Accès du staff</a>' : ''}
        <button type="button" id="logout">Déconnexion</button>
      </div></div>` : '';

  topbar.innerHTML = `<div class="topbar-inner">
    <button type="button" class="icon-btn burger" id="burger" aria-label="Ouvrir le menu">${ICON.menu}</button>
    <a class="brand" href="#/">${logoHtml(s)}<span>${esc(s.siteName)}</span></a>
    <nav class="top-nav">${items}</nav>
    <span class="spacer"></span>
    <button type="button" class="search-btn" id="search-btn">${ICON.search}<span>Rechercher...</span><kbd>Ctrl K</kbd></button>
    ${userArea}
  </div>`;

  $('#search-btn').onclick = openSearch;
  $('#burger').onclick = () => document.body.classList.toggle('nav-open');
  if (u) {
    $('#logout').onclick = async () => {
      if (!confirmLeave()) return;
      await api('POST', '/api/logout');
      setEditing(false);
      await loadData();
      location.hash = '#/';
      render();
    };
    const t = $('#edit-toggle');
    if (t) t.onclick = () => {
      if (!confirmLeave()) return;
      setEditing(!state.editing);
      // En quittant l'édition depuis une page admin, on revient au règlement.
      if (!state.editing && location.hash.startsWith('#/admin')) location.hash = '#/';
      render();
    };
  }
}

// Menus déroulants : un clic ouvre/ferme, un clic ailleurs ferme.
document.addEventListener('click', e => {
  const t = e.target.closest('[data-dd]');
  $$('.nav-dd.open').forEach(d => { if (!t || d !== t.parentElement) d.classList.remove('open'); });
  if (t) t.parentElement.classList.toggle('open');
  else if (e.target.closest('.dd-menu a, .dd-menu button')) $$('.nav-dd.open').forEach(d => d.classList.remove('open'));
});

$('#scrim').onclick = () => document.body.classList.remove('nav-open');

// ---------------------------------------------------------------------------
// Sidebar gauche
// ---------------------------------------------------------------------------

const currentPageId = () => { const { parts } = parseRoute(); return parts[0] === 'p' ? parts[1] : null; };

function renderSidebar(M, activeId) {
  const editing = state.editing;
  const s = state.data.settings;

  const item = p => {
    const kids = M.kids(p.categoryId, p.id);
    const open = kids.length && state.open.has(p.id);
    const st = editing ? pageStatus(p.raw) : 'live';
    return `<li data-page="${p.id}" ${editing ? 'draggable="true"' : ''}>
      <div class="side-item ${p.id === activeId ? 'active' : ''}">
        <a href="#/p/${p.id}"><span class="side-ico">${esc(p.icon)}</span><span class="side-t">${esc(p.title)}</span>${st !== 'live' ? `<span class="dot dot-${st}" title="${STATUS[st]}"></span>` : ''}</a>
        ${editing ? `<button type="button" class="side-act" data-add-sub="${p.id}" title="Ajouter une sous-page">${ICON.plus}</button>` : ''}
        ${kids.length ? `<button type="button" class="side-caret ${open ? 'open' : ''}" data-toggle="${p.id}" aria-label="${open ? 'Replier' : 'Déplier'}">${ICON.chevR}</button>` : ''}
      </div>
      ${open ? `<ul>${kids.map(item).join('')}</ul>` : ''}
    </li>`;
  };

  // Sur mobile, les liens du haut sont repris dans le menu burger.
  const mobileNav = navItems().map(n => n.children.length
    ? `<p class="side-mnav-title">${esc(n.label)}</p>${n.children.map(c => `<a ${linkAttrs(c.url)}>${esc(c.label)}</a>`).join('')}`
    : `<a ${linkAttrs(n.url)}>${esc(n.label)}</a>`).join('');

  sidebar.innerHTML = `<div class="side-scroll">
    <nav class="side-mnav">${mobileNav}</nav>
    ${M.cats.map((c, i) => `<section class="side-cat" data-cat="${c.id}">
      <div class="side-cat-head"><span class="side-cat-title">${esc(c.title)}</span>
        ${editing ? `<span class="side-cat-tools">
          <button type="button" data-cat-move="-1" data-id="${c.id}" title="Monter la catégorie" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
          <button type="button" data-cat-move="1" data-id="${c.id}" title="Descendre la catégorie" ${i === M.cats.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
          <button type="button" data-cat-rename="${c.id}" title="Renommer">${ICON.edit}</button>
          <button type="button" data-cat-del="${c.id}" title="Supprimer la catégorie">${ICON.trash}</button>
          <button type="button" data-add-page="${c.id}" title="Ajouter une page">${ICON.plus}</button>
        </span>` : ''}
      </div>
      <ul class="side-tree">${M.kids(c.id, null).map(item).join('') || (editing ? '<li class="side-empty">Aucune page. Cliquez sur + ou glissez une page ici.</li>' : '')}</ul>
    </section>`).join('')}
    ${editing ? `<button type="button" class="side-new-cat" data-new-cat>${ICON.plus} Nouvelle catégorie</button>
      <p class="side-tip">💡 Glissez-déposez les pages pour les réorganiser. Lâchez une page <strong>au milieu</strong> d'une autre pour en faire une sous-page.</p>` : ''}
  </div>
  ${s.footerNote ? `<div class="side-foot">${ICON.bolt}<span>${esc(s.footerNote)}</span></div>` : ''}`;
}

const refreshSidebar = () => renderSidebar(model(), currentPageId());

async function createPage(categoryId, parentId = null) {
  const p = await attempt(() => api('POST', '/api/pages', { categoryId, parentId, title: 'Nouvelle page', icon: '📄' }));
  if (parentId) { state.open.add(parentId); store.set('rs_open', [...state.open]); }
  await loadData();
  state.focusTitle = true;
  location.hash = `#/p/${p.id}`;
}

sidebar.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) { if (e.target.closest('a')) document.body.classList.remove('nav-open'); return; }
  const d = b.dataset;
  try {
    if (d.toggle) {
      if (state.open.has(d.toggle)) state.open.delete(d.toggle); else state.open.add(d.toggle);
      store.set('rs_open', [...state.open]);
      return refreshSidebar();
    }
    if (d.addPage) return await createPage(d.addPage);
    if (d.addSub) { const raw = state.data.pages.find(p => p.id === d.addSub); return await createPage(raw.categoryId, raw.id); }
    if ('newCat' in d) {
      const title = await promptBox('Nouvelle catégorie', 'Nom de la catégorie (ex. « Règlement de RedSide V5 »)', '', { submitLabel: 'Créer' });
      if (!title) return;
      await attempt(() => api('POST', '/api/categories', { title }), 'Catégorie créée.');
    }
    if (d.catRename) {
      const c = state.data.categories.find(x => x.id === d.catRename);
      const title = await promptBox('Renommer la catégorie', 'Nom de la catégorie', c.title, { submitLabel: 'Renommer' });
      if (!title) return;
      await attempt(() => api('PUT', `/api/categories/${c.id}`, { title }), 'Catégorie renommée.');
    }
    if (d.catDel) {
      const c = state.data.categories.find(x => x.id === d.catDel);
      const n = state.data.pages.filter(p => p.categoryId === c.id).length;
      if (!(await confirmBox('Supprimer la catégorie ?', `« ${esc(c.title)} » sera supprimée définitivement${n ? `, <strong>avec ses ${n} page${n > 1 ? 's' : ''}</strong>` : ''}.`))) return;
      await attempt(() => api('DELETE', `/api/categories/${c.id}`), 'Catégorie supprimée.');
    }
    if (d.catMove) {
      const ids = [...state.data.categories].sort(byOrder).map(c => c.id);
      const i = ids.indexOf(d.id), j = i + Number(d.catMove);
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await attempt(() => api('POST', '/api/categories/reorder', { ids }));
    }
    await loadData();
    // Ne pas écraser un texte en cours d'écriture dans l'éditeur.
    if (state.dirty) refreshSidebar(); else render();
  } catch { /* déjà signalé */ }
});

// --- Glisser-déposer des pages (mode édition) ---
let dragId = null;
const isInside = (id, ancestorId) => {
  let p = state.data.pages.find(x => x.id === id);
  while (p) { if (p.id === ancestorId) return true; p = p.parentId && state.data.pages.find(x => x.id === p.parentId); }
  return false;
};
const clearDrop = () => $$('.drop-before, .drop-after, .drop-inside, .drop-cat', sidebar).forEach(el => el.classList.remove('drop-before', 'drop-after', 'drop-inside', 'drop-cat'));

function dropTarget(e) {
  const row = e.target.closest('.side-item');
  if (row) {
    const id = row.parentElement.dataset.page;
    if (isInside(id, dragId)) return null; // pas sur elle-même ni dans ses sous-pages
    const r = row.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    return { el: row, id, zone: y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'inside' };
  }
  const head = e.target.closest('.side-cat-head, .side-empty');
  if (head) return { el: head, zone: 'cat', catId: head.closest('[data-cat]').dataset.cat };
  return null;
}

sidebar.addEventListener('dragstart', e => {
  const li = e.target.closest('li[data-page]');
  if (!li || !state.editing) return;
  dragId = li.dataset.page;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
  requestAnimationFrame(() => li.classList.add('dragging'));
});
sidebar.addEventListener('dragend', () => { dragId = null; clearDrop(); $$('.dragging', sidebar).forEach(el => el.classList.remove('dragging')); });
sidebar.addEventListener('dragover', e => {
  if (!dragId) return;
  const t = dropTarget(e);
  clearDrop();
  if (!t) return;
  e.preventDefault();
  t.el.classList.add(`drop-${t.zone}`);
});
sidebar.addEventListener('drop', async e => {
  if (!dragId) return;
  const t = dropTarget(e);
  clearDrop();
  if (!t) return;
  e.preventDefault();
  const id = dragId;
  let dest;
  if (t.zone === 'cat') dest = { categoryId: t.catId, parentId: null, index: 9999 };
  else {
    const target = state.data.pages.find(p => p.id === t.id);
    if (t.zone === 'inside') {
      dest = { categoryId: target.categoryId, parentId: target.id, index: 9999 };
      state.open.add(target.id);
      store.set('rs_open', [...state.open]);
    } else {
      const siblings = state.data.pages.filter(p => p.categoryId === target.categoryId && (p.parentId || null) === (target.parentId || null) && p.id !== id).sort(byOrder);
      dest = { categoryId: target.categoryId, parentId: target.parentId || null, index: siblings.findIndex(p => p.id === target.id) + (t.zone === 'after' ? 1 : 0) };
    }
  }
  try {
    await attempt(() => api('POST', '/api/pages/move', { id, ...dest }), 'Page déplacée.');
    await loadData();
    if (state.dirty) refreshSidebar(); else render();
  } catch { /* déjà signalé */ }
});

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
  render();
});
window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

function render() {
  state.lastHash = location.hash;
  state.dirty = false;
  editor = null;
  closeFloating();
  document.body.classList.remove('nav-open');
  document.body.classList.toggle('is-editing', state.editing);
  main.onclick = main.oninput = main.onkeydown = null;
  renderTopbar();
  setToc([]);
  window.scrollTo(0, 0);

  const M = model();
  const { parts, params } = parseRoute();
  const [p0, p1] = parts;
  const siteName = state.data.settings.siteName;

  if (!p0) {
    if (M.flat[0]) { history.replaceState(null, '', `#/p/${M.flat[0].id}`); return render(); }
    renderSidebar(M, null);
    return renderEmpty();
  }
  if (p0 === 'p') {
    // La page ouverte et ses parents sont dépliés dans la sidebar.
    [p1, ...M.ancestors(p1).map(a => a.id)].forEach(x => state.open.add(x));
    store.set('rs_open', [...state.open]);
    renderSidebar(M, p1);
    return state.editing ? renderEditor(M, p1) : renderPage(M, p1, params);
  }
  renderSidebar(M, null);
  if (p0 === 'connexion') { document.title = `Connexion — ${siteName}`; return loggedIn() ? (location.hash = '#/admin') : renderLogin(params); }
  if (p0 === 'admin') {
    if (!loggedIn()) { location.hash = '#/connexion'; return; }
    if (p1 === 'reglages') return can('settings') ? renderSettings() : renderDenied();
    if (p1 === 'historique') return can('edit') ? renderHistory(params) : renderDenied();
    if (p1 === 'acces') return me().owner ? renderAccess() : renderDenied();
    // Après connexion : on ouvre directement le mode édition sur le règlement.
    if (can('edit')) { setEditing(true); location.hash = '#/'; return; }
    if (can('settings')) { location.hash = '#/admin/reglages'; return; }
    return renderDenied();
  }
  renderNotFound();
}

function renderEmpty() {
  document.title = state.data.settings.siteName;
  main.innerHTML = state.editing
    ? `<div class="empty"><h2>Le règlement est vide</h2><p>1. Créez une catégorie avec le bouton <strong>« Nouvelle catégorie »</strong> dans le menu de gauche.<br>2. Ajoutez-y une page avec le bouton <strong>+</strong>.</p>
        <button class="btn btn-accent" id="first-cat">${ICON.plus} Créer une catégorie</button></div>`
    : `<div class="empty"><h2>Le règlement n'est pas encore publié</h2><p>Revenez un peu plus tard.</p>${can('edit') ? '<p>Vous faites partie du staff : activez le <strong>Mode édition</strong> en haut à droite pour le rédiger.</p>' : ''}</div>`;
  const b = $('#first-cat');
  if (b) b.onclick = () => $('[data-new-cat]', sidebar).click();
}

function renderDenied() {
  main.innerHTML = '<div class="empty"><h2>Accès refusé</h2><p>Vous n\'avez pas encore d\'accès sur cette partie. Demandez au propriétaire de vous en donner.</p></div>';
}

function renderNotFound() {
  main.innerHTML = '<div class="empty"><h2>Page introuvable</h2><p><a href="#/">Retour à l\'accueil</a></p></div>';
}

// ---------------------------------------------------------------------------
// Lecture d'une page
// ---------------------------------------------------------------------------

function docHtml(p, M, { preview = false } = {}) {
  const kids = M.kids(p.categoryId, p.id);
  const i = M.flat.findIndex(x => x.id === p.id);
  const prev = i > 0 ? M.flat[i - 1] : null, next = i >= 0 ? M.flat[i + 1] : null;
  return `<article class="doc">
    <div class="doc-top">
      <span class="doc-cat">${esc(M.cat(p.categoryId).title)}</span>
      ${preview ? '' : `<button type="button" class="btn btn-sm btn-ghost" data-copy-page title="Copier le texte de la page">${ICON.copy} Copier</button>`}
    </div>
    <h1 class="doc-title"><span class="doc-ico">${esc(p.icon)}</span><span>${esc(p.title)}</span></h1>
    ${p.description ? `<p class="doc-desc">${esc(p.description)}</p>` : ''}
    <div class="prose" id="prose">${sanitize(p.content)}</div>
    ${kids.length ? `<div class="sub-cards">${kids.map(k => `<a class="sub-card" href="#/p/${k.id}"><span class="side-ico">${esc(k.icon)}</span><span><strong>${esc(k.title)}</strong>${k.description ? `<small>${esc(k.description)}</small>` : ''}</span>${ICON.chevR}</a>`).join('')}</div>` : ''}
    ${p.updatedAt ? `<p class="doc-meta">Dernière mise à jour le ${fmtDate(p.updatedAt)}</p>` : ''}
    ${preview ? '' : `<nav class="pager">
      ${prev ? `<a class="pager-link" href="#/p/${prev.id}">${ICON.left}<span><small>Page précédente</small>${esc(prev.icon)} ${esc(prev.title)}</span></a>` : '<span></span>'}
      ${next ? `<a class="pager-link next" href="#/p/${next.id}"><span><small>Page suivante</small>${esc(next.icon)} ${esc(next.title)}</span>${ICON.right}</a>` : '<span></span>'}
    </nav>`}
  </article>`;
}

// Prépare le contenu affiché : ancres des titres, tableaux défilants, table des matières.
function enhanceProse(prose) {
  const used = new Set();
  const heads = $$('h2, h3', prose).map(h => {
    let id = `s-${norm(h.textContent).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section'}`;
    while (used.has(id)) id += '-';
    used.add(id);
    h.id = id;
    return { id, text: h.textContent.trim(), level: h.tagName === 'H2' ? 2 : 3 };
  }).filter(h => h.text);
  $$('table', prose).forEach(t => {
    if (t.parentElement.classList.contains('table-wrap')) return;
    const w = document.createElement('div');
    w.className = 'table-wrap';
    t.replaceWith(w);
    w.append(t);
  });
  setToc(heads);
}

function renderPage(M, id, params) {
  const p = M.byId.get(id);
  if (!p) {
    const raw = state.data.pages.find(x => x.id === id);
    if (raw && can('edit')) {
      main.innerHTML = `<div class="empty"><h2>Cette page n'est pas publiée</h2><p>Les joueurs ne la voient pas encore.</p><button class="btn btn-accent" id="go-edit">${ICON.edit} Ouvrir en mode édition</button></div>`;
      $('#go-edit').onclick = () => { setEditing(true); render(); };
      return;
    }
    return renderNotFound();
  }
  document.title = `${p.title} — ${state.data.settings.siteName}`;
  main.innerHTML = docHtml(p, M);
  const prose = $('#prose');
  enhanceProse(prose);

  if (params.get('s')) requestAnimationFrame(() => scrollToHeading(params.get('s')));
  else if (params.get('q')) requestAnimationFrame(() => highlightInPage(prose, params.get('q')));

  main.onclick = e => {
    if (!e.target.closest('[data-copy-page]')) return;
    const text = `${p.title}\n\n${p.description ? `${p.description}\n\n` : ''}${prose.innerText.trim()}`;
    navigator.clipboard.writeText(text).then(() => toast('Contenu de la page copié.'), () => toast('Copie impossible dans ce navigateur.', true));
  };
}

// Surligne la première occurrence du mot recherché et y fait défiler la page.
function highlightInPage(root, q) {
  const term = q.trim().split(/\s+/)[0];
  if (!term) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    let i = n.data.toLowerCase().indexOf(term.toLowerCase());
    // Recherche sans accents seulement si elle ne décale pas les positions dans le texte.
    if (i < 0 && norm(n.data).length === n.data.length) i = norm(n.data).indexOf(norm(term));
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(n, i); r.setEnd(n, i + term.length);
    const mark = document.createElement('mark');
    mark.className = 'search-hit';
    r.surroundContents(mark);
    window.scrollTo({ top: mark.getBoundingClientRect().top + scrollY - 140, behavior: 'smooth' });
    setTimeout(() => mark.replaceWith(...mark.childNodes), 4000);
    return;
  }
}

// --- Table des matières (« Sur cette page ») ---
function setToc(heads) {
  state.heads = heads;
  toc.innerHTML = heads.length ? `<div class="toc-inner"><p class="toc-title">Sur cette page</p>
    <ul>${heads.map(h => `<li class="lvl-${h.level}"><a href="#" data-toc="${h.id}">${esc(h.text)}</a></li>`).join('')}</ul></div>` : '';
  spy();
}

function scrollToHeading(id) {
  const el = document.getElementById(id);
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 84, behavior: 'smooth' });
}

toc.addEventListener('click', e => {
  const a = e.target.closest('[data-toc]');
  if (!a) return;
  e.preventDefault();
  scrollToHeading(a.dataset.toc);
});

// Surligne dans la table des matières la section en cours de lecture.
function spy() {
  if (!state.heads.length) return;
  let active = state.heads[0].id;
  for (const h of state.heads) {
    const el = document.getElementById(h.id);
    if (el && el.getBoundingClientRect().top < 120) active = h.id;
  }
  // En bas de page, la dernière section est forcément celle qu'on lit.
  if (window.innerHeight + scrollY >= document.documentElement.scrollHeight - 4) active = state.heads[state.heads.length - 1].id;
  $$('[data-toc]', toc).forEach(a => a.classList.toggle('active', a.dataset.toc === active));
}
let spyQueued = false;
window.addEventListener('scroll', () => {
  if (spyQueued) return;
  spyQueued = true;
  requestAnimationFrame(() => { spyQueued = false; spy(); });
}, { passive: true });

// ---------------------------------------------------------------------------
// Recherche (Ctrl + K)
// ---------------------------------------------------------------------------

function highlight(text, terms) {
  let out = esc(text);
  for (const t of terms) {
    if (!t) continue;
    out = out.replace(new RegExp(esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`);
  }
  return out;
}

function snippet(text, term) {
  const i = term ? norm(text).indexOf(norm(term)) : -1;
  if (i < 0) return text.slice(0, 140) + (text.length > 140 ? '…' : '');
  const start = Math.max(0, i - 50);
  return (start ? '…' : '') + text.slice(start, start + 170) + (start + 170 < text.length ? '…' : '');
}

function openSearch() {
  if ($('.palette-backdrop')) return;
  closeFloating();
  const M = model();
  const index = M.list.map(p => ({ p, text: textOf(p.content), where: [M.cat(p.categoryId).title, ...M.ancestors(p.id).map(a => a.title)].join(' › ') }));
  const wrap = document.createElement('div');
  wrap.className = 'palette-backdrop';
  wrap.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Rechercher">
    <label class="palette-input">${ICON.search}<input type="search" placeholder="Rechercher une règle, un mot-clé…" autocomplete="off"><kbd>Échap</kbd></label>
    <div class="palette-results"></div>
    <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> naviguer</span><span><kbd>Entrée</kbd> ouvrir</span></div>
  </div>`;
  document.body.append(wrap);
  const input = $('input', wrap), results = $('.palette-results', wrap);
  let hits = [], sel = 0;

  const close = () => wrap.remove();
  const go = h => { close(); location.hash = `#/p/${h.p.id}${input.value.trim() ? `?q=${encodeURIComponent(input.value.trim())}` : ''}`; };
  const draw = () => {
    const q = input.value.trim();
    const terms = norm(q).split(/\s+/).filter(Boolean);
    const raw = q.split(/\s+/).filter(Boolean);
    if (!terms.length) {
      hits = index.slice(0, 8);
    } else {
      hits = index.map(h => {
        const inTitle = terms.every(t => norm(h.p.title).includes(t));
        const inAll = terms.every(t => norm(`${h.p.title} ${h.p.description} ${h.text}`).includes(t));
        return inAll ? { ...h, score: inTitle ? 2 : 1 } : null;
      }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 20);
    }
    sel = Math.min(sel, Math.max(0, hits.length - 1));
    results.innerHTML = hits.length ? hits.map((h, i) => `<a href="#/p/${h.p.id}" class="palette-hit ${i === sel ? 'sel' : ''}" data-i="${i}">
      <span class="side-ico">${esc(h.p.icon)}</span>
      <span class="palette-text"><small>${esc(h.where)}</small><strong>${highlight(h.p.title, raw)}</strong>
      ${terms.length ? `<span>${highlight(snippet(`${h.p.description} ${h.text}`.trim(), raw[0]), raw)}</span>` : ''}</span></a>`).join('')
      : `<p class="palette-empty">Aucun résultat pour « ${esc(q)} ».</p>`;
    const cur = $('.sel', results);
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, hits.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
    else if (e.key === 'Enter' && hits[sel]) { e.preventDefault(); go(hits[sel]); }
    else if (e.key === 'Escape') close();
  });
  results.addEventListener('click', e => { const a = e.target.closest('[data-i]'); if (a) { e.preventDefault(); go(hits[Number(a.dataset.i)]); } });
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  draw();
  input.focus();
}

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
});

// ---------------------------------------------------------------------------
// Mode édition : éditeur de page par blocs
// ---------------------------------------------------------------------------

const EMOJIS = ['📄', '📜', '📘', '📖', '📌', '📢', '👋', '⚖️', '🚫', '⚠️', '✅', '❌', 'ℹ️', '🔒', '👮', '🚓', '🚑', '🚒', '🔫', '🔪', '💰', '💵', '🏦', '💎',
  '🚗', '🏍️', '🚁', '✈️', '🏠', '🏢', '🏥', '🍔', '🍕', '☕', '🍽️', '🎭', '🎮', '🎲', '🎉', '🛒', '🧾', '🛠️', '⚙️', '🧭', '🗺️', '📍', '⏰', '📅',
  '💬', '📣', '👥', '👤', '👑', '⭐', '🔥', '💀', '🩸', '💊', '🕵️', '🏛️', '🚀', '❤️'];

// Blocs proposés par le menu « / ».
const BLOCKS = [
  { label: 'Texte', desc: 'Paragraphe normal', ico: '¶', kw: 'texte paragraphe normal', run: ed => ed.formatBlock('p') },
  { label: 'Titre', desc: 'Grand titre de section', ico: 'H2', kw: 'titre h2 section', run: ed => ed.formatBlock('h2') },
  { label: 'Sous-titre', desc: 'Petit titre', ico: 'H3', kw: 'sous-titre h3', run: ed => ed.formatBlock('h3') },
  { label: 'Liste à puces', desc: 'Liste simple', ico: '•', kw: 'liste puces ul', run: () => document.execCommand('insertUnorderedList') },
  { label: 'Liste numérotée', desc: '1, 2, 3…', ico: '1.', kw: 'liste numerotee ol', run: () => document.execCommand('insertOrderedList') },
  { label: 'Encadré info', desc: 'Conseil ou précision', ico: 'ℹ️', kw: 'encadre info callout bleu', run: ed => ed.callout('info') },
  { label: 'Encadré attention', desc: 'Point important', ico: '⚠️', kw: 'encadre attention important warning', run: ed => ed.callout('warn') },
  { label: 'Encadré interdit', desc: 'Interdiction ou sanction', ico: '⛔', kw: 'encadre interdit sanction danger', run: ed => ed.callout('danger') },
  { label: 'Image (envoyer)', desc: 'Depuis votre ordinateur', ico: '🖼️', kw: 'image photo upload envoyer', run: ed => ed.imageUpload() },
  { label: 'Image (lien)', desc: 'À partir d\'une adresse https://', ico: '🔗', kw: 'image lien url', run: ed => ed.imageUrl() },
  { label: 'Tableau', desc: 'Lignes et colonnes', ico: '📊', kw: 'tableau table grille', run: ed => ed.table() },
  { label: 'Séparateur', desc: 'Ligne horizontale', ico: '―', kw: 'separateur ligne hr', run: ed => ed.hr() },
  { label: 'Citation', desc: 'Texte cité', ico: '❝', kw: 'citation quote', run: ed => ed.formatBlock('blockquote') },
];

const closestEl = (node, sel, root) => {
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  const found = el && el.closest(sel);
  return found && (!root || root.contains(found)) ? found : null;
};

function placeCaret(el, atEnd = false) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(!atEnd);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

// Sélectionne le texte d'une cellule : ce qu'on tape remplace « Colonne 1 ».
function selectCell(cell) {
  const r = document.createRange();
  r.selectNodeContents(cell);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

function floatAt(el, rect, { above = false } = {}) {
  const w = el.offsetWidth, h = el.offsetHeight;
  let top = above ? rect.top - h - 8 : rect.bottom + 6;
  if (!above && top + h > innerHeight - 8) top = rect.top - h - 6;
  if (top < 8) top = rect.bottom + 6;
  el.style.top = `${top}px`;
  el.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - w - 8))}px`;
}

function iconPicker(anchor, onPick) {
  closeFloating();
  const pop = document.createElement('div');
  pop.className = 'floating ico-pop';
  pop.innerHTML = `<p class="ico-pop-title">Choisir une icône</p>
    <div class="ico-grid">${EMOJIS.map(e => `<button type="button" data-e="${e}">${e}</button>`).join('')}</div>
    <label class="field"><span>Ou collez un emoji</span><input type="text" maxlength="8" placeholder="ex. 🚓"></label>`;
  document.body.append(pop);
  floatAt(pop, anchor.getBoundingClientRect());
  const done = v => { pop.remove(); document.removeEventListener('mousedown', outside); if (v) onPick(v); };
  const outside = e => { if (!pop.contains(e.target) && e.target !== anchor) done(null); };
  setTimeout(() => document.addEventListener('mousedown', outside));
  pop.onclick = e => { const b = e.target.closest('[data-e]'); if (b) done(b.dataset.e); };
  const input = $('input', pop);
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(input.value.trim()); } if (e.key === 'Escape') done(null); };
}

function renderEditor(M, id) {
  let raw = state.data.pages.find(p => p.id === id);
  if (!raw) return renderNotFound();
  const d = { ...raw.draft };
  let categoryId = raw.categoryId;
  let previewing = false;
  document.title = `✏ ${d.title} — Édition`;

  main.innerHTML = `
    <div class="edit-bar">
      <span class="edit-status" id="ed-status"></span>
      <span class="spacer"></span>
      <button type="button" class="btn btn-sm" id="ed-preview">${ICON.eye} Aperçu</button>
      <a class="btn btn-sm hide-sm" href="#/admin/historique?page=${id}">${ICON.clock} Historique</a>
      <button type="button" class="btn btn-sm" id="ed-save">Enregistrer</button>
      ${can('publish') ? '<button type="button" class="btn btn-sm btn-accent" id="ed-publish">Publier</button>' : ''}
      <div class="nav-dd"><button type="button" class="icon-btn" data-dd title="Plus d'actions">${ICON.dots}</button>
        <div class="dd-menu dd-right">
          <a href="#/admin/historique?page=${id}">Historique de cette page</a>
          ${can('publish') ? '<button type="button" data-ed="unpublish" id="ed-unpublish">Dépublier (cacher aux joueurs)</button>' : ''}
          <button type="button" data-ed="delete" class="danger">Supprimer la page</button>
        </div></div>
    </div>
    ${can('publish') ? '' : '<p class="edit-note">Vous pouvez enregistrer, mais pas publier : une personne ayant l\'accès « Publier » rendra vos changements visibles.</p>'}
    <div id="ed-area">
      <article class="doc doc-edit">
        <div class="doc-top">
          <label class="cat-pick" title="Catégorie de la page">${ICON.folder}<select id="ed-cat">${state.data.categories.slice().sort(byOrder).map(c => `<option value="${c.id}" ${c.id === categoryId ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></label>
        </div>
        <h1 class="doc-title"><button type="button" class="doc-ico ico-btn" id="ed-icon" title="Changer l'icône">${esc(d.icon)}</button><input id="ed-title" class="title-input" maxlength="160" placeholder="Titre de la page" value="${esc(d.title)}"></h1>
        <textarea id="ed-desc" class="desc-input" rows="1" maxlength="400" placeholder="Ajoutez une courte description, affichée sous le titre…">${esc(d.description)}</textarea>
        <div class="prose editor" id="ed-body" contenteditable="true" spellcheck="true" data-placeholder="Commencez à écrire, ou tapez « / » pour insérer un titre, une liste, une image, un encadré…">${sanitize(d.content) || '<p><br></p>'}</div>
        <p class="ed-help">💡 Tapez <kbd>/</kbd> pour insérer un bloc · Sélectionnez du texte pour le mettre en <b>gras</b>, en <span class="hl">rouge</span> ou en lien · <kbd>Ctrl</kbd> + <kbd>S</kbd> pour enregistrer</p>
      </article>
    </div>
    <div id="ed-preview-pane" hidden></div>`;

  const title = $('#ed-title'), desc = $('#ed-desc'), body = $('#ed-body'), catSel = $('#ed-cat'), iconBtn = $('#ed-icon');
  document.execCommand('defaultParagraphSeparator', false, 'p');

  const autosize = () => { desc.style.height = 'auto'; desc.style.height = `${desc.scrollHeight}px`; };
  autosize();
  const refreshEmpty = () => body.classList.toggle('is-empty', !body.textContent.trim() && !body.querySelector('img, table, hr'));
  refreshEmpty();

  let tocTimer = null;
  const markDirty = () => {
    state.dirty = true;
    refreshStatus();
    refreshEmpty();
    clearTimeout(tocTimer);
    tocTimer = setTimeout(() => enhanceToc(), 400);
  };
  // Table des matières en direct à partir des titres de l'éditeur (les id ne sont pas enregistrés).
  const enhanceToc = () => {
    const heads = $$('h2, h3', body).map((h, i) => { h.id = `s-ed-${i}`; return { id: h.id, text: h.textContent.trim(), level: h.tagName === 'H2' ? 2 : 3 }; }).filter(h => h.text);
    setToc(heads);
  };
  enhanceToc();

  if (state.focusTitle) { state.focusTitle = false; title.focus(); title.select(); }

  title.addEventListener('input', markDirty);
  desc.addEventListener('input', () => { autosize(); markDirty(); });
  catSel.addEventListener('change', () => { categoryId = catSel.value; markDirty(); });
  iconBtn.onclick = () => iconPicker(iconBtn, v => { d.icon = v; iconBtn.textContent = v; markDirty(); });

  function refreshStatus() {
    const st = pageStatus(raw);
    $('#ed-status').innerHTML = `<span class="badge badge-${st}">${STATUS[st]}</span>
      ${state.dirty ? '<span class="dirty-dot">● Non enregistré</span>' : `<span class="muted hide-sm">Enregistré le ${fmtDate(raw.updatedAt)} à ${fmtTime(raw.updatedAt)}${raw.updatedBy ? ` par ${esc(raw.updatedBy)}` : ''}</span>`}`;
    $('#ed-save').disabled = !state.dirty;
    const pub = $('#ed-publish');
    if (pub) pub.disabled = !state.dirty && st === 'live';
    const unpub = $('#ed-unpublish');
    if (unpub) unpub.hidden = !raw.live;
  }
  refreshStatus();

  async function save(quiet = false) {
    const payload = { title: title.value.trim() || 'Sans titre', icon: d.icon, description: desc.value.trim(), content: sanitize(body.innerHTML), categoryId };
    await attempt(() => api('PUT', `/api/pages/${id}`, payload), quiet ? null : 'Page enregistrée (brouillon).');
    state.dirty = false;
    await loadData();
    raw = state.data.pages.find(p => p.id === id);
    refreshSidebar();
    refreshStatus();
  }

  $('#ed-save').onclick = () => save().catch(() => {});
  const pubBtn = $('#ed-publish');
  if (pubBtn) pubBtn.onclick = async () => {
    try {
      if (state.dirty) await save(true);
      await attempt(() => api('POST', `/api/pages/${id}/publish`), 'Page publiée : visible par tous les joueurs.');
      await loadData();
      raw = state.data.pages.find(p => p.id === id);
      refreshSidebar();
      refreshStatus();
    } catch { /* déjà signalé */ }
  };

  $('#ed-preview').onclick = () => {
    previewing = !previewing;
    closeFloating();
    $('#ed-area').hidden = previewing;
    const pane = $('#ed-preview-pane');
    pane.hidden = !previewing;
    $('#ed-preview').innerHTML = previewing ? `${ICON.edit} Retour à l'édition` : `${ICON.eye} Aperçu`;
    if (!previewing) { pane.innerHTML = ''; enhanceToc(); return body.focus(); }
    const fake = { id, categoryId, parentId: raw.parentId, icon: d.icon, title: title.value.trim() || 'Sans titre', description: desc.value.trim(), content: body.innerHTML, updatedAt: Date.now() };
    pane.innerHTML = `<div class="preview-banner">${ICON.eye}<span><strong>Aperçu</strong> — voici exactement ce que verront les joueurs une fois la page publiée.</span></div>${docHtml(fake, model(), { preview: true })}`;
    enhanceProse($('.prose', pane));
  };

  main.onclick = async e => {
    const b = e.target.closest('[data-ed]');
    if (!b) return;
    try {
      if (b.dataset.ed === 'unpublish') {
        if (!(await confirmBox('Dépublier la page ?', 'Les joueurs ne verront plus cette page (ni ses sous-pages). Le contenu est conservé.', 'Dépublier'))) return;
        await attempt(() => api('POST', `/api/pages/${id}/unpublish`), 'Page dépubliée.');
        await loadData();
        raw = state.data.pages.find(p => p.id === id);
        refreshSidebar();
        refreshStatus();
      }
      if (b.dataset.ed === 'delete') {
        const n = state.data.pages.filter(p => isInside(p.id, id)).length - 1;
        if (!(await confirmBox('Supprimer la page ?', `« ${esc(title.value || d.title)} » sera supprimée définitivement${n > 0 ? `, <strong>avec ses ${n} sous-page${n > 1 ? 's' : ''}</strong>` : ''}.`))) return;
        await attempt(() => api('DELETE', `/api/pages/${id}`), 'Page supprimée.');
        state.dirty = false;
        await loadData();
        location.hash = '#/';
      }
    } catch { /* déjà signalé */ }
  };

  // Ctrl + S pour enregistrer
  main.onkeydown = e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (state.dirty) save().catch(() => {}); }
  };

  // --- Actions de l'éditeur (utilisées par le menu « / » et les barres flottantes) ---
  const ed = {
    body, markDirty,
    formatBlock(tag) { document.execCommand('formatBlock', false, tag); },
    // Insère un bloc ; sur une ligne vide, il la remplace au lieu de s'empiler dessous.
    insertBlock(html) {
      const s = getSelection();
      let block = s.rangeCount ? s.anchorNode : null;
      while (block && block !== body && block.parentNode !== body) block = block.parentNode;
      if (block && block !== body && block.nodeType === 1 && block.tagName === 'P' && !block.textContent.trim() && !block.querySelector('img')) {
        const r = document.createRange(); r.selectNode(block); s.removeAllRanges(); s.addRange(r);
      }
      document.execCommand('insertHTML', false, html);
      const el = body.querySelector('[data-new]');
      if (el) el.removeAttribute('data-new');
      return el;
    },
    callout(kind) {
      const el = ed.insertBlock(`<div class="callout callout-${kind}" data-new><p><br></p></div><p><br></p>`);
      if (el && el.firstElementChild) placeCaret(el.firstElementChild);
    },
    table() {
      const row = cell => `<tr>${cell.repeat(3)}</tr>`;
      const el = ed.insertBlock(`<table data-new><thead><tr><th>Colonne 1</th><th>Colonne 2</th><th>Colonne 3</th></tr></thead><tbody>${row('<td><br></td>').repeat(2)}</tbody></table><p><br></p>`);
      if (el) selectCell($('th', el));
    },
    hr() {
      const el = ed.insertBlock('<hr><p data-new><br></p>');
      if (el) placeCaret(el);
    },
    insertImage(url, range) {
      body.focus();
      if (range) { const s = getSelection(); s.removeAllRanges(); s.addRange(range); }
      const el = ed.insertBlock(`<p><img src="${esc(url)}" alt=""></p><p data-new><br></p>`);
      if (el) placeCaret(el);
      markDirty();
    },
    async imageUpload() {
      const range = saveRange();
      const file = await pickImage();
      if (!file) return;
      try { const { url } = await attempt(() => uploadImage(file), 'Image ajoutée.'); ed.insertImage(url, range); } catch { /* toast */ }
    },
    async imageUrl() {
      const range = saveRange();
      const url = await promptBox('Image depuis un lien', 'Adresse de l\'image (doit commencer par https://)', 'https://', { submitLabel: 'Insérer' });
      if (!url) return;
      if (!/^https:\/\//i.test(url)) return toast('Le lien doit commencer par https://', true);
      ed.insertImage(url, range);
    },
  };
  const saveRange = () => { const s = getSelection(); return s.rangeCount && body.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null; };
  editor = ed;

  // --- Menu « / » ---
  let slash = null; // { node, offset, items, sel, el }
  const closeSlash = () => { if (slash && slash.el) slash.el.remove(); slash = null; };
  const drawSlash = () => {
    const s = getSelection();
    if (!slash || !s.rangeCount || s.anchorNode !== slash.node || s.anchorOffset <= slash.offset || slash.node.data[slash.offset] !== '/') return closeSlash();
    const q = slash.node.data.slice(slash.offset + 1, s.anchorOffset);
    if (/\s/.test(q) || q.length > 20) return closeSlash();
    slash.items = BLOCKS.filter(b => norm(`${b.label} ${b.kw}`).includes(norm(q)));
    slash.sel = Math.min(slash.sel, Math.max(0, slash.items.length - 1));
    if (!slash.el) {
      slash.el = document.createElement('div');
      slash.el.className = 'floating slash-menu';
      slash.el.addEventListener('mousedown', e => e.preventDefault());
      slash.el.addEventListener('click', e => { const it = e.target.closest('[data-i]'); if (it) chooseSlash(Number(it.dataset.i)); });
      document.body.append(slash.el);
    }
    slash.el.innerHTML = slash.items.length
      ? `<p class="slash-title">Insérer un bloc</p>${slash.items.map((b, i) => `<button type="button" class="slash-item ${i === slash.sel ? 'sel' : ''}" data-i="${i}"><span class="slash-ico">${b.ico}</span><span><strong>${b.label}</strong><small>${b.desc}</small></span></button>`).join('')}`
      : '<p class="slash-title">Aucun bloc ne correspond</p>';
    const r = s.getRangeAt(0).getBoundingClientRect();
    floatAt(slash.el, r.width || r.height ? r : slash.node.parentElement.getBoundingClientRect());
    $('.sel', slash.el)?.scrollIntoView({ block: 'nearest' });
  };
  const chooseSlash = i => {
    const b = slash.items[i];
    const s = getSelection();
    // Efface « /recherche » avant d'insérer le bloc.
    const r = document.createRange();
    r.setStart(slash.node, slash.offset);
    r.setEnd(slash.node, s.anchorNode === slash.node ? s.anchorOffset : slash.offset + 1);
    r.deleteContents();
    s.removeAllRanges(); s.addRange(r);
    closeSlash();
    body.focus();
    Promise.resolve(b.run(ed)).finally(() => { markDirty(); updateFloating(); });
  };

  body.addEventListener('input', e => {
    markDirty();
    if (e.inputType === 'insertText' && e.data === '/') {
      const s = getSelection();
      if (s.anchorNode && s.anchorNode.nodeType === Node.TEXT_NODE) slash = { node: s.anchorNode, offset: s.anchorOffset - 1, sel: 0 };
    }
    if (slash) drawSlash();
  });

  body.addEventListener('keydown', e => {
    if (slash && slash.items && slash.items.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); slash.sel = (slash.sel + 1) % slash.items.length; return drawSlash(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); slash.sel = (slash.sel - 1 + slash.items.length) % slash.items.length; return drawSlash(); }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return chooseSlash(slash.sel); }
    }
    if (slash && e.key === 'Escape') { e.preventDefault(); return closeSlash(); }
    const s = getSelection();
    // Entrée sur une ligne vide à la fin d'un encadré : on sort de l'encadré.
    if (e.key === 'Enter' && !e.shiftKey) {
      const p = closestEl(s.anchorNode, 'p', body);
      const box = p && p.parentElement && p.parentElement.classList.contains('callout') ? p.parentElement : null;
      if (box && !p.textContent.trim() && p === box.lastElementChild && box.children.length > 1) {
        e.preventDefault();
        p.remove();
        const np = document.createElement('p');
        np.innerHTML = '<br>';
        box.after(np);
        placeCaret(np);
        return markDirty();
      }
    }
    // Tab dans un tableau : cellule suivante (une ligne est ajoutée à la fin).
    if (e.key === 'Tab') {
      const cell = closestEl(s.anchorNode, 'td, th', body);
      if (!cell) return;
      e.preventDefault();
      const table = cell.closest('table');
      let cells = $$('th, td', table);
      const i = cells.indexOf(cell) + (e.shiftKey ? -1 : 1);
      if (i >= cells.length) { tableOps.addRow(cells[cells.length - 1]); cells = $$('th, td', table); }
      if (cells[i]) selectCell(cells[i]);
    }
  });
  body.addEventListener('blur', () => setTimeout(() => { if (slash && !body.contains(document.activeElement)) closeSlash(); }, 150));

  // Collage : on nettoie le HTML pour éviter d'importer styles et scripts.
  body.addEventListener('paste', e => {
    const file = [...(e.clipboardData.files || [])].find(f => f.type.startsWith('image/'));
    e.preventDefault();
    if (file) {
      const range = saveRange();
      attempt(() => uploadImage(file), 'Image ajoutée.').then(({ url }) => ed.insertImage(url, range)).catch(() => {});
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
    attempt(() => uploadImage(file), 'Image ajoutée.').then(({ url }) => ed.insertImage(url, null)).catch(() => {});
  });

  // Clic sur une image : sélection (puis Suppr pour l'effacer).
  body.addEventListener('click', e => {
    $$('img.selected', body).forEach(i => i.classList.remove('selected'));
    if (e.target.tagName === 'IMG') {
      e.target.classList.add('selected');
      const r = document.createRange(); r.selectNode(e.target);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }
  });
}

// --- Tableaux : ajout / suppression de lignes et colonnes ---
const tableOps = {
  addRow(cell) {
    const tr = cell.closest('tr');
    const table = tr.closest('table');
    const n = tr.children.length;
    const row = document.createElement('tr');
    row.innerHTML = '<td><br></td>'.repeat(n);
    if (tr.parentElement.tagName === 'THEAD') { let tb = $('tbody', table); if (!tb) { tb = document.createElement('tbody'); table.append(tb); } tb.prepend(row); }
    else tr.after(row);
    return row;
  },
  addCol(cell) {
    const i = [...cell.parentElement.children].indexOf(cell);
    $$('tr', cell.closest('table')).forEach(tr => {
      const c = document.createElement(tr.parentElement.tagName === 'THEAD' ? 'th' : 'td');
      c.innerHTML = tr.parentElement.tagName === 'THEAD' ? 'Colonne' : '<br>';
      if (tr.children[i]) tr.children[i].after(c); else tr.append(c);
    });
  },
  delRow(cell) {
    const tr = cell.closest('tr');
    if (tr.parentElement.tagName === 'THEAD') return toast('La ligne d\'en-tête ne peut pas être supprimée.', true);
    if ($$('tbody tr', tr.closest('table')).length <= 1) return toast('Le tableau doit garder au moins une ligne.', true);
    tr.remove();
  },
  delCol(cell) {
    const i = [...cell.parentElement.children].indexOf(cell);
    const table = cell.closest('table');
    if (cell.parentElement.children.length <= 1) return toast('Le tableau doit garder au moins une colonne.', true);
    $$('tr', table).forEach(tr => tr.children[i] && tr.children[i].remove());
  },
  delTable(cell) { const t = cell.closest('table'); const p = document.createElement('p'); p.innerHTML = '<br>'; t.replaceWith(p); placeCaret(p); },
};

// --- Barres flottantes : mise en forme du texte sélectionné, outils de tableau ---
function toggleHighlight() {
  const s = getSelection();
  if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  const existing = closestEl(r.commonAncestorContainer, 'span.hl', editor.body);
  if (existing) { existing.replaceWith(...existing.childNodes); return; }
  const blockOf = n => closestEl(n, 'p, li, h2, h3, td, th, blockquote', editor.body);
  if (blockOf(r.startContainer) !== blockOf(r.endContainer)) return toast('Sélectionnez du texte dans un seul paragraphe.', true);
  const span = document.createElement('span');
  span.className = 'hl';
  span.append(r.extractContents());
  $$('span.hl', span).forEach(x => x.replaceWith(...x.childNodes));
  r.insertNode(span);
  s.selectAllChildren(span);
}

async function editLink() {
  const s = getSelection();
  const a = closestEl(s.anchorNode, 'a', editor.body);
  if (a) { document.execCommand('unlink'); return; }
  const range = s.getRangeAt(0).cloneRange();
  const url = await promptBox('Insérer un lien', 'Adresse du lien', 'https://', { submitLabel: 'Insérer' });
  if (!url) return;
  if (!/^(https?:|mailto:|#)/i.test(url)) return toast('Lien invalide : il doit commencer par https://', true);
  editor.body.focus();
  s.removeAllRanges(); s.addRange(range);
  document.execCommand('createLink', false, url);
}

function floatingBar(cls, html, onAction) {
  let el = $(`.${cls}`);
  if (!el) {
    el = document.createElement('div');
    el.className = `floating ${cls}`;
    el.innerHTML = html;
    el.addEventListener('mousedown', e => e.preventDefault()); // garde la sélection
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-a]');
      if (!b || !editor) return;
      await onAction(b.dataset.a);
      editor.markDirty();
      updateFloating();
    });
    document.body.append(el);
  }
  return el;
}

function updateFloating() {
  if (!editor || !editor.body.isConnected) return;
  const s = getSelection();
  const inBody = s.rangeCount > 0 && editor.body.contains(s.anchorNode);

  // Bulle de mise en forme sur une sélection de texte.
  const hasText = inBody && !s.isCollapsed && s.toString().trim();
  if (hasText) {
    const bubble = floatingBar('bubble', `
      <button type="button" data-a="bold" title="Gras (Ctrl+B)"><b>G</b></button>
      <button type="button" data-a="italic" title="Italique (Ctrl+I)"><i>I</i></button>
      <button type="button" data-a="hl" title="Mettre en avant en rouge" class="bubble-red">Rouge</button>
      <button type="button" data-a="link" title="Lien">🔗 Lien</button>
      <span class="sep"></span>
      <button type="button" data-a="h2" title="Transformer en titre">Titre</button>
      <button type="button" data-a="clear" title="Effacer la mise en forme">⌫</button>`, async a => {
      if (a === 'bold' || a === 'italic') document.execCommand(a);
      if (a === 'hl') toggleHighlight();
      if (a === 'link') await editLink();
      if (a === 'h2') document.execCommand('formatBlock', false, 'h2');
      if (a === 'clear') { document.execCommand('removeFormat'); const hl = closestEl(getSelection().anchorNode, 'span.hl', editor.body); if (hl) hl.replaceWith(...hl.childNodes); }
    });
    $('[data-a="bold"]', bubble).classList.toggle('on', document.queryCommandState('bold'));
    $('[data-a="hl"]', bubble).classList.toggle('on', !!closestEl(s.anchorNode, 'span.hl', editor.body));
    $('[data-a="link"]', bubble).innerHTML = closestEl(s.anchorNode, 'a', editor.body) ? '🔗 Retirer' : '🔗 Lien';
    floatAt(bubble, s.getRangeAt(0).getBoundingClientRect(), { above: true });
  } else $('.bubble')?.remove();

  // Outils de tableau quand le curseur est dans une cellule.
  const cell = inBody && closestEl(s.anchorNode, 'td, th', editor.body);
  if (cell) {
    const bar = floatingBar('table-tools', `
      <button type="button" data-a="addRow">+ Ligne</button><button type="button" data-a="addCol">+ Colonne</button>
      <button type="button" data-a="delRow">− Ligne</button><button type="button" data-a="delCol">− Colonne</button>
      <button type="button" data-a="delTable" class="danger">Supprimer le tableau</button>`, a => {
      const c = closestEl(getSelection().anchorNode, 'td, th', editor.body);
      if (c) tableOps[a](c);
    });
    // Sous le tableau, pour ne pas chevaucher la bulle de mise en forme.
    floatAt(bar, cell.closest('table').getBoundingClientRect());
  } else $('.table-tools')?.remove();
}
document.addEventListener('selectionchange', updateFloating);
window.addEventListener('scroll', () => { if (editor) updateFloating(); }, { passive: true });

// ---------------------------------------------------------------------------
// Connexion Discord
// ---------------------------------------------------------------------------

const DISCORD_LOGO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.4C.6 9-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.9-9.8-3.6-13.7ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>';

function renderLogin(params) {
  const err = params.get('erreur');
  const id = params.get('id') || '';
  const messages = {
    refuse: `<p><strong>Accès refusé.</strong> Votre compte Discord n'est pas autorisé. Votre demande a été transmise au propriétaire.</p>
      <p>Votre ID Discord : <code class="copy-id" title="Cliquer pour copier">${esc(id)}</code></p>`,
    config: '<p>La connexion Discord n\'est pas encore configurée sur le serveur.</p>',
    discord: '<p>Discord a renvoyé une erreur. Réessayez dans quelques instants.</p>',
    annule: '<p>Connexion annulée ou expirée. Réessayez.</p>',
  };
  main.innerHTML = `<div class="card auth">
    <h1>Connexion staff</h1>
    <p class="muted">Réservé aux personnes autorisées par le propriétaire. Le règlement reste consultable par tous, sans connexion.</p>
    ${err && messages[err] ? `<div class="auth-alert">${messages[err]}</div>` : ''}
    ${state.data.discordReady
      ? `<a class="btn btn-discord btn-lg" href="/auth/discord">${DISCORD_LOGO} Se connecter avec Discord</a>`
      : '<p class="error-msg">Connexion Discord non configurée sur le serveur (variables DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET et OWNER_DISCORD_ID).</p>'}
    <ol class="auth-steps">
      <li>Cliquez sur <strong>« Se connecter avec Discord »</strong> et acceptez.</li>
      <li>Si vous êtes autorisé, le <strong>mode édition</strong> s'ouvre directement.</li>
      <li>Sinon, votre demande est envoyée au propriétaire, qui pourra vous donner l'accès.</li>
    </ol>
  </div>`;
  const copy = $('.copy-id');
  if (copy) copy.onclick = () => navigator.clipboard.writeText(id).then(() => toast('ID copié.'));
}

// ---------------------------------------------------------------------------
// Administration : en-tête commun
// ---------------------------------------------------------------------------

function adminHeader(active) {
  const tab = (href, key, label) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  return `<div class="admin-head"><h1>Administration</h1></div>
    <nav class="tabs">${can('edit') ? tab('#/admin/historique', 'history', 'Historique') : ''}${can('settings') ? tab('#/admin/reglages', 'settings', 'Réglages du site') : ''}${me().owner ? tab('#/admin/acces', 'access', 'Accès du staff') : ''}</nav>`;
}

// ---------------------------------------------------------------------------
// Administration : réglages (nom, logo, menu du haut)
// ---------------------------------------------------------------------------

function renderSettings() {
  document.title = `Réglages — ${state.data.settings.siteName}`;
  const s = structuredClone(state.data.settings);
  const pageOptions = `<option value="">Lier à une page…</option>${state.data.pages.map(p => `<option value="#/p/${p.id}">${esc(p.draft.icon)} ${esc(p.draft.title)}</option>`).join('')}`;

  main.innerHTML = `${adminHeader('settings')}
    <form id="settings-form">
      <div class="card">
        <h2 class="card-title">Identité du site</h2>
        <label class="field"><span>Nom du serveur</span><input type="text" name="siteName" maxlength="60" value="${esc(s.siteName)}" required></label>
        <span class="field-label">Logo</span>
        <div class="logo-box">
          <div class="logo-preview" id="logo-prev"></div>
          <div><button type="button" class="btn btn-sm" id="logo-up">Importer un logo</button>
            <button type="button" class="btn btn-sm btn-danger" id="logo-rm">Retirer</button>
            <p class="muted small">PNG transparent conseillé, 5 Mo max.</p></div>
        </div>
        <label class="field"><span>Petit texte en bas du menu de gauche</span><input type="text" name="footerNote" maxlength="80" value="${esc(s.footerNote)}" placeholder="ex. Propulsé par RedSide"></label>
      </div>
      <div class="card">
        <h2 class="card-title">Liens du menu du haut</h2>
        <p class="muted small">Un lien avec des <strong>sous-liens</strong> devient un menu déroulant (▾). Laissez le lien principal vide si vous voulez seulement le menu. Pour pointer vers une page du règlement, utilisez « Lier à une page… ». Le lien <code>#/connexion</code> ouvre la connexion staff.</p>
        <div id="nav-editor"></div>
        <button type="button" class="btn btn-sm" id="nav-add">${ICON.plus} Ajouter un lien</button>
      </div>
      <div class="sticky-actions"><button class="btn btn-accent">Enregistrer les réglages</button></div>
    </form>`;

  const drawLogo = () => { $('#logo-prev').innerHTML = s.logo ? `<img src="${esc(s.logo)}" alt="">` : '<span class="muted small">Aucun</span>'; $('#logo-rm').hidden = !s.logo; };
  drawLogo();
  $('#logo-up').onclick = async () => {
    const file = await pickImage();
    if (!file) return;
    try { s.logo = (await attempt(() => uploadImage(file))).url; drawLogo(); } catch { /* toast */ }
  };
  $('#logo-rm').onclick = () => { s.logo = null; drawLogo(); };

  const row = (n, i, j = null) => {
    const key = j === null ? `data-i="${i}"` : `data-i="${i}" data-j="${j}"`;
    return `<div class="nav-row ${j === null ? '' : 'is-child'}">
      <input type="text" ${key} data-f="label" value="${esc(n.label)}" placeholder="Texte" maxlength="${j === null ? 40 : 60}">
      <input type="text" ${key} data-f="url" value="${esc(n.url)}" placeholder="${j === null ? 'Lien (vide = menu déroulant seulement)' : 'https://… ou #/p/…'}">
      <select ${key} data-pick>${pageOptions}</select>
      <span class="nav-row-tools">
        <button type="button" class="icon-btn" ${key} data-move="-1" title="Monter">${ICON.up}</button>
        <button type="button" class="icon-btn" ${key} data-move="1" title="Descendre">${ICON.down}</button>
        <button type="button" class="icon-btn danger" ${key} data-del title="Supprimer">${ICON.trash}</button>
      </span></div>`;
  };
  const drawNav = () => {
    $('#nav-editor').innerHTML = s.nav.map((n, i) => `<div class="nav-group">${row(n, i)}
      ${n.children.map((c, j) => row(c, i, j)).join('')}
      <button type="button" class="linkish small" data-add-child="${i}">${ICON.plus} Ajouter un sous-lien</button></div>`).join('') || '<p class="muted small">Aucun lien.</p>';
  };
  drawNav();

  const target = el => { const i = Number(el.dataset.i); return el.dataset.j === undefined ? { list: s.nav, k: i } : { list: s.nav[i].children, k: Number(el.dataset.j) }; };
  const navEl = $('#nav-editor');
  navEl.addEventListener('input', e => {
    const el = e.target;
    if (!el.dataset.f) return;
    const { list, k } = target(el);
    list[k][el.dataset.f] = el.value;
  });
  navEl.addEventListener('change', e => {
    const el = e.target;
    if (!('pick' in el.dataset) || !el.value) return;
    const { list, k } = target(el);
    list[k].url = el.value;
    if (!list[k].label || /^(Lien|Nouveau lien)$/.test(list[k].label)) list[k].label = el.selectedOptions[0].textContent.replace(/^\S+\s/, '');
    drawNav();
  });
  navEl.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.addChild !== undefined) { s.nav[Number(b.dataset.addChild)].children.push({ label: 'Nouveau lien', url: '' }); return drawNav(); }
    const { list, k } = target(b);
    if ('del' in b.dataset) list.splice(k, 1);
    if (b.dataset.move) { const j = k + Number(b.dataset.move); if (j >= 0 && j < list.length) [list[k], list[j]] = [list[j], list[k]]; }
    drawNav();
  });
  $('#nav-add').onclick = () => { s.nav.push({ label: 'Nouveau lien', url: '', children: [] }); drawNav(); };

  $('#settings-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await attempt(() => api('PUT', '/api/settings', { siteName: f.get('siteName'), footerNote: f.get('footerNote'), logo: s.logo, nav: s.nav }), 'Réglages enregistrés.');
      await loadData();
      render();
    } catch { /* toast */ }
  };
}

// ---------------------------------------------------------------------------
// Administration : historique des modifications
// ---------------------------------------------------------------------------

const ACTIONS = {
  'page.create': 'a créé la page', 'page.save': 'a modifié', 'page.publish': 'a publié', 'page.unpublish': 'a dépublié',
  'page.delete': 'a supprimé la page', 'page.move': 'a déplacé', 'cat.create': 'a créé la catégorie',
  'cat.rename': 'a renommé la catégorie', 'cat.delete': 'a supprimé la catégorie', settings: 'a modifié les réglages du site',
};

async function renderHistory(params) {
  document.title = `Historique — ${state.data.settings.siteName}`;
  main.innerHTML = `${adminHeader('history')}<div class="loading">Chargement…</div>`;
  let list;
  try { list = await api('GET', '/api/history'); } catch (e) { toast(e.message, true); return; }
  if (!location.hash.startsWith('#/admin/historique')) return;
  const only = params.get('page');
  if (only) list = list.filter(h => h.target === only);
  const exists = id => state.data.pages.some(p => p.id === id);
  let lastDay = '';
  const rows = list.map(h => {
    const day = fmtDate(h.at);
    const head = day !== lastDay ? `<li class="hist-day">${day}</li>` : '';
    lastDay = day;
    const isPage = h.action.startsWith('page.') && h.action !== 'page.delete' && exists(h.target);
    return `${head}<li class="hist-row"><span class="hist-time">${fmtTime(h.at)}</span>
      <span><strong>${esc(h.by)}</strong> ${ACTIONS[h.action] || h.action} ${h.title && h.action !== 'settings' ? (isPage ? `<a href="#/p/${h.target}">« ${esc(h.title)} »</a>` : `« ${esc(h.title)} »`) : ''}</span></li>`;
  }).join('');
  const title = only ? (state.data.pages.find(p => p.id === only) || { draft: { title: 'page supprimée' } }).draft.title : '';
  main.innerHTML = `${adminHeader('history')}
    ${only ? `<p class="muted">Modifications de la page <strong>« ${esc(title)} »</strong> · <a href="#/admin/historique">Voir tout l'historique</a></p>` : '<p class="muted">Qui a modifié quoi, et quand (300 dernières actions).</p>'}
    ${list.length ? `<ul class="hist card">${rows}</ul>` : '<div class="empty">Aucune modification enregistrée pour le moment.</div>'}`;
}

// ---------------------------------------------------------------------------
// Administration : accès du staff (propriétaire uniquement)
// ---------------------------------------------------------------------------

const PERM_LABELS = {
  edit: ['Modifier', 'Créer, modifier, déplacer et supprimer les pages et catégories'],
  publish: ['Publier', 'Rendre les pages visibles (ou les cacher) pour les joueurs'],
  settings: ['Réglages', 'Nom du serveur, logo, liens du menu du haut'],
};

async function renderAccess() {
  document.title = `Accès — ${state.data.settings.siteName}`;
  main.innerHTML = `${adminHeader('access')}<div class="loading">Chargement…</div>`;
  let data;
  try { data = await api('GET', '/api/access'); } catch (e) { toast(e.message, true); return; }
  if (!location.hash.startsWith('#/admin/acces')) return;
  const permBoxes = (perms, attrs = '') => Object.entries(PERM_LABELS).map(([k, [label, desc]]) =>
    `<label class="toggle" title="${esc(desc)}"><input type="checkbox" data-perm="${k}" ${attrs} ${perms[k] ? 'checked' : ''}> ${label}</label>`).join('');
  const who = u => `<img class="avatar-img" src="${avatarUrl(u)}" alt="">
    <span class="who"><strong>${esc(u.username || u.note || 'Pas encore connecté')}</strong><small>ID ${esc(u.id)}${u.note && u.username !== u.note ? ` · ${esc(u.note)}` : ''}${u.addedAt ? ` · ajouté le ${fmtDate(u.addedAt)}` : u.at ? ` · demande du ${fmtDate(u.at)}` : ''}</small></span>`;

  main.innerHTML = `${adminHeader('access')}
    <p class="muted">Vous êtes le propriétaire : vous avez tous les accès, et vous seul décidez qui peut se connecter et ce que chacun peut faire.</p>
    ${data.requests.length ? `<div class="card">
      <h2 class="card-title">Demandes d'accès (${data.requests.length})</h2>
      <ul class="user-list">${data.requests.map(r => `<li>${who(r)}
        <button class="btn btn-sm btn-accent" data-approve="${r.id}">Autoriser</button>
        <button class="icon-btn danger" data-ignore="${r.id}" title="Ignorer la demande">${ICON.trash}</button></li>`).join('')}</ul>
      <p class="muted small">Ces personnes ont essayé de se connecter. « Autoriser » leur donne l'accès « Modifier » ; ajustez ensuite si besoin.</p>
    </div>` : ''}
    <div class="grid-2">
      <div class="card">
        <h2 class="card-title">Personnes autorisées (${data.access.length})</h2>
        ${data.access.length ? `<ul class="user-list">${data.access.map(a => `<li class="access-row">
          <div class="access-top">${who(a)}
            <button class="icon-btn danger" data-remove="${a.id}" data-name="${esc(a.username || a.note || a.id)}" title="Retirer l'accès">${ICON.trash}</button></div>
          <div class="perms">${permBoxes(a.perms, `data-for="${a.id}"`)}</div></li>`).join('')}</ul>`
          : '<p class="muted small">Personne pour le moment. Ajoutez quelqu\'un avec son ID Discord, ou attendez qu\'il tente de se connecter.</p>'}
      </div>
      <form class="card" id="add-access">
        <h2 class="card-title">Donner un accès</h2>
        <label class="field"><span>ID Discord</span><input type="text" name="id" required pattern="\\d{17,20}" inputmode="numeric" placeholder="ex. 123456789012345678" autocomplete="off"></label>
        <label class="field"><span>Note (facultatif)</span><input type="text" name="note" maxlength="60" placeholder="ex. Modérateur"></label>
        <div class="perms" style="margin-bottom:16px">${permBoxes({ edit: true })}</div>
        <button class="btn btn-accent">${ICON.plus} Donner l'accès</button>
        <p class="muted small">Pour copier un ID : Discord › Paramètres › Avancés › Mode développeur, puis clic droit sur la personne › « Copier l'identifiant ».</p>
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
  main.onclick = async e => {
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

(async () => {
  try {
    await loadData();
    render();
  } catch (e) {
    main.innerHTML = `<div class="empty">Impossible de charger le règlement : ${esc(e.message)}</div>`;
  }
})();
