'use strict';

/**
 * Adresses de longueur imposée, pour les limites de `normalizeEmail` (254 caractères au plus, A-23). Aucune adresse réelle :
 * partie locale de 64 caractères, libellés de domaine de 63 au plus, terminaison `.org`.
 */

/** Adresse syntaxiquement valable de `length` caractères exactement (au moins 70). */
function addressOfLength(length) {
  const tld = '.org';
  let remaining = length - 65 - tld.length; // 64 caractères de partie locale, « @ »
  const labels = [];
  while (remaining > 0) {
    const size = Math.min(63, remaining - (remaining > 63 ? 1 : 0));
    labels.push('d'.repeat(size));
    remaining -= size + 1;
  }
  return `${'a'.repeat(64)}@${labels.join('.')}${tld}`;
}

module.exports = { addressOfLength };
