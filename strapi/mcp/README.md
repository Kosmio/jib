# Serveur MCP des Journées de l'Innovation Filière Bois

Ce serveur permet de gérer le contenu du site (éditions, programme, intervenants, organisations, partenaires, tags, pages, médias) depuis un assistant d'IA compatible avec le [Model Context Protocol](https://modelcontextprotocol.io/) : Claude, ChatGPT, Gemini, Cursor, Windsurf, etc.

## Principe

Le serveur MCP tourne à côté du site, dans la même pile Docker.

```
https://<domaine>/          site (Astro)
https://<domaine>/strapi/   administration du contenu (Strapi)
https://<domaine>/mcp/      serveur MCP
```

L'authentification repose sur les jetons d'API de Strapi. Le serveur ne stocke aucun secret : il transmet à Strapi le jeton reçu, et Strapi applique ses droits. Les droits du jeton bornent donc ce que l'assistant peut faire.

## Créer un jeton d'API à droits limités

1. Ouvrir `https://<domaine>/strapi/admin` et se connecter.
2. Aller dans **Réglages**, puis **Jetons d'API** (section Paramètres globaux), puis **Créer un nouveau jeton d'API**.
3. Renseigner :
   - **Nom** : par exemple `Assistant IA, <prénom>` ;
   - **Durée** : 7 jours, 30 jours ou 90 jours. Éviter « Illimité » ;
   - **Type de jeton** : **Personnalisé** (jamais « Accès complet »).
4. Cocher uniquement les droits utiles :
   - pour chaque type de contenu à gérer (Édition, Séquence, Intervention, Intervenant, Organisation, Partenaire, Tag, Page statique, Page d'accueil) : `find`, `findOne`, `create`, `update`, `publish` si l'assistant doit publier ;
   - **ne pas cocher `delete`** : sans ce droit, Strapi refuse toute suppression, quoi que fasse l'assistant ;
   - Médias (Upload) : `find` et `upload` ;
   - **ne rien cocher** dans la section Espace (participants, rendez-vous, messages, etc.) : ces données personnelles n'ont pas à passer par l'assistant.
5. **Enregistrer**, puis copier le jeton tout de suite : il ne sera plus affichable.

Pour révoquer l'accès : Réglages, Jetons d'API, corbeille sur la ligne du jeton. L'effet est immédiat.

## Connecter l'outil d'IA

Le jeton passe **uniquement par l'en-tête `Authorization: Bearer <jeton>`**. Le serveur refuse (HTTP 400) toute requête qui porte un jeton dans l'URL (`?token=...`), car une URL se retrouve dans les journaux des serveurs et des proxys. Un outil qui ne sait pas envoyer d'en-tête personnalisé n'est pas compatible.

### Claude Desktop

Fichier `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) ou `%APPDATA%\Claude\claude_desktop_config.json` (Windows) :

```json
{
  "mcpServers": {
    "jib-cms": {
      "type": "http",
      "url": "https://<domaine>/mcp",
      "headers": { "Authorization": "Bearer <jeton>" }
    }
  }
}
```

### Claude Code

Fichier `.mcp.json` à la racine du projet, même contenu que ci-dessus. Ne pas le versionner : il contient le jeton.

### Cursor

Réglages, MCP Servers, ajouter un serveur de type HTTP : URL `https://<domaine>/mcp`, en-tête `Authorization: Bearer <jeton>`.

### Windsurf

Fichier `~/.codeium/windsurf/mcp_config.json`, même structure que Claude Desktop.

### Autre outil

- Streamable HTTP (recommandé) : `https://<domaine>/mcp`.
- SSE ancien : `GET https://<domaine>/mcp/sse` puis `POST https://<domaine>/mcp/messages?sessionId=<id>`.
- Dans les deux cas, l'en-tête `Authorization` est obligatoire.

Redémarrer l'outil, puis demander « liste les types de contenu » pour vérifier.

## Ce que le MCP peut faire

| Outil | Rôle |
|---|---|
| `list_content_types` | Types de contenu gérables, avec leurs champs |
| `list_entries` | Lister les entrées (pagination, tri, statut) |
| `get_entry` | Lire une entrée par `documentId` ou par valeur de champ (ex. `slug`) |
| `create_entry` | Créer une entrée (brouillon par défaut) |
| `update_entry` | Modifier une entrée |
| `publish_entry`, `unpublish_entry` | Publier ou repasser en brouillon |
| `delete_entry` | Supprimer, avec confirmation explicite (voir plus bas) |
| `upload_media`, `list_media` | Ajouter un fichier depuis une URL, parcourir la médiathèque |

L'assistant peut aussi modifier les réglages de l'espace participant portés par une édition : `participantSpaceEnabled`, `helloassoOrgSlug`, `helloassoFormType`, `helloassoFormSlug`, `helloassoFieldMap`, `slotDurationMinutes`, `tablesCount`, `meetingRequestsOpenAt`, `meetingRequestsCloseAt` (et `welcomeStartedAt`, posé par le système, à ne pas toucher). Ces champs sont privés : on peut les écrire, mais Strapi ne les renvoie jamais en lecture. L'assistant ne peut donc pas relire leur valeur actuelle ; il faut la consulter dans l'administration Strapi.

## Ce que le MCP ne peut pas faire

- **Aucun accès aux données de l'espace participant** : participants, rendez-vous, conversations, messages, créneaux, jetons de connexion, journaux d'e-mails, synchronisations, exposants, sujets, et tout type `api::espace.*`. Ces types ne figurent pas dans `content-types.json`, aucun outil ne les accepte (lecture, écriture ou suppression), et le serveur n'appelle jamais les routes `/api/espace`. Ils ne sont pas en lecture seule : ils sont absents.
- **Pas de suppression sans confirmation** : `delete_entry` exige le paramètre `confirm: true`, que l'assistant ne doit poser qu'après l'accord explicite de la personne. Sans lui, la suppression est refusée avant tout appel à Strapi. Un type de l'espace est refusé même avec `confirm: true`. Pour une protection complète, ne pas donner le droit `delete` au jeton.
- Pas de gestion des utilisateurs, des rôles, des jetons ni des réglages de Strapi.
- Seuls les types listés par `list_content_types` sont atteignables.

## Entretien de `content-types.json`

`content-types.json` doit rester aligné sur `strapi/src/api/*/content-types/*/schema.json` (hors `api::espace.*`, volontairement exclu). Tout champ ajouté, retiré ou renommé sur un type exposé s'y reporte, avec une description lisible par une personne non technique. Le test `strapi/tests/unit/mcp.test.js` vérifie cet alignement.

## Déploiement

Le serveur est déployé avec la pile Docker Compose. Il n'a besoin que de `STRAPI_URL` (URL interne de Strapi) et, en option, de `MCP_PORT` (3100 par défaut). Aucun secret n'est stocké côté serveur.

### Développement local

```bash
corepack pnpm@12.15.0 --dir strapi/mcp install
STRAPI_URL=http://localhost:1337 corepack pnpm@12.15.0 --dir strapi/mcp start
```

Le serveur écoute sur le port 3100, sans préfixe : Streamable HTTP sur `http://localhost:3100/`, SSE sur `http://localhost:3100/sse`. Créer un jeton dans `http://localhost:1337/admin` et l'envoyer dans l'en-tête `Authorization`.

## Dépannage

- **« Non authentifié »** : l'en-tête `Authorization: Bearer <jeton>` manque dans la configuration de l'outil.
- **« Jeton refusé dans l'URL »** : retirer `?token=...` de l'URL et utiliser l'en-tête.
- **« Strapi error (401) »** : jeton invalide, expiré ou révoqué. En créer un nouveau.
- **« Strapi error (403) »** : le jeton n'a pas le droit demandé sur ce type. Compléter ses droits dans Strapi.
- **« Type inconnu ou non exposé »** : le type n'est pas dans `list_content_types`, ou c'est un type de l'espace.
- **Connexion refusée** : le site ou le serveur MCP est arrêté.

## Sécurité

- Le jeton n'est jamais accepté dans l'URL et n'est jamais écrit dans les journaux du serveur (les messages d'erreur sont purgés de tout motif `Bearer ...`).
- Il n'est conservé qu'en mémoire, le temps de la session.
- Les communications passent en HTTPS via Traefik.
- Jeton à durée limitée, droits minimaux, sans `delete` : c'est la protection de fond.
