// RedSide V5 — serveur du règlement, style documentation (aucune dépendance externe, Node.js 18+)
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR.trim()) : path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'site.json');
const LEGACY_DB_FILE = path.join(DATA_DIR, 'db.json'); // ancien format : on n'en récupère que les accès
const CONFIG_FILE = path.join(ROOT, 'config.json');
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7; // 7 jours
const MAX_UPLOAD = 5 * 1024 * 1024;
const MAX_CONTENT = 400000;
const MAX_HISTORY = 300;
const DISCORD_API = 'https://discord.com/api/v10';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Configuration (config.json, surchargeable par variables d'environnement)
// ---------------------------------------------------------------------------

const fileConfig = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : {};
const discordFile = fileConfig.discord || {};
const supabaseFile = fileConfig.supabase || {};
const PORT = Number(process.env.PORT || fileConfig.port) || 3000;
// .trim() : un espace ou retour à la ligne collé par erreur casse l'OAuth Discord.
const env = (name, fallback = '') => String(process.env[name] || fallback || '').trim();
const config = {
  clientId: env('DISCORD_CLIENT_ID', discordFile.clientId),
  clientSecret: env('DISCORD_CLIENT_SECRET', discordFile.clientSecret),
  redirectUri: env('DISCORD_REDIRECT_URI', discordFile.redirectUri) || `http://localhost:${PORT}/auth/callback`,
  botToken: env('DISCORD_BOT_TOKEN', discordFile.botToken),
  ownerId: env('OWNER_DISCORD_ID', fileConfig.ownerId),
  supabaseUrl: env('SUPABASE_URL', supabaseFile.url).replace(/\/+$/, ''),
  supabaseKey: env('SUPABASE_SERVICE_KEY', supabaseFile.serviceKey),
  supabaseBucket: env('SUPABASE_BUCKET', supabaseFile.bucket) || 'uploads',
};
const discordReady = !!(config.clientId && config.clientSecret && config.ownerId);
const useSupabase = !!(config.supabaseUrl && config.supabaseKey);
if (!discordReady) console.warn('⚠ Connexion Discord non configurée (voir README.md).');

// Ce que le propriétaire peut accorder à chaque personne.
const PERMS = ['edit', 'publish', 'settings'];

// ---------------------------------------------------------------------------
// Stockage : fichier JSON local, ou Supabase si SUPABASE_URL est défini
// (indispensable sur un hébergement gratuit dont le disque est effacé au redémarrage).
// ---------------------------------------------------------------------------

const supaHeaders = (extra = {}) => ({ apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, ...extra });

async function supaFetch(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Supabase ${res.status} : ${(await res.text()).slice(0, 300)}`);
  return res;
}

const storage = {
  async load() {
    if (useSupabase) {
      const res = await supaFetch(`${config.supabaseUrl}/rest/v1/site_state?id=eq.main&select=data`, { headers: supaHeaders() });
      const rows = await res.json();
      return rows[0] ? rows[0].data : null;
    }
    return fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : null;
  },
  async save(data) {
    if (useSupabase) {
      await supaFetch(`${config.supabaseUrl}/rest/v1/site_state`, {
        method: 'POST',
        headers: supaHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({ id: 'main', data }),
      });
      return;
    }
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DB_FILE);
  },
  async upload(name, type, buf) {
    if (useSupabase) {
      await supaFetch(`${config.supabaseUrl}/storage/v1/object/${config.supabaseBucket}/${name}`, {
        method: 'POST', headers: supaHeaders({ 'Content-Type': type, 'x-upsert': 'true' }), body: buf,
      });
      return `${config.supabaseUrl}/storage/v1/object/public/${config.supabaseBucket}/${name}`;
    }
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    return `/uploads/${name}`;
  },
};

// Les écritures sont enchaînées : jamais deux sauvegardes en même temps.
let saveQueue = Promise.resolve();
function saveDb() {
  const run = saveQueue.then(() => storage.save(db));
  saveQueue = run.catch(err => console.error('Sauvegarde impossible :', err.message));
  return run;
}

// ---------------------------------------------------------------------------
// Données
// ---------------------------------------------------------------------------
// categories : groupes de la sidebar          { id, title, order }
// pages      : { id, categoryId, parentId, order,
//                draft: { title, icon, description, content }   ← dernière version enregistrée
//                live:  { ... } | null                          ← version publiée (null = jamais publiée)
//                updatedAt, updatedBy, publishedAt }
// history    : journal des modifications (le plus récent en premier)

const DEFAULT_SETTINGS = {
  siteName: 'RedSide V5',
  logo: null,
  footerNote: 'Propulsé par RedSide',
  nav: [
    { label: 'Accueil', url: '#/', children: [{ label: 'Règlement', url: '#/' }, { label: 'Guide', url: '#/' }] },
    { label: 'Se connecter', url: '#/connexion', children: [] },
    { label: 'Discord', url: 'https://discord.gg/', children: [] },
    { label: 'Boutique', url: '', children: [{ label: 'Boutique en ligne', url: '#' }, { label: 'Avantages VIP', url: '#' }] },
    { label: 'Guide', url: '', children: [{ label: 'Bien débuter', url: '#/' }, { label: 'Métiers', url: '#' }] },
    { label: 'Restaurants', url: '', children: [{ label: 'Liste des restaurants', url: '#' }] },
  ],
};

const uid = () => crypto.randomBytes(9).toString('base64url');

function seed() {
  const now = Date.now();
  const d = { settings: structuredClone(DEFAULT_SETTINGS), access: [], requests: [], categories: [], pages: [], history: [] };
  const cat = (title, order) => { const c = { id: uid(), title, order }; d.categories.push(c); return c; };
  const page = (categoryId, parentId, order, icon, title, description, content) => {
    const v = { title, icon, description, content };
    const p = { id: uid(), categoryId, parentId, order, draft: v, live: structuredClone(v), updatedAt: now, updatedBy: 'RedSide', publishedAt: now };
    d.pages.push(p);
    return p;
  };

  const rules = cat('Règlement de RedSide V5', 0);
  page(rules.id, null, 0, '👋', 'Bienvenue', 'Tout ce qu\'il faut savoir avant de jouer sur RedSide V5.',
    `<p>Bienvenue sur <strong>RedSide V5</strong> ! Ce règlement s'applique <span class="hl">à tous les joueurs</span>, en jeu comme sur le Discord.</p>
<div class="callout callout-warn"><p>En rejoignant le serveur, vous acceptez ce règlement. Nul n'est censé l'ignorer.</p></div>
<h2>Comment lire ce règlement</h2>
<ol><li>Choisissez une page dans le menu de gauche.</li><li>Utilisez la colonne <strong>« Sur cette page »</strong> à droite pour aller à une section.</li><li>Appuyez sur <strong>Ctrl + K</strong> pour rechercher une règle.</li></ol>
<h2>Les encadrés</h2>
<div class="callout callout-info"><p>Information : un conseil ou une précision.</p></div>
<div class="callout callout-warn"><p>Attention : un point important à ne pas rater.</p></div>
<div class="callout callout-danger"><p>Interdit : ce qui est strictement interdit et sanctionné.</p></div>`);
  const general = page(rules.id, null, 1, '📜', 'Règles générales', 'Les principes fondamentaux à respecter sur RedSide V5.',
    `<h2>Respect</h2>
<p>Le respect envers tous les joueurs et membres du staff est <strong>obligatoire</strong>, en jeu comme sur le Discord.</p>
<h2>Langage</h2>
<div class="callout callout-danger"><p>Les propos racistes, homophobes, sexistes ou discriminatoires sont <strong>strictement interdits</strong>.</p></div>
<h2>Sanctions</h2>
<table><thead><tr><th>Infraction</th><th>Sanction</th></tr></thead><tbody><tr><td>Manque de respect</td><td>Avertissement</td></tr><tr><td>Propos discriminatoires</td><td>Bannissement</td></tr></tbody></table>`);
  page(rules.id, general.id, 0, '🎭', 'Roleplay', 'Les règles encadrant le jeu de rôle.',
    `<h2>Freekill</h2>
<p>Il est interdit de tuer un joueur <span class="hl">sans raison RP valable</span>.</p>
<h2>Metagaming</h2>
<p>Utiliser des informations obtenues hors du jeu (stream, Discord…) pour en tirer un avantage en jeu est interdit.</p>
<h3>Exemples</h3>
<ul><li>Regarder le stream d'un joueur pour le retrouver.</li><li>Donner une information RP sur le Discord.</li></ul>`);
  page(rules.id, general.id, 1, '🔫', 'Activités illégales', 'Braquages, gangs et trafics.',
    `<h2>Braquages</h2>
<p>Un braquage nécessite un minimum de policiers en service. Les otages doivent être traités de manière RP.</p>
<div class="callout callout-info"><p>Le nombre de policiers requis est affiché en jeu.</p></div>`);

  const guide = cat('Guide RedSide', 1);
  page(guide.id, null, 0, '🚀', 'Bien débuter', 'Les premiers pas sur le serveur.',
    `<h2>Rejoindre le serveur</h2>
<ol><li>Rejoignez le Discord.</li><li>Lisez entièrement ce règlement.</li><li>Lancez FiveM et connectez-vous à RedSide V5.</li></ol>
<hr><p>Bon jeu sur <strong>RedSide V5</strong> !</p>`);

  // Reprend les accès et le logo de l'ancien site s'il existait.
  if (fs.existsSync(LEGACY_DB_FILE)) {
    try {
      const old = JSON.parse(fs.readFileSync(LEGACY_DB_FILE, 'utf8'));
      d.access = Array.isArray(old.access) ? old.access.map(a => ({ ...a, perms: { edit: !!a.perms?.edit, publish: !!a.perms?.publish, settings: !!a.perms?.appearance } })) : [];
      d.requests = Array.isArray(old.requests) ? old.requests : [];
      if (old.settings?.logo) d.settings.logo = old.settings.logo;
    } catch { /* ancien fichier illisible : ignoré */ }
  }
  return d;
}

function normalizeDb(d) {
  d.settings = { ...structuredClone(DEFAULT_SETTINGS), ...d.settings };
  for (const k of ['access', 'requests', 'categories', 'pages', 'history']) if (!Array.isArray(d[k])) d[k] = [];
  return d;
}

let db = null; // chargé au démarrage (voir tout en bas)

function logHistory(user, action, target, title) {
  const by = user ? user.username || user.id : 'inconnu';
  const last = db.history[0];
  // Plusieurs enregistrements d'affilée de la même page par la même personne = une seule ligne.
  if (action === 'page.save' && last && last.action === action && last.target === target && last.byId === user.id && Date.now() - last.at < 10 * 60 * 1000) {
    Object.assign(last, { at: Date.now(), title });
    return;
  }
  db.history.unshift({ at: Date.now(), by, byId: user && user.id, action, target, title });
  db.history.length = Math.min(db.history.length, MAX_HISTORY);
}

// ---------------------------------------------------------------------------
// Sessions & accès
// ---------------------------------------------------------------------------

const sessions = new Map(); // token -> { discordId, username, avatar, expires }
const oauthStates = new Map(); // state -> expires

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const cookie = (name, value, maxAge) => `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

// Renvoie l'utilisateur connecté avec ses droits actuels (retirer l'accès coupe immédiatement la session).
function currentUser(req) {
  const token = parseCookies(req).rs_session;
  const s = token && sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(token); return null; }
  if (s.discordId === config.ownerId) {
    const perms = Object.fromEntries(PERMS.map(p => [p, true]));
    return { id: s.discordId, username: s.username, avatar: s.avatar, owner: true, perms };
  }
  const a = db.access.find(x => x.id === s.discordId);
  if (!a) { sessions.delete(token); return null; }
  return { id: a.id, username: a.username, avatar: a.avatar, owner: false, perms: { ...a.perms } };
}

const normalizePerms = (p = {}) => Object.fromEntries(PERMS.map(k => [k, !!p[k]]));
const isSnowflake = v => typeof v === 'string' && /^\d{17,20}$/.test(v);

async function discordFetch(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Discord ${res.status}: ${body.message || body.error || 'erreur'}`);
  return body;
}

// Avec le token du bot, on récupère le pseudo et l'avatar d'un ID Discord.
async function lookupDiscordUser(id) {
  if (!config.botToken) return null;
  try {
    const u = await discordFetch(`${DISCORD_API}/users/${id}`, { headers: { Authorization: `Bot ${config.botToken}` } });
    return { username: u.global_name || u.username, avatar: u.avatar };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Connexion Discord (OAuth2)
// ---------------------------------------------------------------------------

function redirect(res, location, cookies = []) {
  res.writeHead(302, { Location: location, 'Set-Cookie': cookies, 'Cache-Control': 'no-store' });
  res.end();
}

async function auth(req, res, url) {
  if (url.pathname === '/auth/discord') {
    if (!discordReady) return redirect(res, '/#/connexion?erreur=config');
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, Date.now() + 10 * 60 * 1000);
    const q = new URLSearchParams({
      client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: 'identify', state, prompt: 'none',
    });
    return redirect(res, `https://discord.com/oauth2/authorize?${q}`, [cookie('rs_state', state, 600)]);
  }

  if (url.pathname === '/auth/callback') {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const clearState = cookie('rs_state', '', 0);
    const expires = oauthStates.get(state);
    oauthStates.delete(state);
    if (!code || !state || state !== parseCookies(req).rs_state || !expires || expires < Date.now()) {
      return redirect(res, '/#/connexion?erreur=annule', [clearState]);
    }
    let me;
    try {
      const token = await discordFetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId, client_secret: config.clientSecret,
          grant_type: 'authorization_code', code, redirect_uri: config.redirectUri,
        }),
      });
      me = await discordFetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${token.access_token}` } });
    } catch (err) {
      console.error('Connexion Discord échouée :', err.message);
      return redirect(res, '/#/connexion?erreur=discord', [clearState]);
    }

    const profile = { username: me.global_name || me.username, avatar: me.avatar };
    const allowed = me.id === config.ownerId ? true : db.access.find(a => a.id === me.id);
    if (!allowed) {
      const existing = db.requests.find(r => r.id === me.id);
      if (existing) Object.assign(existing, profile, { at: Date.now() });
      else db.requests.push({ id: me.id, ...profile, at: Date.now() });
      await saveDb();
      return redirect(res, `/#/connexion?erreur=refuse&id=${me.id}`, [clearState]);
    }
    if (allowed !== true) { Object.assign(allowed, profile); await saveDb(); }

    const sessionToken = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionToken, { discordId: me.id, ...profile, expires: Date.now() + SESSION_TTL });
    return redirect(res, '/#/admin', [clearState, cookie('rs_session', sessionToken, SESSION_TTL / 1000)]);
  }

  throw new HttpError(404, 'Introuvable.');
}

// ---------------------------------------------------------------------------
// Helpers HTTP
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Contenu trop volumineux.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'JSON invalide.'); }
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// Liens autorisés dans le menu : pages du site, chemins locaux et adresses web.
const safeUrl = v => { const u = str(v, 500); return /^(#|\/|https?:\/\/)/i.test(u) ? u : ''; };
const safeImage = v => (typeof v === 'string' && /^(\/uploads\/|https:\/\/)/.test(v) ? v.slice(0, 500) : null);

function pageVersion(body, fallback = {}) {
  return {
    title: str(body.title, 160) || fallback.title || 'Sans titre',
    icon: str(body.icon, 16) || fallback.icon || '📄',
    description: str(body.description, 400),
    content: typeof body.content === 'string' ? body.content.slice(0, MAX_CONTENT) : (fallback.content || ''),
  };
}

const siblingsOf = (categoryId, parentId, exceptId) =>
  db.pages.filter(p => p.categoryId === categoryId && (p.parentId || null) === (parentId || null) && p.id !== exceptId).sort((a, b) => a.order - b.order);

function descendantIds(pageId) {
  const ids = [pageId];
  for (const p of db.pages.filter(x => x.parentId === pageId)) ids.push(...descendantIds(p.id));
  return ids;
}

// Une page est visible publiquement si elle et toutes ses pages parentes sont publiées.
function isPageVisible(p, seen = new Set()) {
  if (!p || !p.live || seen.has(p.id)) return false;
  seen.add(p.id);
  return p.parentId ? isPageVisible(db.pages.find(x => x.id === p.parentId), seen) : true;
}

// Place une page (et ses sous-pages) à un endroit précis, puis renumérote ses voisines.
function placePage(page, categoryId, parentId, index) {
  if (!db.categories.some(c => c.id === categoryId)) throw new HttpError(400, 'Catégorie introuvable.');
  if (parentId) {
    const parent = db.pages.find(p => p.id === parentId);
    if (!parent) throw new HttpError(400, 'Page parente introuvable.');
    if (descendantIds(page.id).includes(parentId)) throw new HttpError(400, 'Une page ne peut pas être placée dans ses propres sous-pages.');
    categoryId = parent.categoryId;
  }
  const list = siblingsOf(categoryId, parentId, page.id);
  const i = Number.isInteger(index) ? Math.max(0, Math.min(index, list.length)) : list.length;
  list.splice(i, 0, page);
  list.forEach((p, n) => { p.order = n; });
  page.parentId = parentId || null;
  for (const id of descendantIds(page.id)) db.pages.find(p => p.id === id).categoryId = categoryId;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const user = currentUser(req);
  const need = perm => {
    if (!user) throw new HttpError(401, 'Connexion requise.');
    if (perm === 'owner' ? !user.owner : !user.perms[perm]) throw new HttpError(403, "Vous n'avez pas l'accès nécessaire.");
  };
  let m;

  // --- Lecture -------------------------------------------------------------
  if (route === 'GET /api/data') {
    const base = { user, discordReady, settings: db.settings, categories: db.categories };
    if (user && user.perms.edit) return send(res, 200, { ...base, pages: db.pages });
    // Visiteurs : uniquement la version publiée des pages visibles.
    const pages = db.pages.filter(p => isPageVisible(p))
      .map(({ id, categoryId, parentId, order, live, publishedAt }) => ({ id, categoryId, parentId, order, live, publishedAt }));
    return send(res, 200, { ...base, pages });
  }

  if (route === 'POST /api/logout') {
    sessions.delete(parseCookies(req).rs_session);
    res.setHeader('Set-Cookie', cookie('rs_session', '', 0));
    return send(res, 200, { ok: true });
  }

  if (route === 'GET /api/history') {
    need('edit');
    return send(res, 200, db.history);
  }

  // --- Gestion des accès (propriétaire uniquement) ----------------------------
  if (route === 'GET /api/access') {
    need('owner');
    return send(res, 200, { owner: config.ownerId, access: db.access, requests: db.requests, botLookup: !!config.botToken });
  }

  if (route === 'POST /api/access') {
    need('owner');
    const body = await readJson(req);
    const id = str(body.id, 20);
    if (!isSnowflake(id)) throw new HttpError(400, 'ID Discord invalide (17 à 20 chiffres).');
    if (id === config.ownerId) throw new HttpError(400, 'Le propriétaire a déjà tous les accès.');
    if (db.access.some(a => a.id === id)) throw new HttpError(400, 'Cette personne a déjà un accès.');
    const found = db.requests.find(r => r.id === id) || (await lookupDiscordUser(id)) || {};
    const entry = {
      id, username: found.username || str(body.note, 60) || null, avatar: found.avatar || null,
      note: str(body.note, 60), perms: normalizePerms(body.perms), addedAt: Date.now(),
    };
    db.access.push(entry);
    db.requests = db.requests.filter(r => r.id !== id);
    await saveDb();
    return send(res, 200, entry);
  }

  if ((m = route.match(/^(PUT|DELETE) \/api\/access\/(\d{17,20})$/))) {
    need('owner');
    const a = db.access.find(x => x.id === m[2]);
    if (!a) throw new HttpError(404, 'Accès introuvable.');
    if (m[1] === 'DELETE') {
      db.access = db.access.filter(x => x.id !== a.id);
      for (const [t, s] of sessions) if (s.discordId === a.id) sessions.delete(t);
    } else {
      const body = await readJson(req);
      if (body.perms) a.perms = normalizePerms(body.perms);
      if ('note' in body) a.note = str(body.note, 60);
    }
    await saveDb();
    return send(res, 200, { ok: true });
  }

  if ((m = route.match(/^DELETE \/api\/requests\/(\d{17,20})$/))) {
    need('owner');
    db.requests = db.requests.filter(r => r.id !== m[1]);
    await saveDb();
    return send(res, 200, { ok: true });
  }

  // --- Réglages du site (nom, logo, menu du haut) -----------------------------
  if (route === 'PUT /api/settings') {
    need('settings');
    const body = await readJson(req);
    const s = db.settings;
    if ('siteName' in body) s.siteName = str(body.siteName, 60) || DEFAULT_SETTINGS.siteName;
    if ('footerNote' in body) s.footerNote = str(body.footerNote, 80);
    if ('logo' in body) s.logo = safeImage(body.logo);
    if (Array.isArray(body.nav)) {
      s.nav = body.nav.slice(0, 12).map(n => ({
        label: str(n.label, 40) || 'Lien', url: safeUrl(n.url),
        children: (Array.isArray(n.children) ? n.children : []).slice(0, 15).map(c => ({ label: str(c.label, 60) || 'Lien', url: safeUrl(c.url) })),
      }));
    }
    logHistory(user, 'settings', null, 'Réglages du site');
    await saveDb();
    return send(res, 200, s);
  }

  // --- Images -------------------------------------------------------------
  if (route === 'POST /api/upload') {
    if (!user) throw new HttpError(401, 'Connexion requise.');
    if (!user.perms.edit && !user.perms.settings) throw new HttpError(403, "Vous n'avez pas l'accès nécessaire.");
    const types = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
    const type = (req.headers['content-type'] || '').split(';')[0];
    const ext = types[type];
    if (!ext) throw new HttpError(400, 'Format accepté : PNG, JPEG, GIF ou WEBP.');
    const buf = await readBody(req, MAX_UPLOAD);
    if (!buf.length) throw new HttpError(400, 'Fichier vide.');
    return send(res, 200, { url: await storage.upload(`${Date.now()}-${uid()}.${ext}`, type, buf) });
  }

  // --- Catégories (groupes de la sidebar) --------------------------------------
  if (route === 'POST /api/categories') {
    need('edit');
    const body = await readJson(req);
    const c = { id: uid(), title: str(body.title, 80) || 'Nouvelle catégorie', order: db.categories.reduce((n, x) => Math.max(n, x.order + 1), 0) };
    db.categories.push(c);
    logHistory(user, 'cat.create', c.id, c.title);
    await saveDb();
    return send(res, 200, c);
  }

  if (route === 'POST /api/categories/reorder') {
    need('edit');
    const body = await readJson(req);
    (Array.isArray(body.ids) ? body.ids : []).forEach((id, i) => {
      const c = db.categories.find(x => x.id === id);
      if (c) c.order = i;
    });
    await saveDb();
    return send(res, 200, { ok: true });
  }

  if ((m = route.match(/^(PUT|DELETE) \/api\/categories\/([\w-]+)$/))) {
    need('edit');
    const c = db.categories.find(x => x.id === m[2]);
    if (!c) throw new HttpError(404, 'Catégorie introuvable.');
    if (m[1] === 'DELETE') {
      db.categories = db.categories.filter(x => x.id !== c.id);
      db.pages = db.pages.filter(p => p.categoryId !== c.id);
      logHistory(user, 'cat.delete', c.id, c.title);
    } else {
      const body = await readJson(req);
      const old = c.title;
      c.title = str(body.title, 80) || c.title;
      if (c.title !== old) logHistory(user, 'cat.rename', c.id, `${old} → ${c.title}`);
    }
    await saveDb();
    return send(res, 200, c);
  }

  // --- Pages ----------------------------------------------------------------
  if (route === 'POST /api/pages') {
    need('edit');
    const body = await readJson(req);
    const p = {
      id: uid(), categoryId: null, parentId: null, order: 0,
      draft: pageVersion({ title: body.title || 'Nouvelle page', icon: body.icon }),
      live: null, updatedAt: Date.now(), updatedBy: user.username, publishedAt: null,
    };
    db.pages.push(p);
    try { placePage(p, body.categoryId, body.parentId || null); } catch (e) { db.pages.pop(); throw e; }
    logHistory(user, 'page.create', p.id, p.draft.title);
    await saveDb();
    return send(res, 200, p);
  }

  if (route === 'POST /api/pages/move') {
    need('edit');
    const body = await readJson(req);
    const p = db.pages.find(x => x.id === body.id);
    if (!p) throw new HttpError(404, 'Page introuvable.');
    placePage(p, body.categoryId, body.parentId || null, body.index);
    logHistory(user, 'page.move', p.id, p.draft.title);
    await saveDb();
    return send(res, 200, { ok: true });
  }

  if ((m = route.match(/^(PUT|DELETE) \/api\/pages\/([\w-]+)$/))) {
    need('edit');
    const p = db.pages.find(x => x.id === m[2]);
    if (!p) throw new HttpError(404, 'Page introuvable.');
    if (m[1] === 'DELETE') {
      const ids = new Set(descendantIds(p.id));
      db.pages = db.pages.filter(x => !ids.has(x.id));
      logHistory(user, 'page.delete', p.id, p.draft.title);
      await saveDb();
      return send(res, 200, { ok: true });
    }
    const body = await readJson(req);
    p.draft = pageVersion(body, p.draft);
    // Changer de catégorie depuis l'éditeur : la page passe à la racine de la nouvelle catégorie.
    if (body.categoryId && body.categoryId !== p.categoryId) placePage(p, body.categoryId, null);
    p.updatedAt = Date.now();
    p.updatedBy = user.username;
    logHistory(user, 'page.save', p.id, p.draft.title);
    await saveDb();
    return send(res, 200, p);
  }

  if ((m = route.match(/^POST \/api\/pages\/([\w-]+)\/(publish|unpublish)$/))) {
    need('publish');
    const p = db.pages.find(x => x.id === m[1]);
    if (!p) throw new HttpError(404, 'Page introuvable.');
    if (m[2] === 'publish') { p.live = structuredClone(p.draft); p.publishedAt = Date.now(); }
    else p.live = null;
    logHistory(user, `page.${m[2]}`, p.id, p.draft.title);
    await saveDb();
    return send(res, 200, p);
  }

  throw new HttpError(404, 'Route inconnue.');
}

// ---------------------------------------------------------------------------
// Fichiers statiques
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

function serveStatic(res, baseDir, rel, fallback) {
  const file = path.normalize(path.join(baseDir, rel));
  if (!file.startsWith(baseDir + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      if (fallback) return serveStatic(res, baseDir, fallback);
      res.writeHead(404); return res.end('Introuvable');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/auth/')) return await auth(req, res, url);
    if (url.pathname.startsWith('/uploads/')) return serveStatic(res, UPLOAD_DIR, url.pathname.slice('/uploads/'.length));
    return serveStatic(res, PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname.slice(1), 'index.html');
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    send(res, 500, { error: 'Erreur interne du serveur (voir les logs).' });
  }
});

// Démarrage : on charge les données avant d'accepter des visiteurs.
(async () => {
  try {
    const stored = await storage.load();
    db = stored ? normalizeDb(stored) : seed();
    if (!stored) await saveDb();
  } catch (err) {
    console.error('Impossible de charger les données :', err.message);
    process.exit(1);
  }
  console.log(`Stockage : ${useSupabase ? 'Supabase' : DB_FILE}`);
  server.listen(PORT, () => console.log(`RedSide V5 — règlement disponible sur http://localhost:${PORT}`));
})();
