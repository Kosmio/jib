# Régler HelloAsso et synchroniser les inscrits

Les inscrits arrivent du formulaire HelloAsso de l’édition. Réglage dans l’onglet **Édition**, section « Inscriptions HelloAsso ».

## Régler le formulaire

1. Dans HelloAsso, ouvrir la page d’inscription de l’édition et copier son adresse, par exemple `https://www.helloasso.com/associations/xylofutur/evenements/journee-innovation`.
2. La coller dans « Adresse du formulaire HelloAsso » : l’association, le type et le formulaire se remplissent seuls.
3. Cliquer sur **Tester la connexion**. Le nom du formulaire et le nombre de billets s’affichent. Rien n’est importé.
4. « Correspondance des champs » : vérifier que « Entreprise » pointe sur le champ « Organisation » du formulaire et « Fonction » sur « Poste ». Les champs reconnus sont choisis d’office.
5. **Enregistrer**.

Le message « Identifiants HelloAsso du serveur absents » signifie que la clé d’accès à l’API HelloAsso n’est pas installée sur le serveur. Elle ne se règle pas ici : la demander à Kosmio.

## Changer de formulaire

Si des inscrits viennent déjà de l’ancien formulaire, l’écran demande confirmation. Les inscrits restent, mais seront vus comme annulés à la prochaine synchronisation, sauf ceux dont le statut a été fixé à la main.

## Recevoir les inscriptions en direct

Copier l’adresse affichée sous « Notifications HelloAsso » et la coller dans HelloAsso : « Mon compte », « Intégrations et API », « Notifications ». Sans elle, les inscrits arrivent à la synchronisation suivante, toutes les 15 minutes.

## Synchroniser à la main

Onglet **Pilotage**, carte de synchronisation en haut de page : **Synchroniser maintenant**. Le compte rendu dit combien d’inscrits sont créés, mis à jour ou annulés, et liste les billets à vérifier.
