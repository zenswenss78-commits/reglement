# BLACKLIFE RP — Règlement

Site entièrement dédié au règlement du serveur. Aucune dépendance à installer (Node.js 18+).

## 1. Configurer la connexion Discord (une seule fois)

1. Va sur https://discord.com/developers/applications et ouvre l'application de **ton bot**.
2. Onglet **OAuth2** :
   - copie le **Client ID** et le **Client Secret** (bouton « Reset Secret » si besoin) ;
   - dans **Redirects**, ajoute exactement : `http://localhost:3000/auth/callback`
     (en ligne, mets ton adresse, ex. `https://reglement.monsite.fr/auth/callback`).
3. Récupère **ton ID Discord** : Paramètres › Avancés › Mode développeur, puis clic droit sur ton profil › « Copier l'identifiant ».
4. Remplis `config.json` :

```json
{
  "port": 3000,
  "ownerId": "TON_ID_DISCORD",
  "discord": {
    "clientId": "CLIENT_ID",
    "clientSecret": "CLIENT_SECRET",
    "redirectUri": "http://localhost:3000/auth/callback",
    "botToken": "TOKEN_DU_BOT (facultatif)"
  }
}
```

Le `botToken` est facultatif : il sert seulement à afficher le pseudo et l'avatar quand tu ajoutes quelqu'un par son ID.

⚠ `config.json` contient des secrets : ne le partage jamais.

## 2. Lancer

```
npm start
```

Puis http://localhost:3000 › « Connexion staff » (pied de page) › « Se connecter avec Discord ».

## Accès

- **Tout le monde** lit le règlement publié, sans connexion.
- **Toi (propriétaire, `ownerId`)** : tous les droits, et toi seul gères les accès (onglet *Accès*).
- **Les autres** : seulement ce que tu leur coches — *Modifier le règlement*, *Publier*, *Apparence*.
- Quelqu'un qui se connecte sans être autorisé apparaît dans **Demandes d'accès** : tu cliques « Autoriser » ou tu ignores.
- Retirer un accès déconnecte la personne immédiatement.

## Données

`data/db.json` (règlement, réglages, accès) et `data/uploads/` (images). **Sauvegarde = copier le dossier `data/`.**
