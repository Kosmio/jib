# 06. Contrat d'API de l'espace participant

Routes personnalisées Strapi sous le préfixe `/api/espace`. JSON, dates ISO 8601 UTC. Authentification par cookie de session (I-22), sauf mention « public ». Toutes les routes vérifient que la ressource appartient à l'édition de la session. Erreurs : `{ "error": { "code": "SLOT_TAKEN", "message": "texte français affichable" } }` avec statut 400, 401, 403, 404, 409 ou 429. Une erreur de validation ajoute `error.fields` (`{ champ: message }`). Une erreur inattendue donne 500 `{ "error": { "code": "INTERNAL", "message", "requestId" } }` et une ligne de journal structurée (NF-50). Chaque réponse porte l'en-tête `X-Request-Id`.

État au 29 octobre 2026 : les routes des sections Authentification (sauf photo et suppression), Édition (`/editions/{slug}` seulement) et Organisateur (synchronisation et créneaux) sont livrées par la phase 1 et décrites telles que le code les sert. Les autres restent le contrat des phases suivantes.

Le developer peut ajuster les chemins aux conventions Strapi découvertes en phase 0, à condition de mettre à jour ce fichier dans le même commit.

## Conventions transverses (décidées en phase 0)

Détail et justification : `docs/espace/journal/phase-0-plan.md`.

- Les routes sont déclarées avec le chemin `/espace/…`, ce qui donne `/api/espace/…` sur Strapi, dans plusieurs fichiers de `strapi/src/api/espace/routes/` que Strapi charge tous (A-20) : `espace.js` (santé, édition, créneaux), `auth.js` (accès, profil), `sync.js` (synchronisation). Toutes portent `auth: false` ; toutes sauf `/health` portent aussi le middleware de route `api::espace.context` : identifiant de requête, contrôle de l'`Origin` des écritures, chargement de la session dans `ctx.state.espace`, conversion des erreurs. Le navigateur les appelle sur `{REACT_STRAPI_URL}/api/espace/…` : `/strapi/api/espace/…` derrière Traefik, `http://localhost:1337/api/espace/…` en local.
- Session : cookie `jib_espace`, posé et lu par Strapi seul (I-22). Le rendu serveur d'Astro relaie l'en-tête `Cookie` reçu ; il ne lit pas le cookie.
- CSRF (NF-04) : toute requête autre que GET et HEAD doit porter un en-tête `Origin` figurant dans `CORS_ORIGINS`, sinon 403 `ORIGIN_REFUSED`. Ce contrôle couvre aussi les formulaires HTML, qui ne peuvent pas ajouter d'en-tête personnalisé.
- Formulaires sans JavaScript (NF-31) : `POST /auth/request-link`, `POST /auth/verify` et `POST /auth/logout` acceptent aussi `application/x-www-form-urlencoded` ; ils répondent alors par une redirection 303 vers la page Astro adaptée au lieu du JSON. L'en-tête `Location` est absolu, construit sur `PUBLIC_URL` : le formulaire a été envoyé à l'origine de Strapi, un chemin relatif y resterait. Cibles retenues en phase 1 : `phase-1-plan.md`, section API.
- `GET /health` (public) → 200 `{ "status": "ok" }` : sonde d'exploitation et test de fumée.

## Authentification

| Méthode | Chemin | Accès | Corps / réponse |
|---|---|---|---|
| POST | `/auth/request-link` | public | `{ editionSlug, email }` → 202 `{ "status": "accepted" }`, que l'adresse soit connue ou non (F-02) ; 400 `EMAIL_INVALID` (format) ; 400 `VALIDATION` si `editionSlug` n'est pas un texte ; 429 `RATE_LIMITED` au-delà de 5 demandes en 15 min par adresse ou par IP (NF-03). Formulaire : 303 vers `/espace/{slug}/connexion?envoye=1`, `?erreur=email` ou `?erreur=trop` |
| GET | `/auth/link?token=…` | public | état d'un lien sans le consommer (A-18) : `{ valid: true, editionSlug }` ; `{ valid: false, editionSlug, email }` pour un lien connu expiré ou utilisé (F-04, formulaire prérempli) ; `{ valid: false, editionSlug }` pour un lien d'un inscrit annulé ou d'une édition fermée (code aligné par le lot 6b) ; `{ valid: false }` pour un lien inconnu. Toujours 200 |
| POST | `/auth/verify` | public | `{ token, next? }` → 200 `{ me, redirect }` et le cookie `jib_espace` ; `redirect` est un chemin : `/espace/{slug}/bienvenue` si `consentAt` est vide, sinon `next` filtré par `safeNextPath` (accueil de l'édition par défaut). 400 `TOKEN_INVALID` (lien inconnu, expiré, déjà utilisé, inscrit annulé, édition fermée). Formulaire : 303 vers la même cible, absolue ; en cas d'échec, 303 vers `/espace/verifier?token=…&next=…` |
| POST | `/auth/logout` | session | 204, même sans session ; supprime la session et efface le cookie. Formulaire (champ caché `editionSlug`) : 303 vers `/espace/{slug}/connexion?deconnecte=1` |
| GET | `/me` | session | phase 1 : `Me` = `{ id, firstName, lastName, jobTitle, company, role, isOrganizer, edition: { slug, title }, consent: { directoryOptIn, meetingsOptIn, newsOptIn, consentAt } }`, `id` étant le `documentId`, sans e-mail ni identifiant HelloAsso. La phase 2 ajoute `profileCompletion`, préférences, photo et compteurs (demandes reçues en attente, messages non lus) |
| PATCH | `/me` | session | phase 1 : `{ firstName?, lastName?, jobTitle?, company? }`, tout autre champ ignoré → `Me` ; 400 `VALIDATION` avec `error.fields` si le profil qui en résulte n'a pas de prénom, de nom ou d'entreprise, ou si un champ dépasse 100 caractères. Un champ modifié s'ajoute à `editedFields` (R-31). La phase 2 l'étend aux champs de E3 |
| POST | `/me/photo` | session | multipart, → `{ photoUrl }` |
| PUT | `/me/consent` | session | `{ directoryOptIn, meetingsOptIn, newsOptIn }`, trois booléens obligatoires → `Me`, `consentAt` = maintenant ; 400 `VALIDATION` |
| DELETE | `/me` | session | anonymisation R-44, 204 |

Session (I-22) : 401 `UNAUTHENTICATED` si le cookie manque, si sa signature est fausse, si la session est expirée ou supprimée, si l'Attendee est annulé ou si l'édition n'est pas publiée et ouverte (NF-52). L'échéance glisse de 30 jours au plus une fois par jour, seulement sur une requête qui peut recevoir le cookie `Secure` (A-25 de `phase-1-plan.md`, code aligné par le lot 6b) : un appel du rendu serveur d'Astro, en http interne, ne la fait pas glisser.

## Édition et programme (public)

| Méthode | Chemin | Accès | Réponse |
|---|---|---|---|
| GET | `/editions/{slug}` | public | `{ slug, title, date, city, venue: { name, address } ou null, themeColor, participantSpaceEnabled, meetingRequestsOpenAt, meetingRequestsCloseAt }` ; `venue` est le premier élément de `lieux`, `themeColor` vaut `hero_bg_color`. 404 `EDITION_NOT_FOUND` si l'édition est absente ou non publiée ; une édition fermée est renvoyée, avec `participantSpaceEnabled: false` |
| GET | `/editions/{slug}/program` | public | sessions triées, `kind`, sujet, intervenants |
| GET | `/editions/{slug}/topics` | public | liste des sujets |

## Annuaire

| Méthode | Chemin | Accès | Réponse |
|---|---|---|---|
| GET | `/directory` | session | paramètres `q`, `type` (all, participant, speaker, exhibitor), `topics` (ids séparés par virgules), `cursor` ; → `{ items: [CarteProfil], nextCursor, total }` |
| GET | `/directory/p/{attendeeId}` | session | FicheProfil (R-42) ; 404 si non visible (R-41) |
| GET | `/directory/x/{exhibitorId}` | session | FicheExposant avec représentants visibles |
| GET | `/suggestions` | session | 0 à 3 CarteProfil (R-50) |

`CarteProfil` : `{ kind: "attendee"|"exhibitor", id, displayName, subtitle, photoUrl, initials, tag, topics[] }`.

## Créneaux et rendez-vous

| Méthode | Chemin | Accès | Réponse |
|---|---|---|---|
| GET | `/slots?target=p:{id}` ou `x:{id}` | session | créneaux groupés par pause : `[{ session: { id, title, start, end }, slots: [{ id, label, startsAt, state: "available"|"unavailable"|"requested" }] }]` (R-12) |
| POST | `/meetings` | session | `{ slotId, target: "p:{id}"|"x:{id}", message? }` → 201 Meeting ; 409 codes R-11 |
| GET | `/meetings` | session | `{ received: [], sent: [], agenda: [] }` ; `agenda` mêle sessions et rendez-vous acceptés ou en attente, trié par heure |
| POST | `/meetings/{id}/accept` | session (cible ou représentant) | → Meeting avec `location` |
| POST | `/meetings/{id}/decline` | session (cible) | `{ reason? }` |
| POST | `/meetings/{id}/counter` | session (cible) | `{ slotId, message? }` → nouvelle demande (F-62) |
| POST | `/meetings/{id}/cancel` | session (partie prenante) | `{ reason? }` |
| GET | `/meetings.ics` | session | fichier text/calendar (I-40) |

`Meeting` exposé : `{ id, status, slot: { label, startsAt }, location, counterpart: CarteProfil, direction: "sent"|"received", message, canAccept, canDecline, canCancel }`. Les booléens `can*` sont calculés par le serveur ; le front ne recalcule aucune règle.

## Messagerie

| Méthode | Chemin | Accès | Réponse |
|---|---|---|---|
| GET | `/conversations` | session | liste avec dernier message, non-lus |
| POST | `/conversations` | session | `{ with: "p:{id}" }` → conversation existante ou créée (R-61) |
| GET | `/conversations/{id}/messages?after={iso}` | session | messages, marque comme lus |
| POST | `/conversations/{id}/messages` | session | `{ body }` → 201 ; 429 si R-64 |

## Organisateur

| Méthode | Chemin | Accès | Réponse |
|---|---|---|---|
| GET | `/admin/{edition}/stats` | organisateur | indicateurs de E9 |
| POST | `/admin/{edition}/sync` | organisateur | lance I-12 et attend la fin → SyncRun clos `{ id, startedAt, endedAt, created, updated, cancelled, errors }` ; 409 `SYNC_RUNNING` si une synchronisation de l'édition est ouverte depuis moins de 15 minutes (A-16) ; 404 `EDITION_NOT_FOUND`. Une édition sans formulaire HelloAsso renseigné, ou un Strapi sans `HELLOASSO_*`, donne un SyncRun clos avec l'erreur `HELLOASSO_NOT_CONFIGURED` |
| GET | `/admin/{edition}/sync-runs` | organisateur | les 10 derniers SyncRun, même forme, du plus récent au plus ancien |
| POST | `/admin/{edition}/slots/regenerate` | organisateur | R-02 → `{ created, kept, removed, orphans: [{ id, label, activeMeetings }], warnings: [{ sessionDocumentId, title, code }] }`, codes `MISSING_END`, `INVALID_TIME`, `TOO_SHORT`, `OVERLAP` ; 409 `EDITION_DATE_MISSING` si l'édition publiée n'a pas de date |
| GET | `/admin/{edition}/export/{participants,meetings,exhibitors,stats}.csv` | organisateur | F-91 |
| POST | `/admin/{edition}/reminders/preview` | organisateur | `{ scenario }` → `{ recipients, sampleHtml }` |
| POST | `/admin/{edition}/reminders/send` | organisateur | `{ scenario }` → `{ sent, skipped }` (R-71) |

Accès organisateur : session valable (section Authentification) dont l'Attendee a le rôle `organizer` ou une adresse de `ORGANIZER_EMAILS`, et dont l'édition est celle de l'URL ; sinon 401 `UNAUTHENTICATED` ou 403 `FORBIDDEN`. Conséquence de NF-52 : tant que l'espace d'une édition est fermé, aucun organisateur ne peut s'y connecter ni appeler ces routes (la tâche planifiée synchronise quand même, A-17).

`SyncRun.errors` : liste d'objets `{ itemId?, code, email?, attendeeDocumentId?, status? }`. Codes :

| Code | Sens |
|---|---|
| `DUPLICATE_EMAIL` | billet actif dont l'adresse appartient déjà à un Attendee de l'édition, ou à un billet de plus petit `id` (I-14) ; `email` donné pour l'arbitrage |
| `EMAIL_TAKEN` | même cas, découvert au contrôle sous verrou (un Attendee créé entre-temps) ; `attendeeDocumentId` donné. La synchronisation suivante le signale en `DUPLICATE_EMAIL` |
| `INVALID_EMAIL` | billet actif sans aucune adresse valable, ni dans le champ e-mail ni chez le payeur (I-11) |
| `WAITING`, `UNKNOWN` | billet en attente, ignoré jusqu'au changement d'état (Q-15) |
| `APPLY_FAILED` | billet dont l'écriture a échoué ; les autres sont traités |
| `FETCH_FAILED` | HelloAsso injoignable ou en erreur ; `status` HTTP ou `null` |
| `HELLOASSO_NOT_CONFIGURED` | voir la route `sync` |
| `INTERNAL` | erreur inattendue ; le SyncRun est clos quand même |

## Webhook

| Méthode | Chemin | Accès | Réponse |
|---|---|---|---|
| POST | `/webhooks/helloasso` | public, vérification par resynchronisation (I-13) | 200 toujours après mise en file |

## Tâches planifiées (cron Strapi)

| Tâche | Fréquence | Règle |
|---|---|---|
| Synchronisation HelloAsso (`espaceSync`, livrée) | toutes les 15 min | I-12 ; toute édition publiée dont `helloassoOrgSlug` et `helloassoFormSlug` sont renseignés, espace ouvert ou non (A-17) |
| Expiration des demandes | 5 min | R-17 |
| Notifications de messages | 5 min | R-62 |
| Relances | 9h30 et 16h00 Europe/Paris | R-70, R-72 |
| Purge des jetons (`espaceTokenPurge`, livrée ; délai de grâce au lot 6b) | 4h00 Europe/Paris | I-20 ; MagicToken dont `expiresAt` est passé depuis plus de 7 jours, par `services/tokens.js` (A-21) : un lien expiré la veille garde l'état « expiré, adresse préremplie » de A-18 |

Les tâches sont déclarées dans `strapi/config/cron-tasks.js` et ne sont enregistrées qu'avec `CRON_ENABLED=true`. Chacune appelle un service, sans logique propre ; une erreur est journalisée et ne fait jamais tomber Strapi.
