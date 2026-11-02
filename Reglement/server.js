// BLACKLIFE RP — serveur du règlement (aucune dépendance externe)
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7; // 7 jours
const MAX_UPLOAD = 5 * 1024 * 1024;
const DISCORD_API = 'https://discord.com/api/v10';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Configuration (config.json, surchargeable par variables d'environnement)
// ---------------------------------------------------------------------------

const fileConfig = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : {};
const discordFile = fileConfig.discord || {};
const PORT = Number(process.env.PORT || fileConfig.port) || 3000;
const config = {
  clientId: process.env.DISCORD_CLIENT_ID || discordFile.clientId || '',
  clientSecret: process.env.DISCORD_CLIENT_SECRET || discordFile.clientSecret || '',
  redirectUri: process.env.DISCORD_REDIRECT_URI || discordFile.redirectUri || `http://localhost:${PORT}/auth/callback`,
  botToken: process.env.DISCORD_BOT_TOKEN || discordFile.botToken || '',
  ownerId: String(process.env.OWNER_DISCORD_ID || fileConfig.ownerId || ''),
};
const discordReady = !!(config.clientId && config.clientSecret && config.ownerId);
if (!discordReady) console.warn('⚠ Connexion Discord non configurée : remplissez config.json (voir README.md).');

// Ce que le propriétaire peut accorder à chaque personne.
const PERMS = ['edit', 'publish', 'appearance'];

// ---------------------------------------------------------------------------
// Stockage
// ---------------------------------------------------------------------------

const DEFAULT_DB = {
  settings: {
    siteName: 'BLACKLIFE RP',
    tagline: 'Règlement officiel du serveur',
    logo: null,
    colors: { accent: '#e11d48', background: '#0b0b10', surface: '#15151d', text: '#ececf1' },
  },
  access: [],   // personnes autorisées : { id, username, avatar, note, perms, addedAt }
  requests: [], // connexions refusées en attente de validation par le propriétaire
  categories: [],
  articles: [],
};

function loadDb() {
  if (!fs.existsSync(DB_FILE)) return seed(structuredClone(DEFAULT_DB));
  const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  d.settings = { ...DEFAULT_DB.settings, ...d.settings, colors: { ...DEFAULT_DB.settings.colors, ...(d.settings || {}).colors } };
  d.access = d.access || [];
  d.requests = d.requests || [];
  delete d.users; // anciens comptes à mot de passe, remplacés par Discord
  return d;
}

function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function seed(d) {
  const now = Date.now();
  const cat = (title, description, parentId = null, order = 0) => {
    const c = { id: uid(), parentId, title, description, order, published: true, updatedAt: now };
    d.categories.push(c);
    return c;
  };
  const art = (categoryId, title, content, order) =>
    d.articles.push({ id: uid(), categoryId, title, content, order, published: true, updatedAt: now });

  const general = cat('Règles générales', 'Les principes fondamentaux à respecter sur BLACKLIFE RP.', null, 0);
  art(general.id, 'Respect', '<p>Le respect envers tous les joueurs et membres du staff est <strong>obligatoire</strong>, en jeu comme sur le Discord.</p>', 0);
  art(general.id, 'Langage', '<p>Les propos racistes, homophobes, sexistes ou discriminatoires sont strictement interdits.</p>', 1);

  const rp = cat('Roleplay', 'Les règles encadrant le jeu de rôle.', null, 1);
  art(rp.id, 'Freekill', '<p>Il est interdit de tuer un joueur sans raison RP valable.</p><blockquote>Sanction : avertissement puis bannissement temporaire.</blockquote>', 0);
  art(rp.id, 'Metagaming', '<p>Utiliser des informations obtenues hors du jeu (stream, Discord…) pour en tirer un avantage en jeu est interdit.</p>', 1);
  const illegal = cat('Activités illégales', 'Braquages, gangs et trafics.', rp.id, 0);
  art(illegal.id, 'Braquages', '<p>Un braquage nécessite un minimum de policiers en service. Les otages doivent être traités de manière RP.</p>', 0);

  return d;
}

const uid = () => crypto.randomBytes(9).toString('base64url');
let db = loadDb();
saveDb();

// ---------------------------------------------------------------------------
// Sessions & accès
// ---------------------------------------------------------------------------

const sessions = new Map(); // token -> { discordId, expires }
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
  const token = parseCookies(req).bl_session;
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

function normalizePerms(p = {}) {
  return Object.fromEntries(PERMS.map(k => [k, !!p[k]]));
}

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
    return redirect(res, `https://discord.com/oauth2/authorize?${q}`, [cookie('bl_state', state, 600)]);
  }

  if (url.pathname === '/auth/callback') {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const clearState = cookie('bl_state', '', 0);
    const expires = oauthStates.get(state);
    oauthStates.delete(state);
    if (!code || !state || state !== parseCookies(req).bl_state || !expires || expires < Date.now()) {
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
      saveDb();
      return redirect(res, `/#/connexion?erreur=refuse&id=${me.id}`, [clearState]);
    }
    if (allowed !== true) { Object.assign(allowed, profile); saveDb(); }

    const sessionToken = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionToken, { discordId: me.id, ...profile, expires: Date.now() + SESSION_TTL });
    return redirect(res, '/#/admin', [clearState, cookie('bl_session', sessionToken, SESSION_TTL / 1000)]);
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

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Fichier trop volumineux (5 Mo max).')); req.destroy(); return; }
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
const nextOrder = items => items.reduce((m, x) => Math.max(m, x.order + 1), 0);
const isColor = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

// Une catégorie est visible publiquement si elle et tous ses parents sont publiés.
function isCategoryVisible(id, seen = new Set()) {
  const c = db.categories.find(x => x.id === id);
  if (!c || !c.published || seen.has(id)) return false;
  seen.add(id);
  return c.parentId ? isCategoryVisible(c.parentId, seen) : true;
}

function wouldCreateCycle(catId, newParentId) {
  let p = newParentId;
  while (p) {
    if (p === catId) return true;
    p = (db.categories.find(c => c.id === p) || {}).parentId;
  }
  return false;
}

function descendantIds(catId) {
  const ids = [catId];
  for (const c of db.categories.filter(c => c.parentId === catId)) ids.push(...descendantIds(c.id));
  return ids;
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
    if (user) return send(res, 200, { user, discordReady, settings: db.settings, categories: db.categories, articles: db.articles });
    const categories = db.categories.filter(c => isCategoryVisible(c.id));
    const visible = new Set(categories.map(c => c.id));
    const articles = db.articles.filter(a => a.published && visible.has(a.categoryId));
    return send(res, 200, { user: null, discordReady, settings: db.settings, categories, articles });
  }

  if (route === 'POST /api/logout') {
    sessions.delete(parseCookies(req).bl_session);
    res.setHeader('Set-Cookie', cookie('bl_session', '', 0));
    return send(res, 200, { ok: true });
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
    const req0 = db.requests.find(r => r.id === id);
    const found = req0 || (await lookupDiscordUser(id)) || {};
    const entry = {
      id, username: found.username || str(body.note, 60) || null, avatar: found.avatar || null,
      note: str(body.note, 60), perms: normalizePerms(body.perms), addedAt: Date.now(),
    };
    db.access.push(entry);
    db.requests = db.requests.filter(r => r.id !== id);
    saveDb();
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
    saveDb();
    return send(res, 200, { ok: true });
  }

  if ((m = route.match(/^DELETE \/api\/requests\/(\d{17,20})$/))) {
    need('owner');
    db.requests = db.requests.filter(r => r.id !== m[1]);
    saveDb();
    return send(res, 200, { ok: true });
  }

  // --- Personnalisation -----------------------------------------------------
  if (route === 'PUT /api/settings') {
    need('appearance');
    const body = await readJson(req);
    const s = db.settings;
    if ('siteName' in body) s.siteName = str(body.siteName, 60) || 'BLACKLIFE RP';
    if ('tagline' in body) s.tagline = str(body.tagline, 160);
    if ('logo' in body) s.logo = typeof body.logo === 'string' && body.logo.startsWith('/uploads/') ? body.logo : null;
    if (body.colors) for (const k of Object.keys(s.colors)) if (isColor(body.colors[k])) s.colors[k] = body.colors[k];
    saveDb();
    return send(res, 200, s);
  }

  // --- Images -------------------------------------------------------------
  if (route === 'POST /api/upload') {
    if (!user) throw new HttpError(401, 'Connexion requise.');
    if (!user.perms.edit && !user.perms.appearance) throw new HttpError(403, "Vous n'avez pas l'accès nécessaire.");
    const types = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
    const ext = types[(req.headers['content-type'] || '').split(';')[0]];
    if (!ext) throw new HttpError(400, 'Format accepté : PNG, JPEG, GIF ou WEBP.');
    const buf = await readBody(req, MAX_UPLOAD);
    if (!buf.length) throw new HttpError(400, 'Fichier vide.');
    const name = `${Date.now()}-${uid()}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    return send(res, 200, { url: `/uploads/${name}` });
  }

  // --- Catégories ----------------------------------------------------------
  // Modifier le contenu demande « edit » ; changer l'état publié demande « publish ».
  if (route === 'POST /api/categories') {
    need('edit');
    const body = await readJson(req);
    if (body.published) need('publish');
    const parentId = body.parentId && db.categories.some(c => c.id === body.parentId) ? body.parentId : null;
    const c = {
      id: uid(), parentId,
      title: str(body.title, 120) || 'Nouvelle catégorie',
      description: str(body.description, 500),
      order: nextOrder(db.categories.filter(c => c.parentId === parentId)), published: !!body.published, updatedAt: Date.now(),
    };
    db.categories.push(c);
    saveDb();
    return send(res, 200, c);
  }

  if ((m = route.match(/^(PUT|DELETE) \/api\/categories\/([\w-]+)$/))) {
    const c = db.categories.find(x => x.id === m[2]);
    if (!c) throw new HttpError(404, 'Catégorie introuvable.');
    if (m[1] === 'DELETE') {
      need('edit');
      const ids = new Set(descendantIds(c.id));
      db.categories = db.categories.filter(x => !ids.has(x.id));
      db.articles = db.articles.filter(a => !ids.has(a.categoryId));
      saveDb();
      return send(res, 200, { ok: true });
    }
    const body = await readJson(req);
    const changesContent = ['title', 'description', 'parentId'].some(k => k in body);
    if (changesContent) need('edit');
    if ('published' in body && !!body.published !== c.published) need('publish');
    if (!changesContent && !('published' in body)) need('edit');
    if ('title' in body) c.title = str(body.title, 120) || c.title;
    if ('description' in body) c.description = str(body.description, 500);
    if ('published' in body) c.published = !!body.published;
    if ('parentId' in body) {
      const p = body.parentId || null;
      if (p && !db.categories.some(x => x.id === p)) throw new HttpError(400, 'Catégorie parente introuvable.');
      if (wouldCreateCycle(c.id, p)) throw new HttpError(400, 'Une catégorie ne peut pas être placée dans ses propres sous-catégories.');
      if (p !== c.parentId) { c.parentId = p; c.order = nextOrder(db.categories.filter(x => x.parentId === p)); }
    }
    c.updatedAt = Date.now();
    saveDb();
    return send(res, 200, c);
  }

  // --- Articles ------------------------------------------------------------
  if (route === 'POST /api/articles') {
    need('edit');
    const body = await readJson(req);
    if (body.published) need('publish');
    if (!db.categories.some(c => c.id === body.categoryId)) throw new HttpError(400, 'Catégorie introuvable.');
    const a = {
      id: uid(), categoryId: body.categoryId,
      title: str(body.title, 160) || 'Nouvel article',
      content: typeof body.content === 'string' ? body.content.slice(0, 200000) : '',
      order: nextOrder(db.articles.filter(x => x.categoryId === body.categoryId)),
      published: !!body.published, updatedAt: Date.now(),
    };
    db.articles.push(a);
    saveDb();
    return send(res, 200, a);
  }

  if ((m = route.match(/^(PUT|DELETE) \/api\/articles\/([\w-]+)$/))) {
    const a = db.articles.find(x => x.id === m[2]);
    if (!a) throw new HttpError(404, 'Article introuvable.');
    if (m[1] === 'DELETE') {
      need('edit');
      db.articles = db.articles.filter(x => x.id !== a.id);
      saveDb();
      return send(res, 200, { ok: true });
    }
    const body = await readJson(req);
    const changesContent = ['title', 'content', 'categoryId'].some(k => k in body);
    if (changesContent) need('edit');
    if ('published' in body && !!body.published !== a.published) need('publish');
    if (!changesContent && !('published' in body)) need('edit');
    if ('title' in body) a.title = str(body.title, 160) || a.title;
    if ('content' in body && typeof body.content === 'string') a.content = body.content.slice(0, 200000);
    if ('published' in body) a.published = !!body.published;
    if ('categoryId' in body && body.categoryId !== a.categoryId) {
      if (!db.categories.some(c => c.id === body.categoryId)) throw new HttpError(400, 'Catégorie introuvable.');
      a.order = nextOrder(db.articles.filter(x => x.categoryId === body.categoryId));
      a.categoryId = body.categoryId;
    }
    a.updatedAt = Date.now();
    saveDb();
    return send(res, 200, a);
  }

  // --- Ordre (catégories ou articles) ----------------------------------------
  if ((m = route.match(/^POST \/api\/(categories|articles)\/reorder$/))) {
    need('edit');
    const body = await readJson(req);
    const list = db[m[1]];
    (Array.isArray(body.ids) ? body.ids : []).forEach((id, i) => {
      const item = list.find(x => x.id === id);
      if (item) item.order = i;
    });
    saveDb();
    return send(res, 200, { ok: true });
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

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/auth/')) return await auth(req, res, url);
    if (url.pathname.startsWith('/uploads/')) return serveStatic(res, UPLOAD_DIR, url.pathname.slice('/uploads/'.length));
    return serveStatic(res, PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname.slice(1), 'index.html');
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    send(res, 500, { error: 'Erreur interne du serveur.' });
  }
}).listen(PORT, () => console.log(`BLACKLIFE RP — règlement disponible sur http://localhost:${PORT}`));
