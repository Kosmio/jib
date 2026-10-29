# 04. Règles métier

Ces règles sont la source de vérité des rendez-vous. Elles doivent être implémentées **côté serveur** (services Strapi) ; le front ne fait qu'afficher l'état calculé par l'API. Chaque règle donne lieu à au moins un test unitaire du service correspondant.

## Créneaux

- **R-01** Les créneaux sont générés à partir des sessions `kind = b2b_break` de l'édition : de `start` à `end` par pas de `slotDurationMinutes`, le dernier créneau devant se terminer au plus tard à `end`. Exemple Nouvelle-Aquitaine (pas de 15 min) : 10h45, 11h00 ; 12h30, 12h45, 13h00, 13h15, 13h30, 13h45 ; 15h30, 15h45, soit 10 créneaux.
- **R-02** La génération est idempotente (commande ou action organisateur « Régénérer les créneaux ») : un créneau existant qui a des rendez-vous `pending` ou `accepted` n'est jamais supprimé ; s'il ne correspond plus à une pause, il est signalé à l'organisateur.
- **R-03** Capacité d'un créneau en tables = `tablesCount` de l'édition. Les stands d'exposants ne consomment pas de table.

## Cycle de vie d'un rendez-vous

```
            accept                    cancel (l'un ou l'autre)
pending ──────────────► accepted ─────────────────────► cancelled
   │ decline / auto-decline (R-15)
   ├──────────────────► declined
   │ cancel (demandeur)
   ├──────────────────► cancelled
   │ fenêtre fermée (R-17)
   └──────────────────► expired
```

- **R-10** Seules les transitions du schéma sont autorisées ; toute autre transition renvoie 409.
- **R-11** Création d'une demande. Conditions cumulatives, vérifiées dans une transaction :
  1. la fenêtre de prise de rendez-vous est ouverte (R-17) ;
  2. le créneau appartient à l'édition et n'a pas commencé ;
  3. le demandeur est actif et la cible accepte les demandes (`meetingsOptIn = true`, ou pour un exposant : au moins un représentant actif) ;
  4. demandeur ≠ cible, et le demandeur n'est pas représentant de l'exposant ciblé ;
  5. le demandeur n'a ni rendez-vous accepté, ni demande en attente sur ce créneau ;
  6. la cible n'a pas de rendez-vous accepté sur ce créneau ;
  7. il n'existe pas déjà une demande en attente entre ces deux mêmes parties, quel que soit le créneau ;
  8. pour une table : il reste au moins une table libre sur le créneau (R-13) ;
  9. le demandeur a moins de **10 demandes en attente** au total (anti-abus).
  En cas d'échec : 409 avec un code d'erreur stable (`SLOT_TAKEN`, `TARGET_BUSY`, `ALREADY_REQUESTED`, `WINDOW_CLOSED`, `TARGET_UNAVAILABLE`, `TOO_MANY_PENDING`, `NO_TABLE_LEFT`) que le front traduit.
- **R-12** État d'un créneau pour le visiteur d'une fiche : « indisponible » si l'une des conditions 2, 5, 6 ou 8 échoue ; sinon « disponible ». L'API ne révèle jamais avec qui la cible a rendez-vous.
- **R-13** Attribution du lieu à l'acceptation : pour une cible exposant, `location = "Stand {standNumber}"`, `tableNumber = null` ; sinon la plus petite table libre du créneau, `location = "Table {n}"`. Contrainte d'unicité (slot, tableNumber) en base pour les rendez-vous acceptés ; en cas de collision concurrente, réessayer avec la table suivante (3 essais), puis 409 `NO_TABLE_LEFT`.
- **R-14** Rendez-vous avec un exposant : la cible est l'Exhibitor ; tous ses représentants voient la demande dans leur agenda et n'importe lequel peut répondre (`answeredBy`). La règle 6 s'applique à l'exposant : un exposant peut tenir **autant de rendez-vous simultanés qu'il a de représentants** actifs.
- **R-15** À l'acceptation d'une demande, les autres demandes `pending` adressées à la même cible sur le même créneau passent à `declined` avec notification au demandeur (« le créneau n'est plus disponible ») ; les demandes `pending` envoyées par le demandeur ou la cible sur ce créneau sont également closes.
- **R-16** Annulation : possible jusqu'au début du créneau ; libère la table.
- **R-17** Fenêtre de prise de rendez-vous : entre `meetingRequestsOpenAt` et `meetingRequestsCloseAt` (par défaut veille 18h00). À la fermeture, les demandes `pending` passent à `expired` (tâche planifiée) et les deux parties sont informées par le récapitulatif de la veille (R-70 c), sans e-mail spécifique.
- **R-18** Un participant dont la commande HelloAsso est annulée (`status = cancelled`) voit ses rendez-vous `pending` et `accepted` passer à `cancelled` avec notification aux autres parties.

## Profil

- **R-30** `profileCompletion` en pourcentage entier : prénom, nom, entreprise (40 % à eux trois, toujours présents après import), fonction 15 %, photo 15 %, présentation 15 %, au moins un sujet 15 %.
- **R-31** Les champs importés de HelloAsso ne sont plus écrasés par les synchronisations suivantes dès que le participant les a modifiés (drapeau `editedFields` interne).

## Visibilité et consentement

- **R-40** Le consentement est explicite, recueilli à la première connexion (E2), horodaté (`consentAt`), révocable à tout moment (E3). Aucune case précochée.
- **R-41** `directoryOptIn = false` : absent de l'annuaire, des suggestions et des exports partagés ; sa fiche n'est accessible qu'aux personnes avec qui il a un rendez-vous ou une conversation. Il peut demander des rendez-vous et écrire.
- **R-42** Données visibles d'un autre participant : prénom, nom, fonction, entreprise, photo, présentation, sujets, type. **Jamais l'e-mail ni le téléphone**, y compris après un rendez-vous accepté (les échanges passent par la messagerie).
- **R-43** Les intervenants et exposants restent visibles au titre du programme public ; leurs comptes personnels suivent R-41.
- **R-44** Suppression des données (F-33) : le participant est anonymisé (« Participant supprimé »), ses rendez-vous futurs sont annulés avec notification, ses messages restent visibles de l'interlocuteur avec l'auteur anonymisé, son e-mail est remplacé par une empreinte pour empêcher la réimportation. Purge complète de l'édition 12 mois après sa date (tâche planifiée, P1).

## Suggestions

- **R-50** « Ils partagent vos sujets » : profils visibles (R-41) ayant au moins un sujet en commun, hors soi, hors personnes déjà en rendez-vous accepté ou en attente avec soi, triés par nombre de sujets communs puis intervenants et exposants d'abord, puis aléatoire stable par jour (graine = id du participant + date). 3 suggestions maximum. Sans sujet renseigné : intervenants et exposants de l'édition.

## Messagerie

- **R-60** Préparation P2 : chaque événement notifiable (demande, réponse, message) est écrit dans une table `Notification` (type, destinataire, lien, `readAt`) qui alimente les badges F-24 et servira aux notifications push.
- **R-61** Une conversation par paire de participants et par édition. Le premier message à une personne avec `meetingsOptIn = false` est refusé (403 `TARGET_UNAVAILABLE`) sauf si une conversation existe déjà.
- **R-62** E-mail `new-message` : au plus un par conversation et par destinataire toutes les 30 minutes, envoyé seulement si le message n'a pas été lu 5 minutes après l'envoi et si la préférence `messages` est active.
- **R-63** Le contenu des messages n'est accessible qu'aux deux participants. Il n'apparaît ni dans le tableau de bord ni dans les exports ; l'organisateur n'a accès qu'aux compteurs.
- **R-64** Limite : 30 messages par heure et par auteur.

## Relances

- **R-70** Trois scénarios, envoyés par tâche planifiée à 9h30 heure de Paris, et déclenchables manuellement (F-92) :
  - a. `reminder-profile` : actifs dont `profileCompletion` < 70 %. Envois : J+2 après activation, puis 27 novembre.
  - b. `reminder-no-meeting` : actifs sans aucun rendez-vous accepté ni en attente. Envois : ouverture (20 novembre), 27 novembre.
  - c. `reminder-eve` : tous les actifs, la veille à 16h00 : agenda du lendemain, lieu, accès, demandes expirées.
  - Inscrits jamais activés : un rappel `welcome` à J+3 après import, puis le 27 novembre.
- **R-71** Idempotence : une clé `scenarioKey` (scénario + date prévue) par destinataire dans EmailLog ; un même scénario n'est jamais envoyé deux fois à la même personne pour la même clé, même en cas de relance manuelle.
- **R-72** Respect des préférences `reminders` ; aucun envoi entre 20h00 et 8h00.
