# Instructions de connexion du MCP, à l'usage des agents d'IA

Tu aides une personne à connecter son outil d'IA au serveur MCP du site des Journées de l'Innovation Filière Bois.

## Ce qu'il faut savoir

- Le serveur MCP tourne déjà sur le site. Il permet de gérer le contenu (éditions, programme, intervenants, organisations, partenaires, tags, pages, médias).
- Il n'expose aucune donnée de l'espace participant (types `api::espace.*`) et refuse toute suppression sans `confirm: true`.
- Le jeton d'API Strapi passe **uniquement** par l'en-tête `Authorization: Bearer <jeton>`. Le serveur refuse un jeton dans l'URL (HTTP 400). Ne jamais écrire `?token=` dans une configuration.

## Ce qu'il te faut

1. L'URL du site (ex. `https://example.org`) ; le point d'entrée MCP est `{url}/mcp`. En local : `http://localhost:3100/`.
2. Un jeton d'API Strapi à droits limités, créé par la personne.

## Étape 1 : faire créer le jeton

Dis exactement ceci :

> 1. Ouvrez **{url}/strapi/admin** et connectez-vous.
> 2. Roue crantée (Réglages), puis **Jetons d'API**, puis **Créer un nouveau jeton d'API**.
> 3. Nom : `Assistant IA`. Durée : 30 jours. Type : **Personnalisé** (pas « Accès complet »).
> 4. Cochez `find`, `findOne`, `create`, `update` (et `publish` si besoin) sur les types de contenu à gérer. Ne cochez **pas** `delete`. Pour les médias, `find` et `upload`. Ne cochez rien dans la section Espace.
> 5. Enregistrez, puis copiez le jeton tout de suite : il ne sera plus affichable.
>
> Collez-le-moi quand vous l'avez.

## Étape 2 : écrire la configuration

Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` sur macOS, `%APPDATA%\Claude\claude_desktop_config.json` sur Windows), Claude Code (`.mcp.json` à la racine du projet, à ne pas versionner) ou Windsurf (`~/.codeium/windsurf/mcp_config.json`) :

```json
{
  "mcpServers": {
    "jib-cms": {
      "type": "http",
      "url": "{url}/mcp",
      "headers": { "Authorization": "Bearer {jeton}" }
    }
  }
}
```

Cursor : Réglages, MCP Servers, type HTTP, URL `{url}/mcp`, en-tête `Authorization: Bearer {jeton}`.

Si l'outil ne sait pas envoyer d'en-tête personnalisé, il n'est pas compatible : le dire à la personne.

### Transports

| Transport | Usage | Point d'entrée |
|---|---|---|
| Streamable HTTP (recommandé) | Claude Desktop, Claude Code, Cursor, Windsurf | `{url}/mcp` |
| SSE ancien | Clients qui ne gèrent pas Streamable HTTP | `GET {url}/mcp/sse`, puis `POST {url}/mcp/messages?sessionId=<id>` |

Essayer Streamable HTTP d'abord. Dans les deux cas, l'en-tête `Authorization` est obligatoire.

## Étape 3 : conclure

> La configuration est prête. Redémarrez votre outil d'IA, puis demandez « liste les types de contenu » pour vérifier. Le jeton reste dans votre configuration locale.

Vérification : l'outil `list_content_types` doit renvoyer les types. En cas d'erreur d'authentification, faire recopier le jeton en entier ou en créer un nouveau.

## Révoquer l'accès

> Administration ({url}/strapi/admin), Réglages, Jetons d'API, corbeille sur la ligne du jeton. L'accès est coupé immédiatement.
