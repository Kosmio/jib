# 15. Lot administration : organiser une édition sans Strapi

Statut : **DRAFT**, demandé par Mathieu le 18 novembre 2026 (retours de recette 1). Hors périmètre de la mise en production du 20 novembre : rien ici ne bloque la recette ni l'édition du 3 décembre. À chiffrer et à planifier après validation de ce document.

Identifiants nouveaux : F-153 à F-189, R-92 à R-97, I-45, NF-71 à NF-76, T-76 à T-88, D-19 à D-24. Les identifiants antérieurs gardent leur sens.

## Objectif

Aujourd'hui, préparer une édition demande l'administration de Strapi pour presque tout : HelloAsso, programme, intervenants, organisations, exposants, réglages des rendez-vous (`guide-organisateur.md`, section 1). Le tableau de bord E9 ne fait que piloter (synchronisation, inscrits, rendez-vous, relances, badges, exports).

Cible : **toute l'organisation courante se fait depuis l'interface organisation** de l'espace. Strapi reste l'outil des paramétrages fins et des contenus du site public (pages, partenaires, galerie, bilan), accessible par un lien depuis chaque objet.

## Demande d'origine

En tant qu'administrateur ou organisateur, je veux accéder à l'interface organisation et :

1. paramétrer HelloAsso ;
2. créer et modifier le programme dans une vue proche de la vue en ligne, avec des éditeurs de texte riche, éventuellement guidé par un assistant ; ajouter et modifier les intervenants du programme ;
3. créer des organisations et des personnes de ces organisations, les désigner intervenants, exposants, participants, ou plusieurs à la fois ;
4. activer et régler les fonctions B2B, et basculer sur la vue B2B de l'édition ;
5. basculer sur Strapi pour une modification plus précise ou un autre sujet ;
6. lire une documentation qui explique l'administration et Strapi, avec captures d'écran et explications pas à pas.

La demande se terminait par une phrase inachevée, « une vue Administrateur qui » : voir la question ouverte 1.

## Décisions proposées, à valider

- **D-19** Un seul rôle pour ce lot : l'**organisateur** (I-23 : `role = organizer` ou `ORGANIZER_EMAILS`) a toutes les fonctions décrites ici. Pas de rôle « administrateur » distinct dans l'espace tant que la question 1 n'est pas tranchée. Le compte Strapi reste séparé (rôle « Organisation Xylofutur », V5-G).
- **D-20** Les rôles d'une personne se **cumulent** et se déduisent de ses liens, sans changer le schéma (A-15) : intervenant si le lien `speaker` est posé, représentant d'exposant si le lien `exhibitor` est posé, organisateur par I-23, participant sinon. Le champ `role` reste, comme type principal affiché (badge, annuaire), dans l'ordre organisateur, intervenant, exposant, participant. Tout le code qui teste `role === 'speaker'` ou `'exhibitor_rep'` passe par deux fonctions de `lib/` (`isSpeaker`, `isExhibitorRep`).
- **D-21** Les secrets HelloAsso (`HELLOASSO_CLIENT_ID`, `HELLOASSO_CLIENT_SECRET`) **restent des variables d'environnement** : l'interface ne les affiche ni ne les modifie. Elle règle ce qui est propre à l'édition (association, formulaire, correspondance des champs).
- **D-22** Le programme s'édite sur le **brouillon** Strapi ; un bouton « Publier le programme » publie d'un coup l'édition, ses séquences, interventions et intervenants modifiés. La vue en ligne ne change qu'à la publication.
- **D-23** Les textes riches gardent le format que le site rend déjà (`safeHtml`, `web/src/lib/html.ts`) : l'éditeur lit et écrit ce format, avec une barre réduite (gras, italique, listes, lien, intertitre). Aucun HTML libre.
- **D-24** La documentation vit dans le dépôt (`docs/espace/aide/*.md`), se rend dans l'interface, et ses captures d'écran sont **produites par un script Playwright sur le jeu de recette fictif**, donc sans donnée personnelle et régénérables à chaque version.

## Navigation

E9 devient une section à onglets, sous `/espace/{edition}/organisateur/` :

| Onglet | Route | Contenu |
|---|---|---|
| Pilotage | `/organisateur` | l'existant (E9), inchangé |
| Édition | `/organisateur/edition` | réglages de l'édition, HelloAsso, B2B (parties A et D) |
| Programme | `/organisateur/programme` | éditeur du programme et des intervenants (partie B) |
| Personnes | `/organisateur/personnes` | organisations, personnes et rôles (partie C) |
| Vue B2B | `/organisateur/b2b` | créneaux, tables et rendez-vous de la journée (partie D) |
| Aide | `/organisateur/aide` | documentation (partie F) |

- **F-153 (P0)** Les six onglets, accessibles au clavier, l'onglet courant annoncé (`aria-current`). Sur une édition en lecture seule (F-103), seuls Pilotage, Vue B2B (lecture) et Aide restent ouverts.
- **F-154 (P0)** Chaque écran d'édition porte un lien « Ouvrir dans Strapi » vers l'objet correspondant (partie E).

## A. HelloAsso

Écran « Édition », carte « Inscriptions HelloAsso ».

- **F-155 (P0)** Formulaire : identifiant de l'association (`helloassoOrgSlug`), type de formulaire (`helloassoFormType`), identifiant du formulaire (`helloassoFormSlug`). Une aide montre où lire ces valeurs dans l'URL HelloAsso ; coller l'URL complète du formulaire remplit les trois champs.
- **F-156 (P0)** Bouton « Tester la connexion » : appelle HelloAsso avec ces valeurs **sans rien importer** et affiche le nom du formulaire, le nombre de billets, et la liste des champs personnalisés trouvés (leurs libellés seulement). Erreurs en clair : identifiants de l'environnement absents, association ou formulaire introuvable, accès refusé.
- **F-157 (P0)** Correspondance des champs (`helloassoFieldMap`) : pour « Entreprise » et « Fonction », une liste déroulante alimentée par les champs trouvés en F-156 ; valeur par défaut reconnue automatiquement (« Organisation », « Poste »).
- **F-158 (P1)** Adresse du webhook HelloAsso (I-13) affichée avec un bouton « Copier », et date de la dernière notification reçue.
- **F-159 (P0)** État des secrets : « Identifiants HelloAsso présents » ou « absents, à régler au déploiement » (D-21), sans jamais afficher de valeur.
- **R-92** Changer d'association ou de formulaire alors que des inscrits sont déjà importés demande une confirmation qui annonce la conséquence : les inscrits du premier formulaire restent, et seront vus comme annulés à la prochaine synchronisation sauf verrou R-89.

## B. Programme et intervenants

Écran « Programme » : la journée se présente comme la page publique de l'édition (`/editions/{slug}`) et comme E8, séquence par séquence dans l'ordre horaire, chaque bloc modifiable sur place.

- **F-160 (P0)** Séquence : créer, modifier, supprimer. Champs : titre, sous-titre, heure de début et de fin (formats de R-86, contrôlés à la saisie), nature (intervention, pause B2B, autre), thème, description en texte riche (D-23), organisations associées.
- **F-161 (P0)** Ordre : les séquences se rangent par heure ; à heure égale, boutons « Monter » et « Descendre ». Les interventions d'une séquence se rangent par les mêmes boutons (pas de glisser-déposer obligatoire : clavier et mobile d'abord).
- **F-162 (P0)** Intervention : créer, modifier, supprimer dans une séquence. Champs : description en texte riche, intervenants, support de présentation (fichier).
- **F-163 (P0)** Intervenant : dans une intervention, recherche parmi les intervenants existants (nom, organisation) ou création sur place. Champs : nom, fonction, organisation (recherche ou création, partie C), photo, biographie en texte riche, page LinkedIn, sujet.
- **F-164 (P0)** Brouillon et publication (D-22) : un bandeau indique « Modifications non publiées » et leur nombre ; « Aperçu » ouvre la page publique en mode brouillon ; « Publier le programme » demande confirmation et liste ce qui change.
- **F-165 (P0)** Pauses B2B : passer une séquence en « pause B2B » exige une heure de fin (R-86). À la publication, si les pauses ont changé, l'écran propose « Régénérer les créneaux » (F-94) et affiche le compte rendu.
- **F-166 (P1)** Assistant « Créer le programme » pour une édition vide, en cinq étapes : trame horaire (début, fin, pauses), séquences (titre et thème), interventions et intervenants, pauses B2B, relecture et publication. L'assistant écrit dans le même brouillon que l'éditeur et peut être quitté à tout moment.
- **F-167 (P2)** « Reprendre le programme d'une autre édition » : copie les séquences d'une édition existante comme point de départ (complète la carte « Dupliquer l'édition »).
- **F-168 (P1)** Réglages généraux de l'édition sur l'écran « Édition » : titre, date, ville, lieux, lien d'inscription, image, couleur. Les contenus d'après événement (galerie, vidéos, bilan, témoignages) restent dans Strapi.
- **R-93** Garde de suppression : une séquence qui porte des créneaux avec des rendez-vous en attente ou acceptés ne se supprime pas et ne perd pas sa nature de pause (NF-63) ; le message dit combien de rendez-vous sont concernés et renvoie vers la Vue B2B.
- **R-94** Garde d'horaire : modifier les heures d'une pause qui porte des rendez-vous acceptés est refusé tant que ces rendez-vous ne sont pas déplacés ou annulés.
- **R-95** Supprimer un intervenant du programme ne supprime ni la fiche intervenant ni le compte de la personne ; son compte perd seulement le lien `speaker` si l'intervenant n'a plus aucune intervention dans l'édition, après confirmation.

## C. Organisations, personnes et rôles

Écran « Personnes », deux listes liées : organisations et personnes de l'édition.

- **F-169 (P0)** Organisation : créer, modifier. Champs : nom, logo, site web, page LinkedIn, description courte. Recherche d'abord parmi les organisations existantes (nom sans casse ni accents) pour éviter les doublons ; une organisation proche est proposée avant toute création.
- **F-170 (P0)** Personne : créer dans une organisation ou sans organisation. Champs : prénom, nom, e-mail, fonction. S'appuie sur `POST /admin/{edition}/attendees`, déjà en place (fiche d'un inscrit).
- **F-171 (P0)** Rôles cumulables (D-20), par cases à cocher sur la fiche de la personne :
  - **Participant** : toujours vrai pour un inscrit actif.
  - **Intervenant** : lie la personne à un intervenant du programme (recherche, ou création depuis la personne : nom, fonction, organisation repris).
  - **Exposant** : fait de son organisation un exposant de l'édition si elle ne l'est pas (numéro de stand facultatif) et de la personne un de ses représentants.
  - **Organisateur** : pose `role = organizer` ; les adresses de `ORGANIZER_EMAILS` sont affichées comme organisateurs non modifiables ici.
- **F-172 (P0)** Exposants : sur la fiche d'une organisation, case « Exposant de cette édition », numéro de stand, sujets, liste de ses représentants (ajout, retrait). Reprend et remplace la saisie dans Strapi et l'import par fichier (`import-edition-data.js`).
- **F-173 (P1)** Table dédiée d'un intervenant (R-19) : numéro de table sur sa fiche, avec la liste des tables déjà dédiées.
- **F-174 (P1)** Sujets de l'édition (étiquettes des profils et de l'annuaire) : créer, renommer, lier aux séquences, retirer. Bouton « Donner aux intervenants les sujets de leurs séquences » (comportement de `speakerTopics`, sans retirer un sujet déjà coché).
- **F-175 (P1)** Import par collage : coller un tableau (prénom, nom, e-mail, organisation, fonction, rôles) ; l'écran montre la simulation ligne par ligne (créé, mis à jour, ignoré et pourquoi) avant d'écrire. Même logique que le script d'import, sans fichier sur le serveur.
- **R-96** Une personne créée à la main et un billet HelloAsso de la même adresse sont **une seule personne** : la synchronisation rattache le billet au compte existant sans toucher à ses rôles ni aux champs corrigés (R-89). Deux personnes de même nom et d'adresses différentes sont signalées comme doublon possible, jamais fusionnées d'office.
- **R-97** Retirer le rôle exposant ou intervenant à une personne qui porte des rendez-vous en attente ou acceptés à ce titre est refusé avec le compte de ces rendez-vous (même garde que NF-63).
- **F-176 (P0)** Aucun e-mail n'est envoyé à la création : l'e-mail de bienvenue part par la carte « E-mail de bienvenue » du pilotage, comme aujourd'hui. La fiche dit si la personne l'a reçu.

## D. Fonctions B2B

Écran « Édition », carte « Rendez-vous B2B », et onglet « Vue B2B ».

- **F-177 (P0)** Interrupteur « Espace participant ouvert » (`participantSpaceEnabled`) avec la liste de contrôle d'ouverture (`exploitation.md`, section 6) : HelloAsso réglé, première synchronisation faite, programme publié, créneaux générés. Un point manquant n'empêche pas d'ouvrir, il est signalé.
- **F-178 (P1)** Interrupteur « Rendez-vous B2B » : nouveau champ scalaire `b2bEnabled` sur l'édition (vrai par défaut pour les éditions existantes). Désactivé : l'agenda, les demandes de rendez-vous, les suggestions de rendez-vous et les relances associées disparaissent de l'espace ; annuaire, messagerie et programme restent.
- **F-179 (P0)** Réglages : nombre de tables, durée d'un créneau, ouverture et fermeture des demandes (F-93, date et heure en Europe/Paris, fermeture vide : la veille à 18h00). Mêmes gardes que l'administration (NF-63, NF-64) : fenêtre cohérente, pas moins de tables que la plus haute table occupée.
- **F-180 (P0)** Pauses B2B : liste des séquences de la journée avec une case « Pause B2B » chacune (même donnée que F-165), nombre de créneaux qui en résulte, bouton « Régénérer les créneaux » et son compte rendu (F-94).
- **F-181 (P0)** Vue B2B : grille créneaux par tables et stands de la journée, chaque case portant le rendez-vous (les deux noms, statut), les tables dédiées et bloquées (R-90). Actions existantes reprises : déplacer, annuler, bloquer une table (F-139 à F-141). Filtre par pause, recherche par nom.
- **F-182 (P1)** Vue B2B « jour J » : mode plein écran lisible sur tablette à l'accueil, créneau en cours mis en avant, rafraîchi toutes les 30 secondes, sans action destructrice à portée de doigt.
- **F-183 (P2)** Impression du plan de tables d'un créneau (PDF, une page par pause).

## E. Bascule vers Strapi

- **F-184 (P0)** Lien « Ouvrir dans Strapi » sur chaque objet (édition, séquence, intervention, intervenant, organisation, exposant, inscrit, réglage des badges) : ouvre dans un nouvel onglet la fiche du gestionnaire de contenu, `/strapi/admin/content-manager/collection-types/{uid}/{documentId}`.
- **F-185 (P0)** Lien général « Administration Strapi » dans l'onglet Aide et le pied de l'interface, avec le rappel : compte séparé, rôle « Organisation Xylofutur », demande d'accès à Kosmio (`guide-organisateur.md`, section 5).
- **F-186 (P1)** Retour : dans Strapi, le champ d'aide de l'édition porte le lien vers l'interface organisation de cette édition.
- Pas de connexion unique entre l'espace et Strapi dans ce lot (question ouverte 4).

## F. Documentation

Onglet « Aide », et liens « ? » contextuels sur chaque carte.

- **F-187 (P0)** Pages d'aide rendues dans l'interface depuis `docs/espace/aide/*.md` (D-24), avec sommaire, recherche dans les titres, ancres par section et impression propre. Sommaire proposé :
  1. Préparer une édition de A à Z (liste de contrôle datée : J-60, J-30, J-7, jour J, J+1)
  2. Régler HelloAsso et synchroniser les inscrits
  3. Construire et publier le programme
  4. Organisations, personnes, intervenants, exposants
  5. Rendez-vous B2B : tables, créneaux, fenêtre, vue du jour J
  6. E-mails de bienvenue et relances
  7. Badges : générer, imprimer, plier
  8. Exports et bilan
  9. Strapi : se connecter, le gestionnaire de contenu, brouillon et publication, la médiathèque
  10. Strapi : ce qu'on y règle encore (pages du site, partenaires, galerie, bilan), ce qu'il ne faut pas toucher
  11. En cas de problème (un inscrit ne reçoit pas son lien, un doublon, une synchronisation en erreur)
- **F-188 (P0)** Captures d'écran : script `web/tests/aide/captures.spec.ts`, lancé sur le jeu de recette fictif, qui produit les images de l'interface organisation et de Strapi (admin construit) dans `docs/espace/aide/captures/`. Chaque capture est annotée (numéros sur les zones citées dans le texte). Une capture qui change sans que le texte change fait échouer une vérification, pour que l'aide ne se périme pas en silence.
- **F-189 (P1)** Aide contextuelle : chaque carte et chaque écran de ce lot porte un « ? » qui ouvre la section d'aide correspondante dans un panneau, sans quitter l'écran.
- Ton : phrases courtes, une action par étape, vocabulaire de l'interface, aucun jargon technique. Remplace `guide-organisateur.md`, qui devient la source des pages 1 à 8.

## Modèle de données

Aucune relation existante ne change (A-15). Ajouts, tous scalaires ou sur des types `api::espace.*` :

| Type | Champ | Rôle |
|---|---|---|
| `edition` | `b2bEnabled` (boolean, défaut vrai) | F-178 |
| `api::espace.admin-log` (nouveau) | `edition`, `actorEmail`, `action`, `targetUid`, `targetId`, `summary`, `createdAt` | NF-73 |

Les rôles cumulés (D-20) n'ajoutent aucun champ : ils se lisent sur `speaker`, `exhibitor` et `role`.

## API (à reporter dans `06-api.md`)

Toutes sous `/api/espace/admin/{edition}`, garde organisateur de l'édition (NF-01), contrôle d'origine, refus sur une édition en lecture seule.

| Méthode | Route | Rôle |
|---|---|---|
| GET, PATCH | `/settings` | réglages de l'édition, HelloAsso et B2B (F-155, F-157, F-168, F-177 à F-179) |
| POST | `/helloasso/test` | essai de connexion sans import (F-156) |
| GET | `/program?status=draft` | programme en brouillon, avec l'état de publication de chaque objet (F-164) |
| POST, PATCH, DELETE | `/sequences`, `/sequences/{id}` | F-160, F-161, F-165, R-93, R-94 |
| POST, PATCH, DELETE | `/sequences/{id}/interventions`, `/interventions/{id}` | F-162 |
| GET, POST, PATCH | `/intervenants`, `/intervenants/{id}` | recherche, création, modification (F-163) |
| POST | `/program/publish` | publication groupée, réponse : ce qui a été publié (D-22) |
| GET, POST, PATCH | `/organisations`, `/organisations/{id}` | F-169, F-172 |
| PATCH | `/attendees/{id}/roles` | rôles cumulés, corps `{ speaker?: id ou null, exhibitor?: id ou null, organizer?: boolean }` (F-171, R-97) |
| GET, POST, PATCH, DELETE | `/topics`, `/topics/{id}` | F-174 |
| POST | `/people/import` | simulation puis écriture d'un collage, corps `{ rows, apply }` (F-175) |
| POST | `/uploads` | photo, logo, support : images et PDF seulement, taille plafonnée (NF-74) |

**I-45** L'essai de connexion HelloAsso réutilise le client de la synchronisation (`lib/helloasso.js`) avec une pagination limitée à la première page ; aucun billet n'est écrit ni journalisé.

## NF. Sécurité, RGPD, qualité

- **NF-71** Toutes les routes de ce lot sont réservées à l'organisateur de l'édition visée ; un organisateur d'une autre édition est refusé (NF-01). Aucune route ne rend un secret.
- **NF-72** Texte riche : le serveur nettoie ce qu'il reçoit avec la même liste blanche que l'affichage (`safeHtml`) ; un script, un gestionnaire d'événement ou une URL `javascript:` n'est jamais enregistré.
- **NF-73** Journal d'administration : chaque écriture de ce lot ajoute une ligne (qui, quoi, quand, sur quel objet, résumé sans donnée personnelle au-delà du nom). Consultable dans le pilotage, purgé avec l'édition.
- **NF-74** Téléversements : types `image/png`, `image/jpeg`, `image/webp`, `application/pdf` ; 5 Mo pour une image, 20 Mo pour un support ; nom de fichier neutralisé.
- **NF-75** Écritures concurrentes : chaque modification envoie la date de dernière mise à jour qu'elle a lue ; si l'objet a changé entre-temps (autre organisateur, ou Strapi), la réponse est 409 et l'écran propose de recharger. Rien n'est écrasé en silence.
- **NF-76** Accessibilité AA sur tous les écrans du lot : formulaires étiquetés, erreurs reliées aux champs, éditeur de texte riche utilisable au clavier, ordre par boutons (F-161). Mêmes tokens que `07-design.md`.
- Le contrat de maintenance du MCP (`strapi/mcp/content-types.json`) suit tout ajout de champ (`b2bEnabled`).

## Critères d'acceptation

- **T-76** Étant donné une édition sans réglage HelloAsso, quand l'organisateur colle l'URL du formulaire et lance « Tester la connexion » contre le faux HelloAsso, alors le nom du formulaire, le nombre de billets et les champs « Organisation » et « Poste » s'affichent, et aucun inscrit n'est créé.
- **T-77** Étant donné des identifiants d'environnement absents, alors l'écran dit « absents, à régler au déploiement » et aucune valeur de secret ne figure dans une réponse.
- **T-78** Étant donné une édition vide, quand l'organisateur crée trois séquences, deux interventions et un intervenant nouveau, alors la page publique ne change pas avant « Publier le programme », et montre tout après.
- **T-79** Étant donné une pause B2B qui porte un rendez-vous accepté, alors sa suppression, son changement de nature et son changement d'horaire sont refusés avec le nombre de rendez-vous concernés.
- **T-80** Étant donné une description saisie avec du gras, une liste et une balise `<script>` collée, alors le gras et la liste sont rendus sur la page publique et le script n'est ni enregistré ni rendu.
- **T-81** Étant donné une personne créée à la main avec les rôles intervenant et exposant, alors elle apparaît dans le programme comme intervenante, reçoit les demandes adressées à son stand, et son badge porte « Intervenant ».
- **T-82** Étant donné cette même personne, quand un billet HelloAsso de la même adresse est synchronisé, alors il n'existe toujours qu'un compte et ses rôles sont intacts.
- **T-83** Étant donné une organisation « Wood & Co » existante, quand l'organisateur saisit « wood&co », alors l'existante lui est proposée avant toute création.
- **T-84** Étant donné `b2bEnabled` désactivé, alors un participant ne voit ni agenda ni bouton de demande de rendez-vous, et l'annuaire, la messagerie et le programme fonctionnent.
- **T-85** Étant donné deux organisateurs qui modifient la même séquence, alors le second enregistrement reçoit 409 et rien n'est perdu.
- **T-86** Étant donné un participant non organisateur, ou l'organisateur d'une autre édition, alors toutes les routes du lot répondent 403.
- **T-87** Étant donné chaque objet du lot, alors « Ouvrir dans Strapi » mène à sa fiche dans le gestionnaire de contenu.
- **T-88** Étant donné le script de captures lancé sur le jeu de recette, alors chaque page d'aide a ses images, sans adresse hors `@example.org`, et l'onglet Aide les affiche.

## Découpage et ordre proposés

| Lot | Contenu | Effort | Dépend de |
|---|---|---|---|
| AD-1 | Onglets, écran « Édition » : réglages, HelloAsso, B2B (F-153 à F-159, F-168, F-177, F-179, F-180), liens Strapi (F-184 à F-186) | L, 2 jours | rien |
| AD-2 | Rôles cumulés (D-20) et écran « Personnes » (F-169 à F-173, F-176, R-96, R-97) | L, 3 jours | rien |
| AD-3 | Éditeur du programme, brouillon et publication (F-160 à F-165, R-93 à R-95, NF-72, NF-75) | L, 4 à 5 jours | AD-2 pour la recherche d'organisations |
| AD-4 | Vue B2B (F-181, F-182) et `b2bEnabled` (F-178) | L, 2 jours | AD-1 |
| AD-5 | Documentation et captures (F-187 à F-189) | L, 3 jours | AD-1 à AD-4 pour les captures finales ; les pages Strapi peuvent partir avant |
| AD-6 | Confort : assistant (F-166), sujets (F-174), import par collage (F-175), journal (NF-73), reprise d'un programme (F-167), impression (F-183) | L, 3 jours | AD-2, AD-3 |

Total indicatif : 17 à 18 jours de développement, tests compris, hors recette. Premier palier utile : AD-1 puis AD-5 limité aux pages Strapi, qui rendent déjà Xylofutur autonome sur les réglages sans attendre l'éditeur de programme.

## Hors lot

- Contenus du site public hors programme : pages statiques, page d'accueil, partenaires, galerie, vidéos, bilan, témoignages (restent dans Strapi).
- Création d'une édition de zéro (reste la carte « Dupliquer l'édition » et Strapi).
- Gestion des comptes et des rôles de Strapi, connexion unique entre l'espace et Strapi.
- Modification des secrets et des variables de déploiement.
- Paiement, billetterie, modification d'un billet HelloAsso.

## Questions ouvertes

1. **La phrase inachevée « une vue Administrateur qui… »** : que doit montrer ou permettre cette vue ? Hypothèse par défaut (D-19) : pas de vue ni de rôle distinct, l'organisateur a tout. Si un rôle administrateur est voulu (par exemple Kosmio et un référent Xylofutur seuls à régler HelloAsso, les rôles et la bascule Strapi), il s'ajoute par une variable `ADMIN_EMAILS` et masque ces écrans aux autres organisateurs.
2. « Basculer sur la vue B2B de l'édition » : comprise ici comme une vue organisateur des créneaux, tables et rendez-vous (F-181, F-182). S'il s'agit de voir l'espace comme un participant (« voir comme »), c'est une autre fonction, à spécifier avec ses gardes (aucune action au nom d'autrui).
3. Le rôle exposant porte-t-il sur la personne ou sur l'organisation ? Hypothèse : l'organisation expose, ses personnes cochées « Exposant » en sont les représentants (modèle actuel).
4. Connexion unique vers Strapi : souhaitée plus tard ? Elle suppose de créer les comptes Strapi depuis l'espace, donc de sortir de V5-G.
5. L'assistant de F-166 : pas à pas par formulaire (hypothèse), ou assistant conversationnel qui propose un programme à partir d'un texte collé ? Le second relève d'un service d'IA et d'un autre budget.
6. Faut-il pouvoir éditer le programme d'une édition déjà publiée et ouverte pendant la journée (retard, intervenant remplacé) ? Hypothèse : oui, avec la même publication explicite.
7. Format réel des champs de texte riche en base (HTML ou Markdown selon les saisies passées) : à relever avant AD-3 pour fixer D-23.
