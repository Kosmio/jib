# TODO — Configuration post-wizard

## Avant le premier lancement

- [ ] Installer les dépendances : `cd strapi && pnpm install && cd ../web && pnpm install`
- [ ] Lancer PostgreSQL : `make infra-up`
- [ ] Créer un compte admin Strapi au premier lancement : http://localhost:1337/admin

## Avant la mise en production

- [ ] **Nom de domaine** : choisir et configurer le domaine du site
- [ ] **Brevo** : créer un compte sur brevo.com et obtenir une clé API
  - Renseigner `EMAIL_API_KEY` dans `strapi/.env` et les fichiers d'overlay
  - Créer un template email pour le formulaire de contact → renseigner `EMAIL_CONTACT_TEMPLATE_ID`
  - Créer une liste pour la newsletter → renseigner `EMAIL_LIST_ID`
- [ ] **Secrets de production** : regénérer tous les secrets pour les environnements dev/prod (les fichiers overlay contiennent `changeme`)
- [ ] **Docker registry** : configurer le registry dans les fichiers `.env.dev` et `.env.prod` (remplacer `ghcr.io/your-org/`)
- [ ] **Base de données** : provisionner PostgreSQL sur le serveur de production
- [ ] **HTTPS / SSL** : configurer un reverse proxy (Traefik, Caddy, nginx) avec certificat SSL

## À faire rapidement

- [ ] **Matomo** : déployer ou souscrire à une instance Matomo, puis renseigner `PUBLIC_MATOMO_URL` et `PUBLIC_MATOMO_SITE_ID`
- [ ] **Personnaliser la page d'accueil** : remplacer le contenu placeholder par le vrai contenu (hero, sections)
- [ ] **Créer les content types Strapi** pour les éditions d'événements (programme, intervenants, partenaires, infos pratiques, retours)
- [ ] **Créer les pages frontend** pour les éditions (liste des éditions, sous-pages par édition)
- [ ] **Carte interactive France** : implémenter la carte des régions avec les éditions
- [ ] **Logo et favicon** : vérifier le rendu du logo dans le header/footer, ajuster si besoin
- [ ] **Mentions légales** : rédiger et ajouter les mentions légales, politique de confidentialité, CGU
- [ ] **Meta descriptions SEO** : personnaliser les balises meta pour chaque page
- [ ] **Page "Qui sommes-nous ?"** : créer la page de présentation de Xylofutur, Fibois, CODIFAB
- [ ] **Page "Pourquoi ces événements ?"** : créer la page argumentaire
- [ ] **Page "Nos partenaires"** : créer la galerie de logos partenaires
- [ ] **Intégration inscription HelloAsso** : lien ou intégration vers la plateforme d'inscription
- [ ] **Lien Outlook Booking** : vérifier le lien de prise de RDV sur la page contact

## Bonus

- [ ] **CI/CD** : mettre en place un pipeline de déploiement automatisé
- [ ] **Backups** : configurer les sauvegardes de la base de données
- [ ] **Accessibilité RGAA** : vérifier le contraste des couleurs, la navigation clavier, les lecteurs d'écran
- [ ] **Performance** : viser un score PageSpeed > 80 en mobile, optimiser les images (WebP)
- [ ] **Partage réseaux sociaux** : ajouter les balises Open Graph et les boutons de partage LinkedIn
- [ ] **Cookie consent** : activer la bannière si des outils tiers posant des cookies sont ajoutés
