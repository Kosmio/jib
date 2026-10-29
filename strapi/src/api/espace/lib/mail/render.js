'use strict';

const { escapeHtml, renderLayout } = require('./layout');

/**
 * renderEmail('access-link', data) -> { subject, html, text }.
 * `templates/<name>.js` exports (data) => template result (see layout.js) ; the name is checked before it reaches require().
 */
function renderEmail(name, data) {
  if (typeof name !== 'string' || !/^[a-z-]+$/.test(name)) throw new Error(`Invalid e-mail template name: ${JSON.stringify(name)}`);
  return renderLayout(require(`./templates/${name}.js`)(data), data);
}

module.exports = { renderEmail, escapeHtml };
