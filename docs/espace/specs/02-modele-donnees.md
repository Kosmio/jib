# 02. Modèle de données (Strapi)

Principe : **étendre les types existants plutôt que dupliquer.** Les noms techniques des types nouveaux sont en anglais (kebab-case pour les API Strapi) ; les types existants gardent leurs noms français.

## Correspondance avec l'existant (relevé de phase 0, 29 octobre 2026)

| Entité de la spec | Type existant | UID Strapi | Action |
|---|---|---|---|
| Edition | `edition` (« Édition ») | `api::edition.edition` | étendre : champs scalaires ajoutés, aucune relation modifiée |
| Session | `sequence` (« Séquence ») | `api::sequence.sequence` | étendre : `kind` seulement ; le thème est porté par Topic (A-15) |
| Speaker | `intervenant` | `api::intervenant.intervenant` | aucun changement de schéma : le lien au compte est porté par `Attendee.speaker` |
| Exhibitor | aucun. `partenaire` (« Partenariat ») relie une `organisation` à des éditions avec un rôle de soutien : ce n'est pas un exposant | `api::espace.exhibitor` (nouveau) | créer, en s'appuyant sur `organisation` pour le nom, le logo et la description |
| Topic | aucun. `tag` mêle thèmes et rôles et n'est pas rattaché à une édition | `api::espace.topic` (nouveau) | créer |
| Slot, Attendee, Meeting, Conversation, Message, MagicToken, EmailLog, SyncRun | aucun | `api::espace.<nom>` (nouveaux) | créer |
| (programme : qui parle dans quelle séquence) | `intervention` (relie `intervenant` et `sequence`) | `api::intervention.intervention` | lecture seule (E5, E8) |
| (lieu de l'édition) | composant répétable `edition.lieu` | | lecture seule |
| (structure d'un intervenant, logo d'exposant) | `organisation` | `api::organisation.organisation` | lecture seule |

Types existants hors périmètre : `home-page`, `static-page`, `contact`, `newsletter`, `captcha`.

## Règles de modélisation

- **Emplacement.** Les types nouveaux vivent dans `strapi/src/api/espace/content-types/<nom>/schema.json` (UID `api::espace.<nom>`), avec `draftAndPublish: false`.
- **Brouillon et publication.** `edition`, `sequence`, `intervention`, `intervenant` et `organisation` sont en brouillon et publication : chaque document a deux lignes en base (brouillon et publiée, `id` différents, même `documentId`). Les relations d'un type nouveau vers un type existant sont **unidirectionnelles et portées par le type nouveau** ; Strapi 5 les relie aux deux versions (constaté dans `@strapi/core`, `document-service/transform/relations/utils/dp.js`). Le code de l'espace filtre toujours par `documentId`, jamais par `id`, et lit les contenus publics avec `status: 'published'`.
- **Relations existantes.** Ne jamais changer le type d'une relation existante : la table de liaison est recréée vide au démarrage, et la prod est éditée directement. Sur un type existant, seuls des champs scalaires sont ajoutés ; toute nouvelle relation est déclarée sur un type nouveau (A-15, `docs/espace/journal/phase-1-plan.md`).
- **Tables.** Les types nouveaux déclarent `collectionName: "espace_<pluriel>"` (`espace_attendees`, `espace_meetings`, `espace_magic_tokens`…), pour grouper leurs tables et éviter toute collision avec l'existant.
- **Unicités composites** (« unique par édition ») : Strapi ne sait pas les déclarer. Elles sont garanties par les services, sous verrou consultatif Postgres. Seule exception : R-13 (voir Meeting).
- **Dates.** Les champs `datetime` sont stockés en UTC. Les horaires du programme restent du texte (« 9h15 », « 10h45 ») ; ils sont convertis en UTC avec `Edition.date` en Europe/Paris.

## Vue d'ensemble

```
Edition (edition) 1──n Session (sequence)
Edition 1──n Topic ; Topic n──n Session (relation portée par Topic)
Edition 1──n Slot ; Slot n──1 Session (kind = b2b_break)
Edition 1──n Attendee (participant importé de HelloAsso)
Edition 1──n Exhibitor ; Exhibitor n──1 Organisation (organisation)
Attendee n──0..1 Exhibitor   (représentants d'un exposant)
Attendee n──0..1 Speaker     (intervenant)
Meeting n──1 Slot ; Meeting n──1 Attendee (requester) ; Meeting n──1 Attendee|Exhibitor (target)
Conversation n──2 Attendee ; Conversation 1──n Message
MagicToken (liens et sessions), EmailLog, SyncRun : techniques
```

## Types de contenu

### Edition : type existant `edition`, à étendre

Champs existants utilisés :

| Champ de la spec | Champ existant | Type | Remarque |
|---|---|---|---|
| slug | `slug` | uid | ex. `nouvelle-aquitaine` |
| name | `title` | string | ex. « Nouvelle-Aquitaine » |
| city | `city` | string | |
| date | `date` | date, sans heure | jour de l'événement ; les heures viennent des séquences |
| venue | `lieux` | composant répétable `edition.lieu` (`name`, `address`, `map_url`, `time_slot`) | lieu affiché et lieu du .ics : premier élément |
| themeColor | `hero_bg_color` | couleur (plugin color-picker) | `#600e24` pour Nouvelle-Aquitaine ; **pas de nouveau champ** |
| (billetterie) | `inscription_url` | string | URL publique du formulaire HelloAsso |

Champs ajoutés, tous avec `private: true` (absents de l'API REST publique, donc sans effet sur le site public ni sur le MCP) :

| Champ | Type | Règle |
|---|---|---|
| participantSpaceEnabled | boolean | défaut false ; active `/espace` pour l'édition (NF-52) |
| helloassoOrgSlug | string | slug de l'organisation HelloAsso |
| helloassoFormType | enumeration `Event`, `Membership`, `CrowdFunding`, `Donation`, `PaymentForm`, `Checkout`, `Shop` | défaut `Event` |
| helloassoFormSlug | string | formulaire de l'édition |
| helloassoFieldMap | json | libellé du champ personnalisé HelloAsso pour chaque attribut importé, ex. `{ "email": "Email", "company": "Organisation", "jobTitle": "Poste" }` (I-11) |
| slotDurationMinutes | integer | défaut 15 |
| tablesCount | integer | défaut 20 |
| meetingRequestsOpenAt | datetime | ouverture de la prise de RDV |
| meetingRequestsCloseAt | datetime | défaut : veille 18h00 heure de Paris |

Ces champs ne prennent effet qu'une fois l'édition **publiée** dans Strapi.

### Session : type existant `sequence`, à étendre

Champs existants utilisés :

| Champ de la spec | Champ existant | Type | Remarque |
|---|---|---|---|
| start | `start_time` | string | « 9h15 », « 10h45 » ; « -- » pour une séquence sans horaire |
| end | `end_time` | string, facultatif | obligatoire pour une pause B2B (sinon signalée à la génération) |
| title | `title` | string | |
| description | `description` | richtext | |
| (ordre) | `order` | integer | vide dans les données : trier par heure analysée, pas par `order` ni par texte |
| (intervenants) | `interventions` → `intervenants` | relations | |
| (édition) | `edition` | relation manyToOne | |

Champ ajouté (public, à reporter dans `strapi/mcp/content-types.json`) :

| Champ | Type | Règle |
|---|---|---|
| kind | enumeration `talk`, `b2b_break`, `other` | défaut `talk`, valeur nulle traitée comme `talk` ; `b2b_break` génère des créneaux. Posé à la main par l'organisateur, jamais déduit du titre |

Le thème d'une séquence n'est pas un champ de `sequence` : il est porté par `Topic.sessions` (A-15).

### Topic (nouveau, `api::espace.topic`)

`name` (string, unique par édition, garanti par le service), `edition` (relation manyToOne → edition, requis), `sessions` (relation manyToMany → sequence, unidirectionnelle : les séquences de ce thème ; posée par l'organisateur sur la fiche du thème). Sert aux filtres, aux suggestions et au programme.

### Slot (nouveau, `api::espace.slot`, généré)

| Champ | Type | Règle |
|---|---|---|
| edition | relation manyToOne → edition | requis |
| session | relation manyToOne → sequence (`kind = b2b_break`) | requis |
| startsAt, endsAt | datetime | durée = `slotDurationMinutes` |
| label | string | ex. « 13h00 », calculé en heure de Paris |

Génération : voir R-01. Unicité (edition, startsAt) garantie par le service de génération.

### Attendee (nouveau, `api::espace.attendee`)

| Champ | Type | Règle |
|---|---|---|
| edition | relation manyToOne → edition | requis |
| helloassoItemId | string | unique par édition ; clé d'idempotence de l'import |
| helloassoOrderId | string | |
| email | **string** | requis, normalisé en minuscules, unique par édition, validé par le service. Pas le type `email` de Strapi : R-44 le remplace par une empreinte |
| firstName, lastName | string | requis |
| jobTitle | string | importé si le champ personnalisé est présent, sinon saisi |
| company | string | idem |
| role | enumeration `participant`, `speaker`, `exhibitor_rep`, `organizer` | défaut `participant` |
| speaker | relation manyToOne → intervenant, unidirectionnelle | si role = speaker ; rattachement par l'organisateur dans Strapi |
| exhibitor | relation manyToOne → Exhibitor (`inversedBy: representatives`) | si role = exhibitor_rep |
| hostedTableNumber | integer | **ajout** (D-04) : facultatif ; si role = speaker, numéro de sa table dédiée (participation « Meeting », R-19), réglé par l'organisateur ; entre 1 et `tablesCount`, unique par édition parmi les Attendee actifs |
| photo | media | facultatif, recadré carré 256 px |
| bio | text | 280 caractères max |
| topics | relation manyToMany → Topic | 0 à 3 |
| directoryOptIn | boolean | défaut false ; voir R-40 |
| meetingsOptIn | boolean | défaut false |
| newsOptIn | boolean | défaut false |
| consentAt | datetime | horodatage du dernier choix |
| activatedAt | datetime | première connexion |
| lastSeenAt | datetime | |
| status | enumeration `active`, `cancelled` | cancelled si commande annulée côté HelloAsso |
| emailPrefs | json | `{ meetingRequests: true, messages: true, reminders: true }` |
| editedFields | json | **ajout** : liste des champs importés modifiés par le participant (R-31) |

Champ calculé exposé par l'API : `profileCompletion` (R-30).

### Exhibitor (nouveau, `api::espace.exhibitor`)

| Champ | Type | Règle |
|---|---|---|
| organisation | relation manyToOne → organisation, unidirectionnelle | requis ; fournit `name`, `logo` et `description` (version publiée) |
| standNumber | string | ex. « 12 » |
| edition | relation manyToOne → edition | requis |
| representatives | relation oneToMany → Attendee (`mappedBy: exhibitor`) | 1 à 3 en pratique |
| topics | relation manyToMany → Topic | |

Une même organisation peut être partenaire (`partenaire`) et exposante : les deux types restent indépendants.

### Speaker : type existant `intervenant`, sans changement de schéma

Champs existants : `name` (nom complet en un seul champ), `title` (fonction), `bio` (richtext), `photo`, `topic` (texte libre), `organisation`, `tags`, `interventions` (vers les séquences). Le lien vers le compte de l'intervenant est `Attendee.speaker` : il remplace l'ajout `Speaker.attendee` initialement prévu, pour ne pas toucher au type public.

### Meeting (nouveau, `api::espace.meeting`)

| Champ | Type | Règle |
|---|---|---|
| edition | relation manyToOne → edition | requis |
| slot | relation manyToOne → Slot | requis |
| requester | relation manyToOne → Attendee | requis |
| targetAttendee | relation manyToOne → Attendee | exclusif avec targetExhibitor |
| targetExhibitor | relation manyToOne → Exhibitor | exclusif avec targetAttendee |
| message | text | 300 caractères max |
| status | enumeration `pending`, `accepted`, `declined`, `cancelled`, `expired` | voir R-10 |
| location | string | « Table 7 » ou « Stand 12 », fixé à l'acceptation |
| tableNumber | integer | null si stand |
| tableKey | string, interne | **ajout** : `{slotId}:{tableNumber}` posé à l'acceptation d'un rendez-vous à table, remis à null à l'annulation |
| answeredBy | relation manyToOne → Attendee | qui a accepté ou refusé (utile pour un exposant) |
| answeredAt, cancelledAt | datetime | |
| cancelReason | string | facultatif |

Index : la relation `slot` est stockée dans une table de liaison, une contrainte (slot, tableNumber) ne peut donc pas porter sur la table `meetings`. La contrainte de R-13 est l'index unique `espace_meetings_table_key_uq` sur `table_key`, créé au démarrage (`CREATE UNIQUE INDEX IF NOT EXISTS`) ; Postgres admet plusieurs valeurs nulles. Strapi 5 ne supprime pas un index qu'il n'a pas créé (constaté dans `@strapi/database`, `schema/diff.js`). Les tables de liaison créées par Strapi sont indexées : pas d'autre index en v1.

### Conversation et Message (nouveaux)

Conversation (`api::espace.conversation`) : `edition`, `participants` (relation manyToMany → Attendee, exactement 2, ordre canonique par id), `meeting` (relation facultative), `lastMessageAt`.
Message (`api::espace.message`) : `conversation`, `author`, `body` (2 000 caractères max, texte brut), `readAt`, `emailNotifiedAt`.

### Techniques

- **MagicToken** (`api::espace.magic-token`) : `attendee`, `kind` (**ajout**, enumeration `link`, `session`), `tokenHash` (SHA-256, unique), `expiresAt`, `usedAt`, `ip`. `link` : lien de connexion valable 30 minutes (I-20) ou lien d'action valable 72 heures (I-21), à usage unique. `session` : session ouverte par le cookie (I-22), 30 jours glissants, supprimée à la déconnexion. Un seul type pour les deux : même hachage, même recherche, même purge.
- **EmailLog** (`api::espace.email-log`) : `attendee`, `template`, `scenarioKey`, `sentAt`, `providerMessageId`, `status`. Sert à l'idempotence des relances (R-71).
- **SyncRun** (`api::espace.sync-run`) : `edition`, `startedAt`, `endedAt`, `created`, `updated`, `cancelled`, `errors` (json).
- **Notification** (R-60, P2) : préparée ici, **non créée en v1**. Champs prévus : `edition`, `recipient` (Attendee), `type` (`meeting-request`, `meeting-answer`, `message`), `link`, `readAt`. En v1, les compteurs des badges F-24 sont calculés à partir de Meeting et Message.

## Permissions Strapi

- Rôle public : aucune permission ajoutée ; la liste de `setPublicPermissions` dans `strapi/src/index.js` reste inchangée. Les contenus publics existants restent inchangés.
- Types nouveaux : aucune route CRUD n'existe, puisqu'aucun `createCoreRouter` ni `createCoreController` n'est déclaré pour eux. Ils restent visibles et éditables dans le back-office (Content Manager). Ils ne figurent pas dans `strapi/mcp/content-types.json` : ils n'ont pas de route REST et portent des données personnelles.
- Toutes les lectures et écritures de l'espace participant passent par les **routes personnalisées** de `06-api.md`, déclarées avec `auth: false` côté users-permissions. Le middleware de route de l'espace contrôle session, édition et droits sur chaque objet (NF-01).
- Rôle organisateur : `Attendee.role = organizer` ou e-mail présent dans `ORGANIZER_EMAILS` (I-23), pour le tableau de bord et les exports. Le back-office Strapi utilise les comptes administrateurs Strapi, distincts.
