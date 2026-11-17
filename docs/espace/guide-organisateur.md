# Guide de l’organisateur : l’espace participant

Pour l’équipe Xylofutur. Deux pages : préparer une édition, ouvrir l’espace, corriger un inscrit, et ce qu’il ne faut pas toucher. L’administration se trouve sur `/strapi/admin`, le pilotage dans l’espace, onglet « Pilotage » (réservé aux adresses de la liste des organisateurs).

## 1. Préparer une édition

Dans l’administration : Gestionnaire de contenu, « Édition », puis l’édition concernée. Les réglages de l’espace sont regroupés en fin de formulaire, dans l’ordre où on s’en sert. Chaque champ porte une aide.

1. **Espace participant ouvert** : laisser décoché tant que tout n’est pas prêt.
2. **HelloAsso** : identifiant de l’association, type de formulaire (Event), identifiant du formulaire. Sans ces trois valeurs, aucun inscrit n’est importé.
3. **Rendez-vous** : durée d’un créneau (15 minutes par défaut), nombre de tables, ouverture et fermeture des demandes. Fermeture laissée vide : la veille à 18h00.
4. **Programme** : dans « Séquence », créer une séquence de nature « Pause rendez-vous B2B » pour chaque plage de rendez-vous. Les heures s’écrivent `10h45` (`10:45` et `10 h 45` sont compris). Un `10.45` est refusé à l’enregistrement. L’heure de fin est obligatoire sur une pause.
5. **Publier** l’édition et les séquences : rien ne s’applique tant que ce n’est pas publié.
6. Dans le pilotage, lancer « Régénérer les créneaux » et vérifier le nombre annoncé.

## 2. Ouvrir l’espace et envoyer les e-mails de bienvenue

1. Dans l’édition, cocher « Espace participant ouvert » et publier.
2. Dans le pilotage, lancer une synchronisation HelloAsso. Les inscrits arrivent, sans e-mail : rien ne part tant que l’envoi n’a pas été lancé.
3. Vérifier la carte « État du service » : toute ligne rouge dit quoi corriger (expéditeur d’e-mail, accès HelloAsso, tâches planifiées).
4. Dans la carte « E-mail de bienvenue » : lire l’aperçu, relire le nombre d’inscrits, puis « Envoyer à N inscrits » et confirmer. L’envoi est possible de 8h00 à 20h00, heure de Paris.
5. Ensuite, les nouveaux inscrits reçoivent seuls leur e-mail à chaque synchronisation. Un second clic n’envoie rien de plus.

## 3. Corriger un inscrit

Dans l’administration : « Participant ». La liste affiche nom, prénom, entreprise, e-mail, rôle et statut ; la recherche trouve par nom ou e-mail.

- **Faute de saisie** (nom, entreprise, fonction, e-mail) : corriger la fiche, enregistrer. Un champ corrigé à la main n’est plus écrasé par l’import suivant.
- **Inscrit qui ne vient plus** : passer le statut à « cancelled » plutôt que supprimer. Ses rendez-vous en attente sont à traiter avant.
- **Suppression** : refusée tant que la personne a des rendez-vous en attente ou acceptés. Le message le dit.
- **Nouvel invité** : de préférence par l’ajout prévu dans le pilotage plutôt que dans l’administration.

## 4. Ce qu’il ne faut pas toucher

- Les champs grisés d’un participant (activation, consentements, préférences, identifiants HelloAsso) : ils appartiennent à l’import et au choix de la personne.
- « Correspondance des champs HelloAsso » : réglage technique, une erreur casse l’import.
- La date d’envoi des e-mails de bienvenue : posée par le pilotage.
- L’identifiant URL d’une édition qui a des participants, la durée des créneaux dès qu’un rendez-vous existe : le système les refuse.
- Le nombre de tables en dessous d’une table déjà attribuée, et la date de fermeture des demandes quand des demandes attendent une réponse : refusés aussi.
- Les créneaux, rendez-vous, journaux d’e-mails et exécutions de synchronisation : ils se lisent, ils ne se saisissent pas à la main.
- Les bases de données, les variables d’environnement et les déploiements : à demander à Kosmio.

En cas de doute, ne rien changer et écrire à Kosmio avec une capture de l’écran concerné.
