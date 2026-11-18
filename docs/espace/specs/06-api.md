# 06. Contrat d'API de l'espace participant

Routes personnalisées Strapi sous le préfixe `/api/espace`. JSON, dates ISO 8601 UTC. Authentification par cookie de session (I-22), sauf mention « public ». Toutes les routes vérifient que la ressource appartient à l'édition de la session. Erreurs : `{ "error": { "code": "SLOT_TAKEN", "message": "texte français affichable" } }` avec statut 400, 401, 403, 404, 409 ou 429. Une erreur de validation ajoute `error.fields` (`{ champ: message }`). Une erreur inattendue donne 500 `{ "error": { "code": "INTERNAL", "message", "requestId" } }` et une ligne de journal structurée (NF-50). Chaque réponse porte l'en-tête `X-Request-Id`.

État au 29 octobre 2026 : les routes des sections Authentification (sauf photo et suppression), Édition (`/editions/{slug}` seulement) et Organisateur (synchronisation et créneaux) sont livrées par la phase 1 et décrites telles que le code les sert. Les autres restent le contrat des phases suivantes.

Finalisation (18 novembre 2026) : les routes nouvelles ou modifiées par les lots V1-B à V5-G (`14-lots-finalisation.md`) sont reportées ici d'après le code, dans les sections ci-dessous et dans la section « Pilotage (finalisation) ». Les routes de V5-E (flux calendrier, webhook), encore à intégrer au moment du report, sont décrites d'après leur contrat. Pour ces lots, ce fichier fait foi sur `phase-2-plan.md`.

Le developer peut ajuster les chemins aux conventions Strapi découvertes en phase 0, à condition de mettre à jour ce fichier dans le même commit.

Phases 2 et 3 (30 octobre 2026) : les formes de `/me`, de l'annuaire, des créneaux, des rendez-vous, de la messagerie, du programme et des statistiques, ainsi que les codes d'erreur ajoutés (`SLOT_PAST`, `SLOT_NOT_FOUND`, `TARGET_NOT_FOUND`, `MEETING_NOT_FOUND`, `PROFILE_NOT_FOUND`, `INVALID_TRANSITION`, `COUNTER_UNAVAILABLE`, `PHOTO_INVALID`, `PHOTO_TOO_LARGE`), sont fixées par `docs/espace/journal/phase-2-plan.md`, section 3, qui prime sur les tableaux ci-dessous jusqu'à leur report ici par l'architecte. Les developers ne modifient pas ce fichier pendant ces lots : ils signalent tout écart dans leur compte rendu.

## Conventions transverses (décidées en phase 0)

Détail et justification : `docs/espace/journal/phase-0-plan.md`.

- Les routes sont déclarées avec le chemin `/espace/…`, ce qui donne `/api/espace/…` sur Strapi, dans plusieurs fichiers de `strapi/src/api/espace/routes/` que Strapi charge tous (A-20) : `espace.js` (santé, édition, créneaux), `auth.js` (accès, profil), `sync.js` (synchronisation). Toutes portent `auth: false` ; toutes sauf `/health` portent aussi le middleware de route `api::espace.context` : identifiant de requête, contrôle de l'`Origin` des écritures, chargement de la session dans `ctx.state.espace`, conversion des erreurs. Le navigateur les appelle sur `{REACT_STRAPI_URL}/api/espace/…` : `/strapi/api/espace/…` derrière Traefik, `http://localhost:1337/api/espace/…` en local.
- Session : cookie `jib_espace`, posé et lu par Strapi seul (I-22). Le rendu serveur d'Astro relaie l'en-tête `Cookie` reçu ; il ne lit pas le cookie.
- CSRF (NF-04) : toute requête autre que GET et HEAD doit porter un en-tête `Origin` figurant dans `CORS_ORIGINS`, sinon 403 `ORIGIN_REFUSED`. Ce contrôle couvre aussi les formulaires HTML, qui ne peuvent pas ajouter d'en-tête personnalisé.
- Formulaires sans JavaScript (NF-31) : `POST /auth/request-link`, `POST /auth/verify` et `POST /auth/logout` acceptent aussi `application/x-www-form-urlencoded` ; ils répondent alors par une redirection 303 vers la page Astro adaptée au lieu du JSON. L'en-tête `Location` est absolu, construit sur `PUBLIC_URL` : le formulaire a été envoyé à l'origine de Strapi, un chemin relatif y resterait. Cibles retenues en phase 1 : `phase-1-plan.md`, section API.
- `GET /health` (public) → 200 `{ "status": "ok" }` : sonde d'exploitation et test de fumée.
- Lecture seule (NF-70, V4-F) : une fois passé `readOnlyAt` de l'édition (à défaut, sa date plus sept jours, calculée et jamais stockée), toute écriture (méthode autre que GET et HEAD) d'une session de cette édition répond 409 `EDITION_READ_ONLY`. Exemptions : `/auth/*`, `/admin/*` (pilotage et exports), `POST /me/erase` (R-44), et `PATCH /me` dont le corps ne porte que `emailPrefs`. Les envois de relances et de `welcome` répondent aussi 409 `EDITION_READ_ONLY`. La carte de badge et le désabonnement ne passent pas par cette garde (la carte répond 404 en lecture seule, R-83).
- Espace fermé (F-103, V1-B) : sur une édition dont `participantSpaceEnabled` est faux, la session d'un organisateur est chargée, mais elle n'ouvre que `/admin/*` et `GET /me` ; toute autre route répond 403 `FORBIDDEN` (« L'espace de cette édition est fermé. »). La session d'un participant d'un espace fermé n'est chargée que pour `POST /me/erase` et `GET /me/export` (R-44, NF-12, V5-A).
- Jetons hors des journaux (NF-55) : les routes qui portent un jeton dans l'URL (`/auth/link`, `/reminders/unsubscribe`, `/cards/…`, `/calendar/…`) réécrivent `ctx.url` avant la réponse, pour que `strapi::logger` n'écrive pas le jeton. Le journal d'accès de Traefik, lui, n'est pas couvert : voir `docs/espace/exploitation.md`.
- Adresse IP du client : `ctx.request.ip`, dernière entrée de `X-Forwarded-For` quand `IS_PROXIED=true` (`proxy.koa`, `maxIpsCount: 1`). Le rendu serveur d'Astro, qui appelle Strapi en interne, transmet l'IP du visiteur dans `X-Forwarded-For` quand une limite par IP s'applique (page carte, NF-54).

## Authentification

| Méthode | Chemin | Accès | Corps / réponse |
|---|---|---|---|
| POST | `/auth/request-link` | public | `{ editionSlug, email, next? }` → 202 `{ "status": "accepted" }`, que l'adresse soit connue ou non (F-02) ; 400 `EMAIL_INVALID` (format) ; 400 `VALIDATION` si `editionSlug` n'est pas un texte ; 429 `RATE_LIMITED` au-delà de 5 demandes en 15 min par adresse ou de `LINK_RATE_IP_MAX` (60 par défaut) par IP (NF-03, NF-61, D-16). `next` (F-102) est filtré par `safeNextPath` : gardé s'il reste dans `/espace/{slug}/`, porté par le lien envoyé. Un organisateur obtient un lien même sur un espace fermé (F-103). Formulaire : 303 vers `/espace/{slug}/connexion?envoye=1`, `?erreur=email` ou `?erreur=trop`, avec `next` s'il est plus profond que l'accueil ; l'adresse saisie est rappelée par le cookie éphémère `jib_espace_sent`, jamais par l'URL (F-102) |
| GET | `/auth/link?token=…` | public | état d'un lien sans le consommer (A-18) : `{ valid: true, editionSlug }` ; `{ valid: false, editionSlug, email }` pour un lien connu expiré ou utilisé (F-04, formulaire prérempli) ; `{ valid: false, editionSlug }` pour un lien d'un inscrit annulé ou d'une édition fermée (code aligné par le lot 6b) ; `{ valid: false }` pour un lien inconnu. Toujours 200 |
| POST | `/auth/verify` | public | `{ token, next? }` → 200 `{ me, redirect }` et le cookie `jib_espace` ; `redirect` est un chemin : `/espace/{slug}/organisateur` si l'espace est fermé (organisateur, F-103), sinon `/espace/{slug}/bienvenue` si `consentAt` est vide, sinon `next` filtré par `safeNextPath` (accueil de l'édition par défaut). 400 `TOKEN_INVALID` (lien inconnu, expiré, déjà utilisé, inscrit annulé, édition fermée). Formulaire : 303 vers la même cible, absolue ; en cas d'échec, 303 vers `/espace/verifier?token=…&next=…` |
| POST | `/auth/verify-code` | public | I-44, F-142, D-17 (V3-G). `{ editionSlug, email?, code, next? }` ; l'adresse vient du corps ou, à défaut, du cookie `jib_espace_sent`. Code à six chiffres de l'e-mail `access-link`, espaces et tirets tolérés, valable 30 min, lié au lien de la même demande : le code et le lien ne peuvent pas ouvrir tous deux une session. → même réponse que `/auth/verify` (200 `{ me, redirect }` et cookie). 400 `CODE_INVALID`, identique pour une adresse inconnue, un code faux ou épuisé (F-02) ; cinq essais faux invalident les codes de l'adresse ; 429 `RATE_LIMITED` au-delà de 30 essais par IP ou 10 par adresse en 15 min. Formulaire : 303 vers la cible, ou vers `/espace/{slug}/connexion?envoye=1&erreur=code` (ou `erreur=trop`) |
| POST | `/auth/logout` | session | 204, même sans session ; supprime la session et efface le cookie. Formulaire (champ caché `editionSlug`) : 303 vers `/espace/{slug}/connexion?deconnecte=1` |
| GET | `/me` | session | phase 3 (V5-D) : `Me` complet porte aussi `lookingFor`, `offering` et `phone` (les siens). Phase 1 : `Me` = `{ id, firstName, lastName, jobTitle, company, role, isOrganizer, edition: { slug, title }, consent: { directoryOptIn, meetingsOptIn, newsOptIn, consentAt } }`, `id` étant le `documentId`, sans e-mail ni identifiant HelloAsso. La phase 2 ajoute `profileCompletion`, préférences, photo et compteurs (demandes reçues en attente, messages non lus) |
| PATCH | `/me` | session | phase 1 : `{ firstName?, lastName?, jobTitle?, company? }`, tout autre champ ignoré → `Me` ; 400 `VALIDATION` avec `error.fields` si le profil qui en résulte n'a pas de prénom, de nom ou d'entreprise, ou si un champ dépasse 100 caractères. Un champ modifié s'ajoute à `editedFields` (R-31). La phase 2 l'étend aux champs de E3 ; V5-D ajoute `lookingFor` et `offering` (300 caractères) et `phone` (30 caractères, format libre, caractères de contrôle retirés, `null` ou vide l'efface). En lecture seule, seul un corps limité à `emailPrefs` est admis |
| POST | `/me/photo` | session | multipart, champ `photo`, → `Me` avec `photoUrl` ; 400 `PHOTO_INVALID`, `PHOTO_TOO_LARGE` |
| DELETE | `/me/photo` | session | F-147 (V4-B) : retire la photo → `{ photoUrl: null }` |
| PUT | `/me/consent` | session | `{ directoryOptIn, meetingsOptIn, newsOptIn }`, trois booléens obligatoires → `Me`, `consentAt` = maintenant ; 400 `VALIDATION` |
| POST | `/me/erase` | session, espace fermé ou lecture seule compris | F-33, R-44 (V5-A). `{ confirm: true }` → 200 `{ erased: true }`, session close et cookie effacé. Rendez-vous à venir annulés avec notification, puis anonymisation (prénom « Participant », nom « supprimé », champs de profil, photo, LinkedIn, sujets et préférences vidés, visibilité à faux, statut `cancelled`, e-mail remplacé par une adresse technique), empreinte de l'adresse dans `erased-email`, jetons supprimés. Idempotent. 400 `VALIDATION` (`fields.confirm`) sans `confirm: true`. Remplace le `DELETE /me` prévu |
| GET | `/me/export` | session, espace fermé compris | NF-12 (V5-A) : fichier JSON `mes-donnees-{slug}.json` (`Content-Disposition: attachment`, `no-store`) : profil, préférences, rendez-vous avec interlocuteur, créneau et table, messages envoyés. Des autres participants ne sortent que prénom, nom et entreprise |
| POST | `/me/calendar-feed` | session | I-42 (V5-E) : crée le flux d’abonnement calendrier → 201 `{ path, createdAt }` ; `path` contient le jeton en clair, affiché une seule fois (`webcal://` et copie) |
| DELETE | `/me/calendar-feed` | session | I-42 (V5-E) : révoque le flux actif → 200 `{ revoked }` |

Session (I-22) : 401 `UNAUTHENTICATED` si le cookie manque, si sa signature est fausse, si la session est expirée ou supprimée, si l'Attendee est annulé ou si l'édition n'est pas publiée et ouverte (NF-52), sous les exceptions d'espace fermé de la section Conventions (F-103, R-44). Côté front, une réponse 401 reçue par un îlot renvoie vers `/espace/{slug}/connexion?next=<page>&expire=1` (F-104). L'échéance glisse de 30 jours au plus une fois par jour, seulement sur une requête qui peut recevoir le cookie `Secure` (A-25 de `phase-1-plan.md`, code aligné par le lot 6b) : un appel du rendu serveur d'Astro, en http interne, ne la fait pas glisser.

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
| GET | `/directory/p/{attendeeId}` | session | FicheProfil (R-42) ; 404 si non visible (R-41). V5-D : la fiche porte `lookingFor` et `offering` quand elle est complète ; la clé `phone` n'existe que pour soi et pour l'interlocuteur d'un rendez-vous **accepté** (à un stand : tout représentant de l'exposant ciblé), jamais ailleurs (R-42 amendé). L'agenda lit le téléphone par cette route |
| GET | `/directory/x/{exhibitorId}` | session | FicheExposant avec représentants visibles |
| GET | `/suggestions` | session | 0 à 3 CarteProfil (R-50, étendu par V5-D aux mots communs entre « Je cherche » et « Je propose ») |

`CarteProfil` : `{ kind: "attendee"|"exhibitor", id, displayName, subtitle, photoUrl, initials, tag, topics[] }`. L'annuaire ne liste jamais la personne connectée (F-144, V4-A).

## Créneaux et rendez-vous

| Méthode | Chemin | Accès | Réponse |
|---|---|---|---|
| GET | `/slots?target=p:{id}` ou `x:{id}` | session | créneaux groupés par pause : `[{ session: { id, title, start, end }, slots: [{ id, label, startsAt, state: "available"|"unavailable"|"requested" }] }]` (R-12) |
| POST | `/meetings` | session | `{ slotId, target: "p:{id}"|"x:{id}", message? }` → 201 Meeting ; 409 codes R-11, et `SLOT_CLOSED` sur un créneau fermé par l'organisation (R-90). Les tables bloquées (`blockedTables`) comptent comme occupées |
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
| POST | `/conversations/{id}/messages/{messageId}/report` | session | F-75 (V5-B) : `{ reason }` (texte non vide, 500 caractères au plus) → 201 `{ id, status }` ; les organisateurs actifs reçoivent l'e-mail `message-report`, sans le contenu. 400 `VALIDATION` (`fields.reason`) ; 404 `MESSAGE_NOT_FOUND` sauf pour un message reçu dans une de ses conversations ; 409 `ALREADY_REPORTED` au second signalement du même message par la même personne |

## Organisateur

| Méthode | Chemin | Accès | Réponse |
|---|---|---|---|
| GET | `/admin/{edition}/stats` | organisateur | indicateurs de E9 |
| POST | `/admin/{edition}/sync` | organisateur | lance I-12 et attend la fin → SyncRun clos `{ id, startedAt, endedAt, created, updated, cancelled, errors }` ; 409 `SYNC_RUNNING` si une synchronisation de l'édition est ouverte depuis moins de 15 minutes (A-16) ; 404 `EDITION_NOT_FOUND`. Une édition sans formulaire HelloAsso renseigné, ou un Strapi sans `HELLOASSO_*`, donne un SyncRun clos avec l'erreur `HELLOASSO_NOT_CONFIGURED` |
| GET | `/admin/{edition}/sync-runs` | organisateur | les 10 derniers SyncRun, même forme, du plus récent au plus ancien |
| POST | `/admin/{edition}/slots/regenerate` | organisateur | `?dryRun=true` (F-122, V2-D) : même rapport, rien n'est écrit, `dryRun: true` dans la réponse. R-02 → `{ created, kept, removed, orphans: [{ id, label, activeMeetings }], warnings: [{ sessionDocumentId, title, code }] }`, codes `MISSING_END`, `INVALID_TIME`, `TOO_SHORT`, `OVERLAP` ; 409 `EDITION_DATE_MISSING` si l'édition publiée n'a pas de date |
| GET | `/admin/{edition}/export/{participants,meetings,exhibitors,stats}.csv` | organisateur | F-91, F-123 (V2-D) : `text/csv; charset=utf-8`, nom de fichier avec l'édition et la date (`participants-<slug>-AAAA-MM-JJ.csv`), colonnes `Actualités des prochaines éditions`, `Activé le`, `Dernière connexion`, `Statut`, annulés en fin de fichier. 404 `EXPORT_NOT_FOUND`. Sans session et avec `Accept: text/html` : 303 vers `/espace/{slug}/connexion?next=/espace/{slug}/organisateur&expire=1` |
| POST | `/admin/{edition}/reminders/preview` | organisateur | V3-A, F-92. `{ scenario: "profile"|"no-meeting"|"eve"|"welcome" }` → `{ recipients, skipped: { alreadySent, optedOut }, sampleHtml }` ; 400 `VALIDATION` pour un autre scénario |
| POST | `/admin/{edition}/reminders/send` | organisateur | `{ scenario }` → `{ sent, skipped, failed }` (R-71 : clé `<scénario>:<date du jour>`) ; 409 `OUTSIDE_SENDING_HOURS` hors de 8h00 à 20h00 heure de Paris (R-72), 409 `REMINDERS_RUNNING` si un envoi est en cours, 409 `EDITION_READ_ONLY` |

Accès organisateur : session valable (section Authentification) dont l'Attendee a le rôle `organizer` ou une adresse de `ORGANIZER_EMAILS`, et dont l'édition est celle de l'URL ; sinon 401 `UNAUTHENTICATED` ou 403 `FORBIDDEN` (un organisateur d'une autre édition compris). Depuis V1-B (F-103), un organisateur se connecte et appelle ces routes même quand l'espace de l'édition est fermé ; la règle « aucun organisateur sur un espace fermé » de la phase 1 est levée. Une édition absente ou non publiée donne 404 `EDITION_NOT_FOUND`. Toutes ces routes restent ouvertes en lecture seule (NF-70).

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

Depuis V2-D (F-121), les erreurs `DUPLICATE_EMAIL` et `EMAIL_TAKEN` renvoyées par `sync` et `sync-runs` portent aussi `holderName`, prénom et nom de l'Attendee de l'édition qui détient déjà l'adresse. Depuis V5-A, un billet dont l'adresse a une empreinte d'effacement est ignoré sans erreur rouge (information « effacé à la demande »).

## Pilotage (finalisation)

Routes ajoutées par les lots V1-C, V3-E, V3-F, V4-D, V5-A, V5-B et V5-C, toutes sous `/api/espace`, avec le middleware de contexte. Accès « organisateur » : celui de la section précédente. Les identifiants sont des `documentId`.

### Ouverture et état du service (V1-C)

| Méthode | Chemin | Accès | Corps / réponse |
|---|---|---|---|
| POST | `/admin/{edition}/welcome/preview` | organisateur | F-105 → `{ recipients, sampleHtml }` : actifs non organisateurs sans `welcome` envoyé, aperçu rendu pour un prénom d'exemple |
| POST | `/admin/{edition}/welcome/send` | organisateur | F-105, R-85 → `{ sent, failed, startedAt }` ; pose `welcomeStartedAt` s'il est vide, puis invite tous les inscrits en attente, abandonnés compris. 409 `OUTSIDE_SENDING_HOURS` (hors 8h00 à 20h00, Paris), 409 `WELCOME_RUNNING`, 409 `EDITION_READ_ONLY`. Un second appel renvoie `sent: 0` |
| GET | `/admin/{edition}/service` | organisateur | F-106 → `{ mail: { provider, senderConfigured, failedLast24h, lastError, abandoned: [{ email, error }] }, helloasso: { configured, lastRunStatus: "ok"|"error"|"running"|null, lastRunAt }, cron: { enabled }, space: { enabled, welcomeStartedAt } }` |

### Participants (V3-E, V5-A)

| Méthode | Chemin | Accès | Corps / réponse |
|---|---|---|---|
| GET | `/admin/{edition}/attendees` | organisateur | F-134. Paramètres `q` (nom, entreprise, e-mail, sans accents ni casse), `role`, `activated`, `visible`, `status`, `page`, `sort` (`name` ou `lastSeen`) → `{ items, total, page, pageSize, pages }`. Ligne : `{ id, firstName, lastName, email, company, jobTitle, role, status, activated, lastSeenAt, directoryOptIn, manual }`, sans téléphone ni message. 400 `VALIDATION` sur un filtre non valable |
| GET | `/admin/{edition}/attendees/{id}` | organisateur | F-135 → fiche : la ligne, plus `importedAt`, `source` (`helloasso` ou `manual`), `activatedAt`, `statusLockedAt`, `consent`, `meetings: { total, pending, accepted }`, `emails` (dix derniers : `template`, `sentAt`, `status`, `error`). 404 `ATTENDEE_NOT_FOUND` |
| POST | `/admin/{edition}/attendees` | organisateur | F-136 : `{ firstName, lastName, email, company?, jobTitle?, role }` → 201 fiche ; e-mail en minuscules. 400 `VALIDATION`, 409 `EMAIL_TAKEN`. Le `welcome` part selon R-85 |
| PATCH | `/admin/{edition}/attendees/{id}` | organisateur | F-137, R-89 : champs parmi prénom, nom, fonction, entreprise, e-mail, rôle → fiche ; les champs corrigés entrent dans `editedFields`. 400 `VALIDATION`, 409 `EMAIL_TAKEN`, 409 `SELF_FORBIDDEN` (son propre rôle) |
| POST | `/admin/{edition}/attendees/{id}/link` | organisateur | F-135 : nouveau lien de connexion, hors limite par IP, 3 par heure et par inscrit → `{ status: "sent"|"failed", error, remaining }`. 409 `ATTENDEE_CANCELLED`, 409 `SPACE_CLOSED`, 429 `RATE_LIMITED` |
| POST | `/admin/{edition}/attendees/{id}/cancel` | organisateur | F-138, R-89 : rendez-vous annulés avec notification (R-18), statut `cancelled`, `statusLockedAt` posé → fiche. Idempotent. 409 `SELF_FORBIDDEN` |
| POST | `/admin/{edition}/attendees/{id}/restore` | organisateur | F-138 : statut `active`, rendez-vous non restaurés, verrou conservé → fiche |
| POST | `/admin/{edition}/attendees/{id}/erase` | organisateur | F-33, R-44 (V5-A) : même effacement que `/me/erase` → fiche de l'inscrit anonymisé. 404 `ATTENDEE_NOT_FOUND`, 409 `SELF_FORBIDDEN` (passer par son profil) |

### Rendez-vous et blocages (V3-F)

| Méthode | Chemin | Accès | Corps / réponse |
|---|---|---|---|
| GET | `/admin/{edition}/meetings` | organisateur | F-139 → `{ tablesCount, dedicatedTables, slots: [{ id, label, startsAt, endsAt, sessionTitle, closed, blockedTables, freeTables }], meetings: [{ id, status, slot, requester, target, location, tableNumber, createdAt, conflict, canCancel, canMove, freeTables }] }`. Parties : `{ kind, name, subtitle }`, jamais d'e-mail. `conflict` : rendez-vous accepté sur un créneau fermé ou une table bloquée |
| POST | `/admin/{edition}/meetings/{id}/cancel` | organisateur | F-140 : `{ reason? }` → `{ id, status }` ; les deux parties reçoivent `meeting-cancelled` « annulé par l'organisation », table libérée. 404 `MEETING_NOT_FOUND`, 409 `INVALID_TRANSITION`, `SLOT_PAST` |
| POST | `/admin/{edition}/meetings/{id}/move` | organisateur | F-141 : `{ table }` (entier) → `{ id, status, location, tableNumber }`, vers une table libre, non bloquée, non dédiée, du même créneau. Aucun e-mail (dette). 400 `VALIDATION`, 404, 409 `INVALID_TRANSITION`, `SLOT_PAST`, `SLOT_CLOSED`, `NO_TABLE_LEFT` |
| PUT | `/admin/{edition}/slots/{id}/blocks` | organisateur | F-141, R-90 : `{ blockedTables: number[], closed: boolean }`, tables de 1 à `tablesCount` → `{ id, blockedTables, closed, affected: [id des rendez-vous acceptés touchés] }`. 400 `VALIDATION`, 404 `SLOT_NOT_FOUND` |

### Badges et carte (V4-D1, `12-badges.md`)

| Méthode | Chemin | Accès | Corps / réponse |
|---|---|---|---|
| POST | `/admin/{edition}/badges` | organisateur | F-97 : `{ types?: string[], sort?: "name"|"company" }` → `application/pdf` (`attachment`, `no-store`), une page A4 pliée par Attendee actif, en-têtes `X-Badges-Count` et `X-Badges-Reduced` (exposés par CORS). 400 `VALIDATION`, 404 `NO_BADGES` |
| GET | `/admin/{edition}/attendees/{id}/badge` | organisateur | F-98 : PDF d'un seul badge. 404 `ATTENDEE_NOT_FOUND`. Sans session et avec `Accept: text/html` : 303 vers la connexion, comme les exports |
| POST | `/admin/{edition}/attendees/{id}/card-token/regenerate` | organisateur | F-98, R-83 → `{ regeneratedAt }` ; l'ancien jeton cesse aussitôt, le badge est à réimprimer |
| GET | `/cards/{edition}/{token}` | public | F-95, R-80 à R-84 → `{ edition: { slug, title, date, city, themeColor }, card }`. Profil visible ayant ouvert son espace : `card` porte les champs de R-42 (`photoUrl`, `bio`, `topics`, `standNumber` d'un exposant), jamais l'e-mail ni le téléphone, `reduced: false`. Sinon carte réduite (prénom, nom, fonction, entreprise, type), `reduced: true`. 404 `CARD_NOT_FOUND` uniforme (jeton faux, révoqué, Attendee annulé, espace fermé, édition en lecture seule) ; 429 `RATE_LIMITED` au-delà de 30 requêtes par minute et par IP (NF-54). En-têtes `no-store`, `Referrer-Policy: strict-origin`, `X-Robots-Tag: noindex`. Appelée par la page `/espace/{slug}/carte/{token}`, qui transmet l'IP du visiteur |

### Signalements (V5-B)

| Méthode | Chemin | Accès | Corps / réponse |
|---|---|---|---|
| GET | `/admin/{edition}/reports` | organisateur | R-63 → `{ open, handled }`, du plus récent au plus ancien ; chaque signalement : `{ id, status, at, handledAt, reason, reporter: { name }, reported: { name }, message: { body } }`. Le texte du message signalé est le seul contenu de message exposé |
| POST | `/admin/{edition}/reports/{id}/handle` | organisateur | → `{ id, status: "handled", handledAt }` ; un signalement déjà traité garde sa date. 404 `REPORT_NOT_FOUND` |

### Plusieurs éditions (V5-C)

| Méthode | Chemin | Accès | Corps / réponse |
|---|---|---|---|
| GET | `/admin/editions` | session d'organisateur | éditions publiées que la personne peut piloter (adresse de `ORGANIZER_EMAILS` : toutes ; sinon celles où elle a un Attendee `organizer` de même adresse) → `[{ slug, title, date, city, current }]`. 403 `FORBIDDEN` pour un participant |
| POST | `/admin/{edition}/switch` | organisateur de la cible | ouvre une session pour l'édition cible sans nouveau lien, révoque la précédente, remplace le cookie → 303 vers `/espace/{edition}/organisateur` (formulaire sans JavaScript). 403 `FORBIDDEN`, 404 `EDITION_NOT_FOUND`, 400 `INSECURE_REQUEST` si le cookie `Secure` ne peut pas être posé (A-25) |
| POST | `/admin/{edition}/duplicate` | organisateur du modèle | `{ title, slug, date }` → 201 `{ slug }` : édition en brouillon avec les réglages de l'espace, les sujets et les séquences en brouillon ; ni participant, ni exposant, ni rendez-vous, ni formulaire HelloAsso, espace fermé. 400 `VALIDATION`, 409 `SLUG_TAKEN` |

### Interface organisation (AD-1 à AD-4, `15-administration.md`)

Toutes réservées à l'organisateur de l'édition (NF-71) ; les écritures refusent une édition en lecture seule (409 `EDITION_READ_ONLY`). Une écriture qui porte `updatedAt` est refusée par 409 `STALE` si l'objet a changé depuis (NF-75). Un refus des gardes de l'administration (NF-63, NF-64) répond 409 `REFUSED`.

| Méthode | Chemin | Corps / réponse |
|---|---|---|
| GET | `/admin/{edition}/settings` | `{ id, updatedAt, readOnly, attendees, general, helloasso: { orgSlug, formType, formSlug, fieldMap, credentials, syncs }, space: { participantSpaceEnabled, b2bEnabled, tablesCount, slotDurationMinutes, meetingRequestsOpenAt, meetingRequestsCloseAt, checklist }, sequences }` ; aucun secret (D-21) |
| PATCH | `/admin/{edition}/settings` | champs de `general`, `helloasso*`, `space` (noms de l'API : `inscriptionUrl`, `helloassoFieldMap`…), `updatedAt`, `confirmFormChange` → les réglages ; l'édition est publiée. 400 `VALIDATION` `{ fields }`, 409 `FORM_CHANGE_CONFIRM` (R-92) |
| POST | `/admin/{edition}/helloasso/test` | `{ orgSlug, formType, formSlug }` → `{ title, totalCount, fieldNames, suggestedFieldMap }`, rien n'est importé (I-45). 409 `HELLOASSO_CREDENTIALS_MISSING`, 404 `HELLOASSO_FORM_NOT_FOUND`, 409 `HELLOASSO_ACCESS_DENIED`, 502 `HELLOASSO_UNREACHABLE` |
| PATCH | `/admin/{edition}/sequences/{id}/break` | `{ isBreak, updatedAt }` : pause B2B ou non, publiée tout de suite → les réglages. 409 `BREAK_TIMES_MISSING` (R-86), `BREAK_HAS_MEETINGS` (R-93) |
| GET | `/admin/{edition}/program` | programme en brouillon : `{ sequences: [{ …, state, interventions: [{ …, speakers }] }], changes }`, `state` vaut `new`, `modified` ou `published` |
| POST | `/admin/{edition}/program/publish` | publie intervenants, séquences puis interventions nouveaux ou modifiés (D-22) → `{ published, breaksChanged, program }` |
| POST, PATCH, DELETE | `/admin/{edition}/sequences`, `/sequences/{id}` | F-160 ; PATCH accepte `move` (`up` ou `down`) (même heure, F-161). 409 `BREAK_HAS_MEETINGS` (R-93, R-94) ; la suppression est immédiate et emporte les interventions |
| POST, PATCH, DELETE | `/admin/{edition}/sequences/{id}/interventions`, `/interventions/{id}` | `{ description, speakers: [documentId], move, updatedAt }` (F-161, F-162) |
| POST, PATCH | `/admin/{edition}/intervenants`, `/intervenants/{id}` | `{ name, title, organisation, bio, linkedinUrl, topic }` sur le brouillon (F-163) ; POST → 201 `{ id }` |
| GET | `/admin/{edition}/intervenants?q=` | 20 fiches au plus, avec `linkedTo` (la personne de l'édition rattachée) |
| GET, POST, PATCH | `/admin/{edition}/organisations`, `/organisations/{id}` | `?q=&exhibitors=true` ; POST 409 `SIMILAR_ORGANISATIONS` `{ candidates, exact }` sauf `force` (T-83) ; PATCH accepte `exhibitor: { enabled, standNumber }` (F-172), 409 `EXHIBITOR_HAS_REPRESENTATIVES` |
| GET, PATCH | `/admin/{edition}/attendees/{id}/roles` | `{ speaker, exhibitor, standNumber, organizer, hostedTableNumber }` : `speaker` vaut un documentId, `new` ou null ; `exhibitor` un documentId d'organisation ou null → `{ role, roles, speaker, exhibitor, hostedTableNumber }` (D-20, F-171, F-173). 409 `ROLE_HAS_MEETINGS` (R-97), `SPEAKER_TAKEN`, `TABLE_TAKEN`, `SELF_FORBIDDEN` |

`b2bEnabled` (F-178) est aussi rendu par `GET /editions/{slug}` et dans `edition` de `GET /me`.

## Relances, désabonnement (V3-A)

| Méthode | Chemin | Accès | Réponse |
|---|---|---|---|
| GET | `/reminders/unsubscribe?token=…` | public, sans middleware de contexte | I-39 : page HTML de confirmation, ne change rien (les analyseurs de liens ouvrent les liens). 400 page « Lien invalide » |
| POST | `/reminders/unsubscribe?token=…` | public, sans middleware de contexte | coupe la préférence `reminders`. Formulaire de la page : page HTML « Vous ne recevrez plus de rappels ». Corps `List-Unsubscribe=One-Click` (RFC 8058, client de messagerie) : 200 `{ status: "unsubscribed" }` ou 400 `TOKEN_INVALID`. Pas de contrôle d'`Origin` : le jeton signé, propre au destinataire et sans échéance, est la seule preuve |

Les trois relances et le rappel `welcome` portent les en-têtes `List-Unsubscribe` et `List-Unsubscribe-Post` vers cette route.

## Flux calendrier (V5-E)

| Méthode | Chemin | Accès | Réponse |
|---|---|---|---|
| GET | `/calendar/{jeton}.ics` | public | I-42 : `text/calendar` des rendez-vous acceptés du propriétaire du flux (même contenu que les `.ics` des e-mails). 404 `FEED_NOT_FOUND` uniforme (jeton inconnu, révoqué ou remplacé) ; 429 `RATE_LIMITED` au-delà de 30 requêtes par minute et par IP. Le jeton n'est stocké que haché (`calendar-feed.tokenHash`) |

Création et révocation : `POST` et `DELETE /me/calendar-feed`, section Authentification.

## Webhook

| Méthode | Chemin | Accès | Réponse |
|---|---|---|---|
| POST | `/webhooks/helloasso` | public, vérification par relecture (I-13, V5-E) | → 200 `{ status: "accepted" }` quand `eventType = Order` et que la commande vise le formulaire HelloAsso d'une édition publiée ; 200 `{ status: "ignored" }` sinon (autre type, formulaire inconnu). Le corps n'est jamais cru : la commande est relue (`GET /orders/{orderId}`) puis importée par le chemin de la synchronisation, en tâche de fond après la réponse. 429 `RATE_LIMITED` au-delà de 60 requêtes par minute et par IP. URL à déclarer chez HelloAsso : `docs/espace/exploitation.md` |

## Tâches planifiées (cron Strapi)

| Tâche | Fréquence | Règle |
|---|---|---|
| Synchronisation HelloAsso (`espaceSync`) | toutes les 15 min | I-12 ; toute édition publiée dont `helloassoOrgSlug` et `helloassoFormSlug` sont renseignés, espace ouvert ou non (A-17). Invite les nouveaux inscrits seulement si `welcomeStartedAt` est posé, entre 8h00 et 20h00, jusqu'à trois échecs (R-85) |
| Expiration des demandes (`espaceMeetingExpiry`) | toutes les 5 min | R-17, A-32 ; aucun e-mail |
| Notifications de messages (`espaceMessageNotify`) | toutes les minutes (V3-A, pour V3-D) | R-62, R-88 : message non lu 2 min après l'envoi, un e-mail au plus par conversation et par 30 min |
| Relances (`espaceReminders`) | toutes les 15 min | R-70 à R-72, R-87 : n'envoie que ce que le calendrier rend dû (dû pendant 24 h) et que `EmailLog` ne porte pas encore, entre 8h00 et 20h00 ; rien en lecture seule |
| Purge des jetons (`espaceTokenPurge`) | 4h00 Europe/Paris | I-20 ; MagicToken dont `expiresAt` est passé depuis plus de 7 jours, par `services/tokens.js` (A-21) |
| Purge de conservation (`espacePurge`, V5-A) | 4h00 Europe/Paris | NF-13, R-44 : `EmailLog` et `SyncRun` de plus de 12 mois ; toutes les données de l'espace (participants, rendez-vous, conversations, messages, signalements, jetons, journaux, empreintes, photos) d'une édition passée de plus de 12 mois. L'édition et son programme restent. Idempotente |

Les tâches sont déclarées dans `strapi/config/cron-tasks.js` et ne sont enregistrées qu'avec `CRON_ENABLED=true`. Chacune appelle un service, sans logique propre ; une erreur est journalisée et ne fait jamais tomber Strapi.
