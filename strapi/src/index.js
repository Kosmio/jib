'use strict';

const SEED_ARTICLES = [
  {
    title: 'Bienvenue sur le Skeleton',
    slug: 'bienvenue-sur-le-skeleton',
    excerpt: "Découvrez ce projet squelette Astro + Strapi, prêt à l'emploi pour démarrer rapidement vos projets web.",
    content: `## Un point de départ pour vos projets

Ce skeleton combine **Astro** en SSR avec **Strapi v4** comme CMS headless. Il inclut tout ce dont vous avez besoin pour démarrer :

- Gestion de contenu via Strapi
- Rendu côté serveur avec Astro
- Composants React interactifs
- Tailwind CSS pour le style
- Docker pour le déploiement

### Comment l'utiliser

1. Clonez ce projet
2. Personnalisez les types de contenu dans Strapi
3. Adaptez les composants Astro à votre charte graphique
4. Déployez avec Docker

C'est aussi simple que ça !`,
    published_date: '2026-01-15',
  },
  {
    title: 'Formulaire de contact et newsletter',
    slug: 'formulaire-de-contact-et-newsletter',
    excerpt: 'Le skeleton inclut un formulaire de contact fonctionnel et une inscription newsletter avec protection reCAPTCHA.',
    content: `## Contact et Newsletter intégrés

### Formulaire de contact

Le formulaire de contact envoie les messages via **Brevo** (ex-Sendinblue). Il suffit de configurer les variables d'environnement :

- \`EMAIL_API_KEY\` — votre clé API Brevo
- \`EMAIL_CONTACT_TO\` — l'adresse de réception
- \`EMAIL_CONTACT_TEMPLATE_ID\` — l'ID du template transactionnel

### Newsletter

L'inscription newsletter dans le footer fonctionne de la même manière, avec en plus une vérification **reCAPTCHA Enterprise** pour bloquer les bots.

### Protection reCAPTCHA

Le reCAPTCHA Enterprise est intégré côté frontend (score-based, invisible) et vérifié côté Strapi avant chaque inscription.`,
    published_date: '2026-02-01',
  },
  {
    title: 'Déploiement avec Docker',
    slug: 'deploiement-avec-docker',
    excerpt: "L'infrastructure Docker inclut des Dockerfiles multi-stage, un script de déploiement unifié et des overlays par environnement.",
    content: `## Infrastructure Docker

Le skeleton suit la même structure que nos projets en production :

### Structure

\`\`\`
infra/
├── deploy/
│   ├── base/docker-compose.base.yml
│   ├── overlays/
│   │   ├── local/
│   │   ├── dev/
│   │   └── prod/
│   └── scripts/deploy.sh
├── docker/
│   ├── strapi/Dockerfile
│   └── website/Dockerfile
└── make/
    ├── make_strapi.mk
    └── make_web.mk
\`\`\`

### Commandes

- \`make infra-up\` — démarre l'infrastructure locale (Postgres)
- \`make infra-down\` — arrête tout
- \`make build\` — construit les images Docker
- \`make lint\` — lint les Dockerfiles avec Hadolint

### Environnements

Chaque environnement a son propre overlay avec ses variables. Les secrets ne sont jamais commités — ils sont injectés au déploiement.`,
    published_date: '2026-03-01',
  },
];

module.exports = {
  register(/*{ strapi }*/) {},

  async bootstrap({ strapi }) {
    // Set French as default locale if not already configured
    const localeService = strapi.plugin('i18n').service('locales');
    const existingLocales = await localeService.find();
    const hasFrench = existingLocales.some((l) => l.code === 'fr');

    if (!hasFrench) {
      await localeService.create({ code: 'fr', name: 'French (fr)' });
    }

    const frLocale = (await localeService.find()).find((l) => l.code === 'fr');
    if (frLocale && !frLocale.isDefault) {
      await localeService.setIsDefault(frLocale.id);
    }

    // Seed demo articles if none exist
    const articleCount = await strapi.entityService.count('api::article.article');
    if (articleCount === 0) {
      for (const article of SEED_ARTICLES) {
        await strapi.entityService.create('api::article.article', {
          data: {
            ...article,
            publishedAt: new Date(),
          },
        });
      }
      strapi.log.info(`Seeded ${SEED_ARTICLES.length} demo articles.`);
    }
  },
};
