'use strict';

/**
 * Garde-fou réseau, à précharger avec `node --require` (ou NODE_OPTIONS) : refuse toute connexion TCP
 * dont l'hôte n'est pas la boucle locale. Les tests n'ont aucune raison d'appeler Internet (aucun
 * e-mail réel, aucune API tierce) ; une tentative échoue bruyamment au lieu de partir.
 *
 * Pourquoi : `createStrapi()` interroge le registre npm (notification de mise à jour, une fois par
 * jour) tant que `server.logger.updates.enabled` vaut true, et Strapi avale l'erreur : sans ce garde-fou,
 * ce seul appel sortirait de la machine pendant les tests et le seed.
 *
 * Les tentatives refusées sont écrites sur stderr (« [no-network] ») et listées dans
 * globalThis.__blockedConnections.
 */

const net = require('node:net');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', '::']);
const blocked = (globalThis.__blockedConnections = globalThis.__blockedConnections || []);
const original = net.Socket.prototype.connect;

/** Hôte visé par les arguments de Socket.prototype.connect, ou null pour un socket Unix. */
function targetHost(args) {
  const [first, second] = args;
  if (Array.isArray(first)) return targetHost(first); // forme normalisée interne : [options, callback]
  if (first && typeof first === 'object') return first.path ? null : first.host || first.hostname || 'localhost';
  if (typeof first === 'string' && Number.isNaN(Number(first))) return null; // chemin d'un socket Unix
  return typeof second === 'string' ? second : 'localhost';
}

net.Socket.prototype.connect = function guardedConnect(...args) {
  const host = targetHost(args);
  if (host !== null && !LOCAL_HOSTS.has(String(host).toLowerCase())) {
    const message = `[no-network] connexion refusée vers ${host}`;
    blocked.push(host);
    process.stderr.write(`${message}\n`);
    process.nextTick(() => this.destroy(Object.assign(new Error(message), { code: 'ENETUNREACH' })));
    return this;
  }
  return original.apply(this, args);
};
