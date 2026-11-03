# RedSide V5 — Règlement

Site de règlement façon documentation (style GitBook, thème sombre), avec un **mode édition** pour créer et modifier les pages sans toucher au code.
Aucune dépendance à installer : il suffit de **Node.js 18 ou plus**.

```
server.js          serveur (API, connexion Discord, stockage)
public/index.html  squelette de la page
public/app.js      interface : lecture, recherche, éditeur par blocs, administration
public/app.css     thème
data/              données locales (créé automatiquement, à ne pas mettre sur GitHub)
```

---

## 1. Lancer le site sur son ordinateur

```
npm start
```

Puis ouvrir http://localhost:3000. Au premier lancement, des pages d'exemple sont créées.

## 2. Configurer la connexion Discord (staff)

1. Sur https://discord.com/developers/applications, ouvrez votre application › **OAuth2** :
   - copiez le **Client ID** et le **Client Secret** ;
   - dans **Redirects**, ajoutez exactement l'adresse de retour :
     `http://localhost:3000/auth/callback` (en local) ou `https://VOTRE-SITE.onrender.com/auth/callback` (en ligne).
2. Récupérez **votre ID Discord** : Paramètres › Avancés › Mode développeur, puis clic droit sur votre profil › « Copier l'identifiant ».
3. Renseignez ces valeurs, **au choix** dans `config.json` (en local) ou en **variables d'environnement** (en ligne) :

| Variable d'environnement | Dans `config.json` | Rôle |
|---|---|---|
| `DISCORD_CLIENT_ID` | `discord.clientId` | Client ID de l'application |
| `DISCORD_CLIENT_SECRET` | `discord.clientSecret` | Client Secret |
| `DISCORD_REDIRECT_URI` | `discord.redirectUri` | Adresse de retour (identique à celle de Discord) |
| `OWNER_DISCORD_ID` | `ownerId` | Votre ID : vous aurez tous les droits |
| `DISCORD_BOT_TOKEN` | `discord.botToken` | Facultatif : affiche pseudo et avatar quand on ajoute un membre par son ID |

⚠ `config.json` contient des secrets : ne le mettez jamais sur GitHub.

## 3. Où sont stockées les pages ?

Par défaut, dans `data/site.json` (et les images dans `data/uploads/`).
**Sauvegarde = copier le dossier `data/`.**

> ⚠ **Hébergement gratuit (Render Free…)** : le disque est effacé à chaque redémarrage ou mise à jour.
> Vos pages seraient perdues. Utilisez alors **Supabase** (gratuit) ou un **disque persistant**.

### Option A — Supabase (gratuit, recommandé sur Render Free)

1. Créez un projet sur https://supabase.com.
2. **SQL Editor** › exécutez :
   ```sql
   create table site_state (id text primary key, data jsonb not null);
   alter table site_state enable row level security;
   ```
3. **Storage** › **New bucket** › nom : `uploads`, cochez **Public bucket**.
4. **Project Settings › API** : copiez l'**URL** du projet et la clé **service_role** (secrète).
5. Ajoutez sur votre hébergeur :
   - `SUPABASE_URL` = l'URL du projet (ex. `https://abcd.supabase.co`)
   - `SUPABASE_SERVICE_KEY` = la clé service_role

Au démarrage, les logs affichent `Stockage : Supabase`.
Note : un projet Supabase gratuit est mis en pause après une semaine sans aucune visite ; il suffit de le réactiver depuis le tableau de bord.

### Option B — Disque persistant (Render payant)

Ajoutez un **Disk** monté par exemple sur `/var/data`, puis la variable `DATA_DIR=/var/data`.

## 4. Héberger sur Render

1. Mettez le projet sur GitHub (sans `config.json` ni `data/`).
2. Render › **New Web Service** › votre dépôt.
   - **Root Directory** : le dossier qui contient `package.json` (ex. `Reglement`) ;
   - **Build Command** : `npm install` — **Start Command** : `npm start`.
3. **Environment** : ajoutez les variables Discord (section 2) et Supabase (section 3).
   Tapez les valeurs sans espace ni retour à la ligne à la fin.
4. Ajoutez `https://VOTRE-SITE.onrender.com/auth/callback` dans les **Redirects** Discord.

---

## Utilisation

### Lecteurs
- Menu de gauche par catégories, pages et sous-pages (flèche › pour déplier).
- **Ctrl + K** (ou la barre « Rechercher... ») : recherche dans le titre et le contenu de toutes les pages.
- Colonne **« Sur cette page »** : sommaire automatique de la page, la section en cours de lecture est surlignée.
- Bouton **Copier** : copie le texte de la page. Boutons **Page précédente / suivante** en bas.
- Sur téléphone, le menu s'ouvre avec le bouton ☰.

### Staff (mode édition)
Connectez-vous (lien « Se connecter » en haut), puis cliquez sur **Mode édition**.

- **Menu de gauche** : `+` à côté d'une catégorie = nouvelle page ; `+` sur une page = sous-page ;
  crayon / corbeille / flèches = renommer, supprimer, réordonner les catégories ; **Nouvelle catégorie** en bas.
- **Glisser-déposer** les pages dans le menu : en haut / en bas d'une page pour la placer avant / après,
  **au milieu** pour en faire une sous-page, sur le titre d'une catégorie pour l'y déplacer.
- **Sur la page** : cliquez sur l'icône pour la changer, puis modifiez le titre, la description et la catégorie.
- **Contenu** : tapez **`/`** pour insérer un titre, une liste, une image (envoi ou lien), un encadré
  (info / attention / interdit), un tableau, un séparateur ou une citation.
  Sélectionnez du texte pour le mettre en **gras**, en **rouge** ou en lien.
  Dans un tableau, `Tab` passe à la cellule suivante et une barre permet d'ajouter / retirer lignes et colonnes.
- **Enregistrer** garde un brouillon (invisible des joueurs). **Publier** rend la version actuelle visible par tous.
  **Aperçu** montre le rendu exact. Les points de couleur dans le menu signalent : 🟠 jamais publiée, 🔵 modifications non publiées.
- **Historique** (menu de votre avatar) : qui a modifié quoi et quand.
- **Réglages du site** : nom, logo, petit texte en bas du menu, et liens du menu du haut (avec menus déroulants).

### Accès (propriétaire uniquement)
- Le propriétaire (`OWNER_DISCORD_ID`) a tous les droits et gère les accès (menu de l'avatar › **Accès du staff**).
- Droits possibles : **Modifier** (pages et catégories), **Publier**, **Réglages** (nom, logo, menu).
- Quelqu'un qui se connecte sans être autorisé apparaît dans **Demandes d'accès**.
