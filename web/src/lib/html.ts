import sanitizeHtml from "sanitize-html";

const options: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
  allowedAttributes: sanitizeHtml.defaults.allowedAttributes,
};

/**
 * Nettoie le HTML saisi dans Strapi avant `set:html`.
 * Referme les balises laissées ouvertes (`<b>Titre</>` devient `<b>Titre</b>`),
 * sinon le navigateur propage la mise en forme sur tout le reste de la page.
 * Retire au passage scripts, attributs d'événement et liens `javascript:`.
 */
export function safeHtml(html: string | null | undefined): string {
  return html ? sanitizeHtml(html, options) : "";
}
