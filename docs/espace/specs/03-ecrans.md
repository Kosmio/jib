# 03. Écrans et parcours

Routes sous `/espace/{editionSlug}/…` (ex. `/espace/nouvelle-aquitaine/`). Un participant n'accède qu'à l'édition de son inscription. Mise en page mobile d'abord (390 px), lisible jusqu'à 1280 px avec un conteneur de 720 px pour les écrans participant. Barre d'onglets basse sur mobile : Accueil, Annuaire, Agenda, Messages, Programme ; barre latérale au-delà de 1024 px.

Pour chaque écran : éléments, états, exigences `F-xx` (priorité) et critères d'acceptation (CA) au format Étant donné / Quand / Alors.

---

## E0. Connexion par lien magique : `/espace/{edition}/connexion` et `/espace/verifier`

Maquette : 01-connexion.

Éléments : bandeau d'édition (logos Xylofutur et JIB, couleur d'édition), champ e-mail, bouton « Recevoir mon lien », mention sur l'absence de mot de passe et l'hébergement des données, lien Confidentialité.

- **F-01 (P0)** Saisie d'un e-mail ; envoi d'un lien de connexion si l'e-mail correspond à un Attendee actif de l'édition (I-20).
- **F-02 (P0)** Réponse identique que l'e-mail existe ou non : « Si cette adresse est inscrite, un lien vient de vous être envoyé. » (pas d'énumération de comptes).
- **F-03 (P0)** `/espace/verifier?token=…` consomme le jeton, ouvre la session, redirige vers E2 si aucun consentement n'a été donné, sinon vers E1.
- **F-04 (P0)** Jeton expiré ou déjà utilisé : message « Ce lien n'est plus valable » et bouton « Recevoir un nouveau lien » prérempli.
- **F-05 (P1)** Bandeau d'aide à l'installation PWA (Android : invite native ; iOS : instruction « Partager puis Sur l'écran d'accueil »), masquable, mémorisé.

CA :
- Étant donné un inscrit, quand il demande un lien, alors il reçoit un e-mail en moins d'une minute contenant un lien valable 30 minutes et à usage unique.
- Étant donné un e-mail inconnu, quand il est saisi, alors le message affiché est le même et aucun e-mail n'est envoyé.
- Étant donné 5 demandes en 15 minutes pour un même e-mail ou une même IP, alors la 6e est refusée avec le message « Trop de demandes, réessayez dans quelques minutes. »

## E2. Consentement et premier profil : `/espace/{edition}/bienvenue`

Maquette : 01-connexion (bloc « Vos choix de visibilité »).

Éléments : rappel des informations importées (prénom, nom, fonction, entreprise, modifiables), trois cases : annuaire, demandes de rendez-vous et messages, actualités des prochaines éditions. Bouton « Continuer ».

- **F-10 (P0)** Les cases sont décochées par défaut ; l'utilisateur doit cliquer « Continuer » pour enregistrer ses choix (R-40).
- **F-11 (P0)** Si « Recevoir des demandes » est coché sans « Apparaître dans l'annuaire », afficher une note : « Sans apparaître dans l'annuaire, seules les personnes à qui vous écrivez pourront vous proposer un rendez-vous. »
- **F-12 (P0)** Les choix restent modifiables depuis le profil (E3).

CA : un participant qui ne coche rien n'apparaît ni dans l'annuaire, ni dans les suggestions, et ne peut recevoir aucune demande ; il peut en envoyer (R-41).

## E1. Accueil : `/espace/{edition}/`

Maquette : 02-accueil.

Éléments : en-tête (logo JIB, avatar vers E3), carte d'édition (couleur d'édition, compte à rebours « J-n », date, lieu), carte « Votre profil » (barre de progression, phrase d'aide, lien « Compléter mon profil »), carte « Prochain rendez-vous » (heure, lieu, interlocuteur, statut, lien vers l'agenda avec le nombre de rendez-vous), section « Ils partagent vos sujets » (2 à 3 suggestions, bouton « Rencontrer »).

- **F-20 (P0)** Compte à rebours en jours calendaires heure de Paris ; le jour J affiche « Aujourd'hui » ; après l'événement, « Merci de votre participation » et lien vers l'agenda.
- **F-21 (P0)** Carte profil masquée quand `profileCompletion` = 100 %.
- **F-22 (P0)** Carte « Prochain rendez-vous » : prochain rendez-vous accepté ; à défaut le prochain en attente avec mention « En attente de réponse » ; à défaut un appel « Trouver des interlocuteurs » vers l'annuaire.
- **F-23 (P0)** Suggestions selon R-50 ; si aucune, la section est masquée.
- **F-24 (P1)** Badge du nombre de demandes reçues en attente sur l'onglet Agenda et de messages non lus sur l'onglet Messages.

## E3. Mon profil : `/espace/{edition}/profil`

Éléments : photo (téléversement, recadrage carré), prénom, nom, fonction, entreprise, présentation (280 caractères avec compteur), sujets (0 à 3 parmi les Topic de l'édition), choix de visibilité (E2), préférences e-mail (demandes de rendez-vous, messages, rappels), bouton « Enregistrer », lien « Me déconnecter », lien « Supprimer mes données » (F-33).

- **F-30 (P0)** Validation : prénom, nom, entreprise obligatoires ; photo JPEG/PNG/WebP ≤ 5 Mo, convertie en WebP 256 × 256.
- **F-31 (P0)** Message de confirmation « Profil enregistré » ; erreurs affichées sous chaque champ.
- **F-32 (P0)** Un représentant d'exposant voit en plus le lien vers la fiche de son exposant (lecture seule en v1 ; édition par l'organisateur dans Strapi).
- **F-33 (P1)** « Supprimer mes données » : confirmation, puis anonymisation (R-44).

## E4. Annuaire : `/espace/{edition}/annuaire`

Maquette : 03-annuaire.

Éléments : recherche plein texte (nom, entreprise, fonction, sujet), sélecteur segmenté Tous / Participants / Intervenants / Exposants, puces de sujets (sélection multiple), compteur de résultats, liste de cartes (avatar ou initiales, nom, fonction et entreprise, étiquette de type, chevron vers E5).

- **F-40 (P0)** Ne liste que les Attendee avec `directoryOptIn = true` et `status = active`, plus tous les Exhibitor de l'édition (R-42).
- **F-41 (P0)** Recherche insensible à la casse et aux accents, déclenchée après 2 caractères, temporisée 250 ms.
- **F-42 (P0)** Tri : intervenants et exposants d'abord quand le filtre est « Tous », puis ordre alphabétique du nom.
- **F-43 (P0)** Pagination par défilement, 30 éléments par page.
- **F-44 (P0)** État vide : « Aucun profil ne correspond. Essayez un autre sujet ou effacez la recherche. » avec bouton « Effacer les filtres ».
- **F-45 (P1)** L'état des filtres est conservé dans l'URL (partageable).

## E5. Fiche et demande de rendez-vous : `/espace/{edition}/annuaire/{type}/{id}`

Maquette : 04-fiche. `type` = `p` (participant ou intervenant) ou `x` (exposant).

Éléments : retour, en-tête (photo, nom, fonction, entreprise ou nom d'exposant et stand), étiquettes (type, séquence de l'intervenant avec heure), présentation, sujets. Bloc « Proposer un rendez-vous » : créneaux regroupés par pause B2B (libellé et horaire de la pause), grille de boutons d'heure, message facultatif (300 caractères), bouton principal « Envoyer la demande pour {heure} ». Lien « Écrire un message » vers E7.

- **F-50 (P0)** Créneaux affichés : ceux de l'édition dont l'heure n'est pas passée. État de chaque créneau calculé selon R-12 : disponible, indisponible (barré, désactivé, `aria-disabled`, libellé « indisponible » pour les lecteurs d'écran), sélectionné.
- **F-51 (P0)** Aucun créneau présélectionné ; le bouton principal est désactivé tant qu'aucun créneau n'est choisi, avec le libellé « Choisissez un créneau ».
- **F-52 (P0)** Envoi : création d'un Meeting `pending` (R-11), e-mail à la cible (I-31), message de succès « Demande envoyée à {prénom} » et retour sur la fiche avec le créneau marqué « Demande envoyée ».
- **F-53 (P0)** Si la cible n'accepte pas les rendez-vous (`meetingsOptIn = false`), le bloc est remplacé par « {Prénom} ne reçoit pas de demandes de rendez-vous. »
- **F-54 (P0)** Fiche de son propre profil : bloc remplacé par « C'est votre profil » et lien vers E3.
- **F-55 (P0)** Hors fenêtre de prise de rendez-vous (avant `meetingRequestsOpenAt` ou après `meetingRequestsCloseAt`), bloc remplacé par le message adapté.
- **F-56 (P0)** Conflit détecté à l'envoi (créneau pris entre-temps) : message « Ce créneau vient d'être pris, choisissez-en un autre » et rafraîchissement de la grille.
- **F-57 (P0)** Fiche exposant : la demande vise l'exposant (R-14), lieu « Stand n ».

## E6. Mon agenda : `/espace/{edition}/agenda`

Maquette : 05-agenda.

Éléments : titre, date et lieu, bouton « Calendrier » (export .ics), section « Demandes reçues » (cartes avec Accepter / Proposer un autre créneau / Refuser), frise de la journée combinant sessions du programme (style discret) et rendez-vous (carte blanche, interlocuteur, lieu, statut avec icône et texte), section « Demandes envoyées » en attente.

- **F-60 (P0)** Accepter : passe le Meeting à `accepted`, attribue le lieu (R-13), notifie le demandeur (I-32), refuse automatiquement les autres demandes en attente du même créneau pour la même cible (R-15).
- **F-61 (P0)** Refuser : `declined`, notification au demandeur avec invitation à choisir un autre créneau.
- **F-62 (P0)** Proposer un autre créneau : ouvre la grille de créneaux de E5 en mode réponse ; à l'envoi, la demande initiale passe à `declined` et une nouvelle demande est créée dans l'autre sens (la cible devient demandeuse).
- **F-63 (P0)** Annuler un rendez-vous accepté ou une demande envoyée : confirmation, `cancelled`, notification à l'autre partie.
- **F-64 (P0)** Statuts toujours affichés avec un mot : « Confirmé », « En attente de réponse », « Refusé », « Annulé », « Expiré ».
- **F-65 (P0)** Export .ics de tous les rendez-vous acceptés et des sessions (I-40) ; un lien d'abonnement calendrier personnel est en P1.
- **F-66 (P0)** État vide : « Aucun rendez-vous pour l'instant » et bouton vers l'annuaire.

## E7. Messagerie : `/espace/{edition}/messages` et `/messages/{conversationId}`

Maquette : 06-messages.

Liste : conversations triées par dernier message, avatar, nom, extrait, heure, pastille non lu.
Fil : en-tête (retour, interlocuteur), bandeau du rendez-vous lié s'il existe (date, heure, lieu, lien agenda), bulles (envoyées à droite, reçues à gauche), horodatage, mention « Lu », zone de saisie et bouton « Envoyer ». Mention « {Prénom} reçoit aussi vos messages par e-mail » si ses préférences le prévoient.

- **F-70 (P0)** Une conversation est ouverte depuis une fiche (« Écrire un message ») ou depuis un rendez-vous ; une seule conversation par paire et par édition (R-61).
- **F-71 (P0)** Rafraîchissement : interrogation toutes les 20 s quand le fil est ouvert et l'onglet visible ; pas de WebSocket en v1.
- **F-72 (P0)** Message vide refusé ; 2 000 caractères maximum avec compteur au-delà de 1 800.
- **F-73 (P0)** Notification e-mail selon R-62.
- **F-74 (P0)** Une personne avec `meetingsOptIn = false` ne peut pas être contactée en premier ; elle peut écrire et répondre.
- **F-75 (P1)** Signaler un message : envoie une alerte à l'organisateur.

## E8. Programme : `/espace/{edition}/programme`

Maquette : 07-programme.

Onglets : Journée, Intervenants, Infos pratiques. Journée : sessions de l'édition triées par heure (heure, titre, sous-titre), pauses B2B mises en avant avec bouton « Prendre RDV » vers l'annuaire. Intervenants : liste des Speaker avec lien vers leur fiche E5 si un compte est lié. Infos pratiques : contenu Strapi existant de l'édition (lieu, adresse, accès).

- **F-80 (P0)** Contenus lus depuis Strapi sans duplication ; mention « Horaires indiqués à titre provisoire » si l'édition le précise.
- **F-81 (P0)** Ces trois onglets sont consultables sans connexion (contenu public), le bouton « Prendre RDV » renvoie alors vers E0.

## E9. Tableau de bord organisateur : `/espace/{edition}/organisateur`

Maquette : 09-pilotage. Accès réservé au rôle organisateur.

Éléments : sélecteur d'édition, état de la dernière synchronisation HelloAsso avec bouton « Synchroniser maintenant », indicateurs (inscrits importés avec répartition, espaces activés, profils complets, rendez-vous acceptés et en attente, messages), remplissage par pause B2B (barres acceptés et en attente rapportés à la capacité), exposants les plus sollicités, boutons d'export CSV, déclenchement manuel d'une relance avec aperçu du nombre de destinataires.

- **F-90 (P0)** Indicateurs calculés à la volée (volume faible), cohérents avec les exports.
- **F-91 (P0)** Exports CSV UTF-8 avec BOM, séparateur point-virgule (Excel FR) : participants, rendez-vous, exposants avec nombre de demandes, statistiques agrégées. Aucun contenu de message exporté (R-63).
- **F-92 (P0)** Relance manuelle : choix du scénario (R-70), aperçu du nombre de destinataires et d'un e-mail exemple, confirmation, envoi ; respecte l'idempotence (R-71).
- **F-93 (P1)** Ouverture et fermeture de la prise de rendez-vous depuis ce tableau (sinon : dans Strapi).

## E10. E-mails

Maquette : 08-relance. Gabarits HTML sobres (largeur 600 px, en-tête couleur d'édition, logo JIB blanc, pied Xylofutur avec lien « Gérer mes notifications »), version texte systématique.

| Gabarit | Déclencheur | Contenu |
|---|---|---|
| `access-link` | F-01 | Lien de connexion, durée de validité |
| `welcome` | import d'un nouvel inscrit (I-12) | Présentation de l'espace, lien d'accès direct |
| `meeting-request` | F-52 | Demandeur, créneau, message, boutons « Accepter » et « Voir la demande » |
| `meeting-accepted` | F-60 | Créneau, lieu, lien agenda, pièce jointe .ics |
| `meeting-declined` | F-61, R-15 | Invitation à proposer un autre créneau |
| `meeting-cancelled` | F-63 | Créneau libéré |
| `new-message` | R-62 | Extrait de 200 caractères, lien vers le fil |
| `reminder-profile` | R-70 a | Taux de complétion, suggestions, lien profil |
| `reminder-no-meeting` | R-70 b | Suggestions, lien annuaire |
| `reminder-eve` | R-70 c | Agenda du lendemain, lieu, accès |

Les liens d'action des e-mails contiennent un jeton de connexion à usage unique valable 72 h (I-21), pour éviter de redemander un lien.
