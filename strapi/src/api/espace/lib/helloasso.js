'use strict';

const MAX_PAGES = 50;
const PAGE_SIZE = 100;
const TOKEN_MARGIN_MS = 60 * 1000;
const TIMEOUT_MS = 20 * 1000;

/** Failure of the HelloAsso API. The message never carries a secret, a token or a response body (NF-06); `status` is undefined when HelloAsso is unreachable. */
class HelloAssoError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HelloAssoError';
    this.status = status;
  }
}

/**
 * Client of the HelloAsso API v5 (I-10, I-11): OAuth 2.0 client credentials, token kept until `expires_in` minus 60 s,
 * one renewal and one new try on a 401. `now` is a function returning milliseconds (default: the current time) ; `fetch` is injectable.
 * Every request, token included, is aborted after `timeoutMs` (default 20 s) and then fails as an unreachable HelloAsso (no `status`).
 */
function createHelloAssoClient({ apiBase, clientId, clientSecret, fetch = globalThis.fetch, now = Date.now, timeoutMs = TIMEOUT_MS }) {
  const base = apiBase.replace(/\/+$/, '');
  const tokenUrl = `${new URL(base).origin}/oauth2/token`;
  const clock = () => Number(typeof now === 'function' ? now() : now);
  let token;

  const send = async (url, init, label) => {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new HelloAssoError(undefined, `HelloAsso unreachable (${label})`);
    }
  };

  async function accessToken() {
    if (!(token?.expiresAt > clock())) {
      const response = await send(
        tokenUrl,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
        },
        'token'
      );
      if (!response.ok) throw new HelloAssoError(response.status, `HelloAsso token refused (HTTP ${response.status})`);
      const body = await response.json();
      token = { value: body.access_token, expiresAt: clock() + (Number(body.expires_in) * 1000 - TOKEN_MARGIN_MS) };
    }
    return token.value;
  }

  async function get(path) {
    const label = path.split('?')[0];
    for (let attempt = 0; ; attempt += 1) {
      const response = await send(`${base}${path}`, { headers: { authorization: `Bearer ${await accessToken()}`, accept: 'application/json' } }, label);
      if (response.status === 401 && attempt === 0) {
        token = undefined;
        continue;
      }
      if (!response.ok) throw new HelloAssoError(response.status, `HelloAsso refused ${label} (HTTP ${response.status})`);
      return response.json();
    }
  }

  const slug = encodeURIComponent;
  return {
    /** Every ticket of a form with its custom fields (withDetails), page by page until `data: []`. */
    async listFormItems({ organizationSlug, formType, formSlug }) {
      const path = `/organizations/${slug(organizationSlug)}/forms/${slug(formType)}/${slug(formSlug)}/items`;
      const items = [];
      let continuationToken;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const query = new URLSearchParams({ withDetails: 'true', pageSize: String(PAGE_SIZE) });
        if (continuationToken) query.set('continuationToken', continuationToken);
        const { data, pagination } = await get(`${path}?${query}`);
        if (!data?.length) return items;
        items.push(...data);
        continuationToken = pagination?.continuationToken;
        if (!continuationToken) return items;
      }
      throw new HelloAssoError(undefined, `HelloAsso returned more than ${MAX_PAGES} pages of items`);
    },

    /** An order with its tickets (targeted resynchronization, I-13). */
    getOrder: (orderId) => get(`/orders/${slug(orderId)}`),
  };
}

module.exports = { createHelloAssoClient, HelloAssoError };
