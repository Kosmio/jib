/**
 * HTTP client for the Strapi v5 REST API.
 *
 * Strapi v5 returns flat objects (no `attributes` wrapper).
 * The stable identifier is `documentId` (string), not the numeric `id`.
 */

export class StrapiClient {
  #baseUrl;
  #token;

  /**
   * @param {string} baseUrl  Strapi root URL (e.g. "http://localhost:1337" or "https://site.com/strapi")
   * @param {string} token    Full-access API token
   */
  constructor(baseUrl, token) {
    // Strip trailing slash so callers don't have to worry about it
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#token = token;
  }

  /** GET with optional query parameters. */
  async get(path, params = {}) {
    const url = this.#url(path, params);
    return this.#request(url, { method: 'GET' });
  }

  /** POST with a JSON body. */
  async post(path, body) {
    const url = this.#url(path);
    return this.#request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** PUT with a JSON body. */
  async put(path, body) {
    const url = this.#url(path);
    return this.#request(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** DELETE. */
  async del(path) {
    const url = this.#url(path);
    return this.#request(url, { method: 'DELETE' });
  }

  /**
   * Upload a file to the Strapi media library.
   * Downloads from a URL first, then sends multipart/form-data.
   *
   * @param {string}  sourceUrl  Public URL of the file to upload
   * @param {string}  [fileName] Override filename (defaults to last path segment of the URL)
   * @param {object}  [meta]     Optional metadata: { alternativeText, caption }
   * @returns {Promise<object>}  The uploaded file object (id, url, etc.)
   */
  async upload(sourceUrl, fileName, meta = {}) {
    // Download the file into memory
    const dlResponse = await fetch(sourceUrl);
    if (!dlResponse.ok) {
      throw new Error(`Failed to download file from ${sourceUrl}: ${dlResponse.status}`);
    }
    const blob = await dlResponse.blob();

    // Derive a filename if not provided
    const name = fileName || new URL(sourceUrl).pathname.split('/').pop() || 'file';

    const form = new FormData();
    form.append('files', new File([blob], name, { type: blob.type }));

    const fileInfo = {};
    if (meta.alternativeText) fileInfo.alternativeText = meta.alternativeText;
    if (meta.caption) fileInfo.caption = meta.caption;
    if (Object.keys(fileInfo).length > 0) {
      form.append('fileInfo', JSON.stringify(fileInfo));
    }

    const url = this.#url('/upload');
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.#token}` },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upload failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    // Strapi returns an array of uploaded files
    return Array.isArray(data) ? data[0] : data;
  }

  // ── private ──────────────────────────────────────────────

  #url(path, params = {}) {
    const base = `${this.#baseUrl}/api${path}`;
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        qs.append(key, String(value));
      }
    }
    const query = qs.toString();
    return query ? `${base}?${query}` : base;
  }

  async #request(url, options) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.#token}`,
        ...options.headers,
      },
    });

    const body = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = body;
    }

    if (!res.ok) {
      const message = parsed?.error?.message || parsed?.message || `HTTP ${res.status}`;
      throw new Error(`Strapi error (${res.status}): ${message}`);
    }

    return parsed;
  }
}
