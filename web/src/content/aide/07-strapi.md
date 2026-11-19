# Strapi : ce qu’on y règle encore

L’interface organisation couvre l’organisation courante. Strapi reste l’outil des contenus du site public et des réglages fins.

## Se connecter

L’administration est sur `/strapi/admin`. Le compte Strapi est distinct du compte de l’espace : il se demande à Kosmio, avec le rôle « Organisation Xylofutur ». Le lien **Administration Strapi** est à droite des onglets ; chaque écran porte un lien **Ouvrir dans Strapi** vers la fiche correspondante.

## Ce qui se fait dans Strapi

- Les pages du site, la page d’accueil, les partenaires.
- Après l’édition : galerie, vidéos, bilan, témoignages.
- Les photos des intervenants, les logos des organisations, les supports de présentation (médiathèque).
- Les réglages des badges (plan du lieu, couleur du bandeau).

## Brouillon et publication

Dans Strapi aussi, une modification reste en brouillon jusqu’à **Publish**. Une fiche modifiée dans Strapi apparaît « Modifié » dans l’onglet Programme ; « Publier le programme » la met en ligne avec le reste.

## Ce qu’il ne faut pas toucher

- Les champs grisés d’un participant (activation, consentements, identifiants HelloAsso).
- La correspondance des champs HelloAsso en JSON : la régler dans l’onglet Édition.
- Les créneaux, rendez-vous, journaux d’e-mails et synchronisations : ils se lisent, ils ne se saisissent pas.
- Les bases de données, les variables du serveur et les déploiements : à demander à Kosmio.
