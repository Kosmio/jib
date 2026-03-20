'use strict';

const SEED_ARTICLES = [
  {
    title: 'Bienvenue sur Skelly',
    slug: 'bienvenue-sur-skelly',
    excerpt: "Découvrez Skelly, votre nouveau starter pour démarrer rapidement vos projets web.",
    content: `## Skelly est prêt

Félicitations, votre site est en ligne ! Skelly est construit sur une stack technique moderne, pensée pour la performance et la simplicité de maintenance.

### Ce que vous pouvez faire

- **Publier des articles** via l'interface d'administration
- **Recevoir des messages** grâce au formulaire de contact
- **Collecter des inscriptions** à votre newsletter
- **Respecter la vie privée** de vos visiteurs avec la gestion des cookies

### Comment modifier le contenu

Rendez-vous sur l'interface d'administration pour créer, modifier ou supprimer vos articles. Chaque article peut contenir du texte riche, des images et des liens.

Le contenu est séparé du code : vous pouvez modifier vos textes sans toucher au design.`,
    published_date: '2026-01-15',
  },
  {
    title: 'Publier et gérer vos articles',
    slug: 'publier-et-gerer-vos-articles',
    excerpt: "Apprenez à créer, organiser et publier vos articles depuis l'interface d'administration de votre site.",
    content: `## Créer un article

Depuis le panneau d'administration, vous pouvez créer un nouvel article en renseignant :

1. Un **titre** clair et descriptif
2. Un **résumé** qui apparaîtra dans les aperçus
3. Le **contenu** en texte enrichi (gras, listes, liens, images...)
4. Une **image** de couverture optionnelle
5. Une **date de publication**

### Mise en forme du contenu

Le contenu supporte la syntaxe Markdown, ce qui permet de structurer facilement vos textes :

- Les titres avec \`##\` et \`###\`
- Le **gras** et l'*italique*
- Les listes numérotées et à puces
- Les blocs de code avec \`\`\`
- Les liens et les images

### Brouillons et publication

Vous pouvez sauvegarder un article en brouillon avant de le publier. Seuls les articles publiés apparaissent sur le site.`,
    published_date: '2026-02-01',
  },
  {
    title: 'Personnaliser votre site',
    slug: 'personnaliser-votre-site',
    excerpt: "Ce guide vous explique comment adapter le design, les couleurs et les fonctionnalités de votre site à votre identité.",
    content: `## Adapter le design

Le site utilise un système de thème centralisé. Les couleurs, la typographie et les espacements se modifient en un seul endroit.

### Couleurs

Les couleurs principales sont définies dans le fichier de thème :

- **Couleur primaire** — utilisée pour les boutons, les liens et les éléments d'accent
- **Couleur d'accentuation** — utilisée pour les appels à l'action
- **Couleurs neutres** — arrière-plans et textes

### Typographie

La police par défaut est Inter, une typographie moderne et lisible. Elle peut être remplacée par n'importe quelle police Google Fonts.

### Fonctionnalités optionnelles

Certaines fonctionnalités s'activent via la configuration :

- **Analytics** — ajoutez votre URL Matomo pour suivre la fréquentation
- **Anti-bot** — protégez vos formulaires avec Altcha (self-hosted)
- **Newsletter** — connectez votre compte Brevo pour les inscriptions

Chaque fonctionnalité est indépendante et s'active uniquement si elle est configurée.`,
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
    const articles = await strapi.documents('api::article.article').findMany({ limit: 1 });
    if (articles.length === 0) {
      for (const article of SEED_ARTICLES) {
        await strapi.documents('api::article.article').create({
          data: article,
          status: 'published',
        });
      }
      strapi.log.info(`Seeded ${SEED_ARTICLES.length} demo articles.`);
    }

    // Set public permissions for API endpoints
    await setPublicPermissions(strapi, [
      { api: 'article', actions: ['find', 'findOne'] },
      { api: 'captcha', actions: ['challenge'] },
      { api: 'contact', actions: ['send'] },
      { api: 'newsletter', actions: ['subscribe'] },
    ]);
  },
};

async function setPublicPermissions(strapi, endpoints) {
  const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'public' },
  });

  if (!publicRole) return;

  for (const { api, actions } of endpoints) {
    for (const action of actions) {
      const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
        where: {
          role: publicRole.id,
          action: `api::${api}.${api}.${action}`,
        },
      });

      if (!existing) {
        await strapi.db.query('plugin::users-permissions.permission').create({
          data: {
            role: publicRole.id,
            action: `api::${api}.${api}.${action}`,
          },
        });
        strapi.log.info(`Granted public permission: ${api}.${action}`);
      }
    }
  }
}
