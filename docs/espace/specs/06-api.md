# 06. Contrat d'API de l'espace participant

Routes personnalisées Strapi sous le préfixe `/api/espace`. JSON, dates ISO 8601 UTC. Authentification par cookie de session (I-22), sauf mention « public ». Toutes les routes vérifient que la ressource appartient à l'édition de la session. Erreurs : `{ "error": { "code": "SLOT_TAKEN", "message": "texte français affichable" } }` avec statut 400, 401, 403, 404, 409 ou 429.

Le developer peut ajuster les chemins aux conventions Strapi découvertes en phase 0, à condition de mettre à jour ce fichier dans le même commit.

## Conventions transverses (décidées en phase 0)

Détail et justification : `docs/espace/journal/phase-0-plan.md`.

- Les routes sont déclarées dans `strapi/src/api/espace/routes/espace.js` avec le chemin `/espace/…`, ce qui donne `/api/espace/…` sur Strapi. Le navigateur les appelle sur `{REACT_STRAPI_URL}/api/espace/…` : `/strapi/api/espace/…` derrière Traefik, `http://localhost:1337/api/espace/…` en local.
- Session : cookie `jib_espace`, posé et lu par Strapi seul (I-22). Le rendu serveur d'Astro relaie l'en-tête `Cookie` reçu ; il ne lit pas le cookie.
- CSRF (NF-04) : toute requête autre que GET et HEAD doit porter un en-tête `Origin` figurant dans `CORS_ORIGINS`, sinon 403 `ORIGIN_REFUSED`. Ce contrôle couvre aussi les formulaires HTML, qui ne peuvent pas ajouter d'en-tête personnalisé.
- Formulaires sans JavaScript (NF-31) : `POST /auth/request-link`, `POST /auth/verify` et `POST /auth/logout` acceptent aussi `application/x-www-form-urlencoded` ; ils répondent alors par une redirection 303 vers la page Astro adaptée au lieu du JSON. L'en-tête `Location` est absolu, construit sur `PUBLIC_URL` : le formulaire a été envoyé à l'origine de Strapi, un chemin relatif y resterait. Cibles retenues en phase 1 : `phase-1-plan.md`, section API.
- `GET /health` (public) → 200 `{ "status": "ok" }` : sonde d'exploitation et test de fumée.

## Authentification

| Méthode | Chemin | Accès | Corps / réponse |
|---|---|---|---|
| POST | `/auth/request-link` | public | `{ editionSlug, email }` → 202 toujours (F-02) ; 429 au-delà de 5 demandes en 15 min (E0) |
| GET | `/auth/link?token=…` | public | état d'un lien sans le consommer (A-18) : `{ valid: true, editionSlug }`, `{ valid: false, editionSlug, email }` pour un lien connu expiré ou utilisé (F-04, prérempli), `{ valid: false }` sinon ; toujours 200 |
| POST | `/auth/verify` | public | `{ token }` → 200 `{ me }` + cookie ; 400 `TOKEN_INVALID` |
| POST | `/auth/logout` | session | 204 |
| GET | `/me` | session | profil complet, `profileCompletion`, consentements, préférences, compteurs (demandes reçues en attente, messages non lus) |
| PATCH | `/me` | session | champs modifiables de E3 ; renvoie `me` |
| POST | `/me/photo` | session | multipart, → `{ photoUrl }` |
| PUT | `/me/consent` | session | `{ directoryOptIn, meetingsOptIn, newsOptIn }` |
| DELETE | `/me` | session | anonymisation R-44, 204 |

## Édition et programme (public)

| Méthode | Chemin | Accès | Réponse |
|---|---|---|---|
| GET | `/editions/{slug}` | public | nom, date, lieu, couleur, fenêtre de RDV, état `participantSpaceEnabled` |
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
| POST | `/admin/{edition}/sync` | organisateur | lance I-12, → SyncRun |
| GET | `/admin/{edition}/sync-runs` | organisateur | 10 derniers |
| POST | `/admin/{edition}/slots/regenerate` | organisateur | R-02, → rapport |
| GET | `/admin/{edition}/export/{participants,meetings,exhibitors,stats}.csv` | organisateur | F-91 |
| POST | `/admin/{edition}/reminders/preview` | organisateur | `{ scenario }` → `{ recipients, sampleHtml }` |
| POST | `/admin/{edition}/reminders/send` | organisateur | `{ scenario }` → `{ sent, skipped }` (R-71) |

## Webhook

| Méthode | Chemin | Accès | Réponse |
|---|---|---|---|
| POST | `/webhooks/helloasso` | public, vérification par resynchronisation (I-13) | 200 toujours après mise en file |

## Tâches planifiées (cron Strapi)

| Tâche | Fréquence | Règle |
|---|---|---|
| Synchronisation HelloAsso | 15 min | I-12 |
| Expiration des demandes | 5 min | R-17 |
| Notifications de messages | 5 min | R-62 |
| Relances | 9h30 et 16h00 Europe/Paris | R-70, R-72 |
| Purge des jetons expirés | quotidienne | I-20 |
