# 02. Modèle de données (Strapi)

Principe : **étendre les types existants plutôt que dupliquer.** En phase 0, l'architecte liste les types de contenu existants (éditions, intervenants, partenaires, programme) et remplit la colonne « type existant » ci-dessous. Les noms techniques sont en anglais, kebab-case pour les API Strapi.

## Vue d'ensemble

```
Edition 1──n Session            (existant probable : programme)
Edition 1──n Slot               (créneaux générés depuis les sessions B2B)
Edition 1──n Attendee           (participant importé de HelloAsso)
Edition 1──n Exhibitor          (existant probable : partenaires)
Attendee n──1 Exhibitor         (représentants d'un exposant)
Attendee 0..1──1 Speaker        (existant probable : intervenants)
Meeting  n──1 Slot ; Meeting n──1 Attendee (requester) ; Meeting n──1 Attendee|Exhibitor (target)
Conversation n──2 Attendee ; Conversation 1──n Message
EmailLog, MagicToken, SyncRun : techniques
```

## Types de contenu

### Edition (existant à étendre)

| Champ | Type | Règle |
|---|---|---|
| slug | uid | existant |
| name, city, date, venue | existants | |
| participantSpaceEnabled | boolean | défaut false ; active `/espace` pour l'édition |
| helloassoOrgSlug | string | ex. slug de l'organisation Xylofutur |
| helloassoFormType | enum Event, Membership, CrowdFunding… | défaut Event |
| helloassoFormSlug | string | formulaire de l'édition |
| helloassoFieldMap | json | libellé du champ personnalisé HelloAsso pour chaque attribut importé, ex. `{ "email": "Email", "company": "Organisation", "jobTitle": "Poste" }` (I-11) |
| slotDurationMinutes | integer | défaut 15 |
| tablesCount | integer | défaut 20 |
| meetingRequestsOpenAt | datetime | ouverture de la prise de RDV |
| meetingRequestsCloseAt | datetime | défaut : veille 18h00 heure de Paris |
| themeColor | string hex | couleur d'édition (#600e24 pour Nouvelle-Aquitaine) |

### Session (existant à étendre)

| Champ | Type | Règle |
|---|---|---|
| start, end, title, description | existants | |
| kind | enum talk, b2b_break, other | **ajout** ; `b2b_break` génère des créneaux |
| topic | relation Topic | **ajout** ; thématique (Forêt et adaptation, Process data et IA, Économie circulaire, Territoires, Construction bois) |

### Topic (nouveau)

`name` (string, unique par édition), `edition` (relation). Sert aux filtres et aux suggestions.

### Slot (nouveau, généré)

| Champ | Type | Règle |
|---|---|---|
| edition | relation | requis |
| session | relation Session (b2b_break) | requis |
| startsAt, endsAt | datetime | durée = slotDurationMinutes |
| label | string | ex. « 13h00 » |

Génération : voir R-01. Unicité (edition, startsAt).

### Attendee (nouveau)

| Champ | Type | Règle |
|---|---|---|
| edition | relation | requis |
| helloassoItemId | string | unique par édition ; clé d'idempotence de l'import |
| helloassoOrderId | string | |
| email | email | requis, normalisé en minuscules, unique par édition |
| firstName, lastName | string | requis |
| jobTitle | string | importé si champ personnalisé présent, sinon saisi |
| company | string | idem |
| role | enum participant, speaker, exhibitor_rep, organizer | défaut participant |
| speaker | relation Speaker | si role = speaker |
| exhibitor | relation Exhibitor | si role = exhibitor_rep |
| photo | media | facultatif, recadré carré 256 px |
| bio | text | 280 caractères max |
| topics | relation n Topic | 0 à 3 |
| directoryOptIn | boolean | défaut false ; voir R-40 |
| meetingsOptIn | boolean | défaut false |
| newsOptIn | boolean | défaut false |
| consentAt | datetime | horodatage du dernier choix |
| activatedAt | datetime | première connexion |
| lastSeenAt | datetime | |
| status | enum active, cancelled | cancelled si commande annulée côté HelloAsso |
| emailPrefs | json | { meetingRequests: true, messages: true, reminders: true } |

Champ calculé exposé par l'API : `profileCompletion` (R-30).

### Exhibitor (existant « partenaire » à étendre, ou nouveau)

`name`, `logo`, `description`, `standNumber` (string), `edition`, `representatives` (relation n Attendee), `topics`.

### Speaker (existant « intervenant »)

Ajout : `attendee` (relation 1 Attendee) pour lier l'intervenant à son compte.

### Meeting (nouveau)

| Champ | Type | Règle |
|---|---|---|
| edition | relation | requis |
| slot | relation Slot | requis |
| requester | relation Attendee | requis |
| targetAttendee | relation Attendee | exclusif avec targetExhibitor |
| targetExhibitor | relation Exhibitor | exclusif avec targetAttendee |
| message | text | 300 caractères max |
| status | enum pending, accepted, declined, cancelled, expired | voir R-10 |
| location | string | « Table 7 » ou « Stand 12 », fixé à l'acceptation |
| tableNumber | integer | null si stand |
| answeredBy | relation Attendee | qui a accepté ou refusé (utile pour un exposant) |
| answeredAt, cancelledAt | datetime | |
| cancelReason | string | facultatif |

Index : (slot, tableNumber) unique quand status = accepted ; (slot, requester) ; (slot, targetAttendee).

### Conversation et Message (nouveaux)

Conversation : `edition`, `participants` (exactement 2 Attendee, ordre canonique par id), `meeting` (relation facultative), `lastMessageAt`.
Message : `conversation`, `author`, `body` (2 000 caractères max, texte brut), `readAt`, `emailNotifiedAt`.

### Techniques

- **MagicToken** : `attendee`, `tokenHash` (SHA-256), `expiresAt`, `usedAt`, `ip`.
- **EmailLog** : `attendee`, `template`, `scenarioKey`, `sentAt`, `providerMessageId`, `status`. Sert à l'idempotence des relances (R-71).
- **SyncRun** : `edition`, `startedAt`, `endedAt`, `created`, `updated`, `cancelled`, `errors` (json).

## Permissions Strapi

- Rôle public : aucune lecture des types nouveaux. Les contenus publics existants restent inchangés.
- Toutes les lectures et écritures de l'espace participant passent par des **routes personnalisées** (`06-api.md`) qui appliquent les règles de visibilité ; les routes CRUD générées de Attendee, Meeting, Conversation, Message, MagicToken, EmailLog sont désactivées.
- Rôle organisateur : accès au tableau de bord et aux exports, et au back-office Strapi.
