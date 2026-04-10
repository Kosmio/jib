#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';
import { StrapiClient } from './lib/strapi-client.js';

// ── Config ──────────────────────────────────────────────────

const STRAPI_URL = process.env.STRAPI_URL;
const MCP_PORT = parseInt(process.env.MCP_PORT || '3100', 10);

if (!STRAPI_URL) {
  console.error('Missing required environment variable: STRAPI_URL');
  process.exit(1);
}

// Load content type definitions
const __dirname = dirname(fileURLToPath(import.meta.url));
const contentTypes = JSON.parse(
  readFileSync(join(__dirname, 'content-types.json'), 'utf-8'),
);

const knownTypes = Object.keys(contentTypes).join(', ');

const pkg = JSON.parse(
  readFileSync(join(__dirname, 'package.json'), 'utf-8'),
);

// ── Auth token storage per session ──────────────────────────
// The client sends their Strapi API token via the Authorization header.
// We extract it on each HTTP request and store it per session so tools can use it.

const sessionTokens = {};

/**
 * Extract the Bearer token from an Express request.
 * Returns the token string or null.
 */
function extractToken(req) {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  // Fallback: accept token as query param for clients that don't support custom headers
  return req.query?.token || null;
}

// ── MCP Server factory ─────────────────────────────────────
// Each session gets its own McpServer. Tools resolve the Strapi client
// from the session's stored token.

function createServer(sessionId) {
  const server = new McpServer({
    name: 'strapi-cms',
    version: pkg.version,
  });

  function getClient() {
    const token = sessionTokens[sessionId];
    if (!token) {
      throw new Error(
        'Not authenticated. Configure your MCP client with an Authorization header ' +
        'containing a Strapi API token: "Authorization: Bearer <your-token>". ' +
        'Create a token in your Strapi admin panel under Settings → API Tokens.',
      );
    }
    return new StrapiClient(STRAPI_URL, token);
  }

  // 1. list_content_types
  server.tool(
    'list_content_types',
    'List all content types available on the website, with their fields and descriptions. Use this first to understand what content you can manage.',
    {},
    async () => {
      const result = Object.entries(contentTypes).map(([pluralName, ct]) => ({
        pluralName,
        singularName: ct.singularName,
        displayName: ct.displayName,
        description: ct.description,
        draftAndPublish: ct.draftAndPublish,
        fields: Object.entries(ct.fields).map(([name, f]) => ({
          name,
          type: f.type,
          required: f.required || false,
          description: f.description,
        })),
      }));

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // 2. list_entries
  server.tool(
    'list_entries',
    `List entries of a content type (e.g. list all articles). Known types: ${knownTypes}.`,
    {
      contentType: z.string().describe('Plural API name of the content type (e.g. "articles")'),
      page: z.number().optional().default(1).describe('Page number (default: 1)'),
      pageSize: z.number().optional().default(25).describe('Entries per page (default: 25, max: 100)'),
      sort: z.string().optional().describe('Sort expression (e.g. "title:asc", "createdAt:desc")'),
      status: z.enum(['published', 'draft']).optional().describe('Filter by publication status'),
    },
    async ({ contentType, page, pageSize, sort, status }) => {
      const client = getClient();
      const params = {
        'populate': '*',
        'pagination[page]': page,
        'pagination[pageSize]': Math.min(pageSize, 100),
      };
      if (sort) params.sort = sort;
      if (status) params.status = status;

      const result = await client.get(`/${contentType}`, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // 3. get_entry
  server.tool(
    'get_entry',
    `Get a single entry by document ID, or find one by filtering on a field (e.g. get the article with slug "my-post"). Known types: ${knownTypes}.`,
    {
      contentType: z.string().describe('Plural API name (e.g. "articles")'),
      documentId: z.string().optional().describe('Document ID of the entry'),
      field: z.string().optional().describe('Field name to filter by (e.g. "slug")'),
      value: z.string().optional().describe('Field value to match'),
    },
    async ({ contentType, documentId, field, value }) => {
      const client = getClient();

      if (documentId) {
        const result = await client.get(`/${contentType}/${documentId}`, { populate: '*' });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      if (field && value) {
        const result = await client.get(`/${contentType}`, {
          [`filters[${field}][$eq]`]: value,
          'populate': '*',
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      return {
        content: [{ type: 'text', text: 'Error: provide either documentId, or both field and value.' }],
        isError: true,
      };
    },
  );

  // 4. create_entry
  server.tool(
    'create_entry',
    `Create a new entry in a content type (e.g. create a new article). Known types: ${knownTypes}. Use list_content_types to see available fields.`,
    {
      contentType: z.string().describe('Plural API name (e.g. "articles")'),
      data: z.record(z.unknown()).describe('Field values for the new entry (e.g. { "title": "My Post", "content": "..." })'),
      publish: z.boolean().optional().default(false).describe('Publish immediately (default: false, creates as draft)'),
    },
    async ({ contentType, data, publish }) => {
      const client = getClient();
      const body = { data, status: publish ? 'published' : 'draft' };

      const result = await client.post(`/${contentType}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // 5. update_entry
  server.tool(
    'update_entry',
    `Update an existing entry. Known types: ${knownTypes}. Use get_entry or list_entries to find the documentId first.`,
    {
      contentType: z.string().describe('Plural API name (e.g. "articles")'),
      documentId: z.string().describe('Document ID of the entry to update'),
      data: z.record(z.unknown()).describe('Field values to update (only include fields you want to change)'),
    },
    async ({ contentType, documentId, data }) => {
      const client = getClient();
      const result = await client.put(`/${contentType}/${documentId}`, { data });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // 6. delete_entry
  server.tool(
    'delete_entry',
    `Permanently delete an entry. This cannot be undone. Known types: ${knownTypes}.`,
    {
      contentType: z.string().describe('Plural API name (e.g. "articles")'),
      documentId: z.string().describe('Document ID of the entry to delete'),
    },
    async ({ contentType, documentId }) => {
      const client = getClient();
      const result = await client.del(`/${contentType}/${documentId}`);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // 7. publish_entry
  server.tool(
    'publish_entry',
    `Publish a draft entry to make it visible on the website. Known types: ${knownTypes}.`,
    {
      contentType: z.string().describe('Plural API name (e.g. "articles")'),
      documentId: z.string().describe('Document ID of the entry to publish'),
    },
    async ({ contentType, documentId }) => {
      const client = getClient();
      const result = await client.put(`/${contentType}/${documentId}`, { status: 'published' });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // 8. unpublish_entry
  server.tool(
    'unpublish_entry',
    `Unpublish an entry to hide it from the website (keeps it as a draft). Known types: ${knownTypes}.`,
    {
      contentType: z.string().describe('Plural API name (e.g. "articles")'),
      documentId: z.string().describe('Document ID of the entry to unpublish'),
    },
    async ({ contentType, documentId }) => {
      const client = getClient();
      const result = await client.put(`/${contentType}/${documentId}`, { status: 'draft' });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // 9. upload_media
  server.tool(
    'upload_media',
    'Upload an image or file to the media library from a URL. Returns the media ID which you can use when creating or updating entries.',
    {
      url: z.string().url().describe('Public URL of the file to upload'),
      fileName: z.string().optional().describe('Override the file name (defaults to the URL filename)'),
      alternativeText: z.string().optional().describe('Alt text for accessibility'),
      caption: z.string().optional().describe('Caption for the media'),
    },
    async ({ url, fileName, alternativeText, caption }) => {
      const client = getClient();
      const result = await client.upload(url, fileName, { alternativeText, caption });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // 10. list_media
  server.tool(
    'list_media',
    'List files in the media library (images, documents, etc.).',
    {
      page: z.number().optional().default(1).describe('Page number (default: 1)'),
      pageSize: z.number().optional().default(25).describe('Files per page (default: 25)'),
    },
    async ({ page, pageSize }) => {
      const client = getClient();
      const result = await client.get('/upload/files', {
        'pagination[page]': page,
        'pagination[pageSize]': Math.min(pageSize, 100),
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  return server;
}

// ── HTTP Server ─────────────────────────────────────────────

const app = createMcpExpressApp({
  host: '0.0.0.0',
});
const transports = {};

// ── Streamable HTTP transport ───────────────────────────────

app.all('/', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    let transport;

    if (sessionId && transports[sessionId]) {
      const existing = transports[sessionId];
      if (existing instanceof StreamableHTTPServerTransport) {
        transport = existing;
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Session uses a different transport protocol' },
          id: null,
        });
        return;
      }
    } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
      const newSessionId = randomUUID();

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
          // Store the token from the initialization request
          const token = extractToken(req);
          if (token) sessionTokens[sid] = token;
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          delete transports[sid];
          delete sessionTokens[sid];
        }
      };

      const server = createServer(newSessionId);
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
      return;
    }

    // Update token on every request (client may send it with each request)
    const sid = transport.sessionId;
    const token = extractToken(req);
    if (token && sid) sessionTokens[sid] = token;

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// ── Legacy SSE transport ────────────────────────────────────

app.get('/sse', async (req, res) => { // legacy SSE stays at /sse (becomes /mcp/sse externally)
  const transport = new SSEServerTransport('/messages', res);
  const sid = transport.sessionId;
  transports[sid] = transport;

  // Store token from the SSE connection request
  const token = extractToken(req);
  if (token) sessionTokens[sid] = token;

  res.on('close', () => {
    delete transports[sid];
    delete sessionTokens[sid];
  });

  const server = createServer(sid);
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];

  if (!transport || !(transport instanceof SSEServerTransport)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  // Update token on message requests too
  const token = extractToken(req);
  if (token && sessionId) sessionTokens[sessionId] = token;

  await transport.handlePostMessage(req, res, req.body);
});

// ── Start ───────────────────────────────────────────────────

app.listen(MCP_PORT, '0.0.0.0', (error) => {
  if (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
  console.log(`MCP server listening on port ${MCP_PORT}`);
  console.log(`  Streamable HTTP: POST/GET/DELETE /`);
  console.log(`  Legacy SSE:      GET /sse + POST /messages`);
});

process.on('SIGINT', async () => {
  for (const sessionId in transports) {
    try {
      await transports[sessionId].close();
    } catch { /* ignore */ }
    delete transports[sessionId];
    delete sessionTokens[sessionId];
  }
  process.exit(0);
});
