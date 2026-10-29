'use strict';

/**
 * Reproduit l'aide `env` que Strapi passe aux fichiers de `strapi/config/*.js`, pour un jeu de variables donné
 * (valeur par défaut si la variable est absente). Les tests de configuration n'ont ainsi pas besoin de démarrer Strapi.
 */

function makeEnv(vars = {}) {
  const has = (key) => vars[key] !== undefined;
  const env = (key, fallback) => (has(key) ? vars[key] : fallback);
  env.int = (key, fallback) => (has(key) ? Number.parseInt(vars[key], 10) : fallback);
  env.float = (key, fallback) => (has(key) ? Number.parseFloat(vars[key]) : fallback);
  env.bool = (key, fallback) => (has(key) ? vars[key] === 'true' : fallback);
  env.json = (key, fallback) => (has(key) ? JSON.parse(vars[key]) : fallback);
  env.array = (key, fallback) =>
    has(key)
      ? String(vars[key])
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((value) => value.trim().replace(/^"|"$/g, ''))
      : fallback;
  return env;
}

module.exports = { makeEnv };
