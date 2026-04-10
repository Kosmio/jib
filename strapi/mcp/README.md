# Content Management MCP Server

Manage your website content (articles, images, etc.) directly from your AI assistant — Claude, ChatGPT, Gemini, Cursor, or any tool that supports the [Model Context Protocol](https://modelcontextprotocol.io/).

## How it works

The MCP server runs alongside your website on the same server. It's automatically deployed with the rest of the application.

```
https://your-domain.com/           → Website (Astro frontend)
https://your-domain.com/strapi/    → CMS admin panel (Strapi)
https://your-domain.com/mcp/       → MCP server (AI content management)
```

Authentication uses Strapi's built-in API tokens — the client creates a token in the Strapi admin panel and includes it in their MCP configuration. The MCP server forwards it to Strapi, which validates it and enforces permissions. No server-side secrets needed.

## Setup for clients

### Step 1: Create an API token in Strapi

1. Open your Strapi admin panel at `https://your-domain.com/strapi/admin`
2. Log in with your admin credentials
3. Go to **Settings** (gear icon in the left sidebar)
4. Under **Global Settings**, click **API Tokens**
5. Click **Create new API Token**
6. Fill in:
   - **Name**: anything you'll recognize (e.g. `My AI Assistant`)
   - **Description**: optional
   - **Token duration**: Unlimited (or set an expiry)
   - **Token type**: **Full access**
7. Click **Save**
8. **Copy the token** — it won't be shown again

### Step 2: Configure your AI tool

Append your token to the MCP URL as a query parameter: `https://your-domain.com/mcp?token=YOUR_TOKEN_HERE`

If your tool supports custom headers, you can alternatively use `Authorization: Bearer YOUR_TOKEN_HERE`.

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "website-cms": {
      "type": "http",
      "url": "https://your-domain.com/mcp?token=YOUR_TOKEN_HERE"
    }
  }
}
```

#### Cursor

Open **Settings → MCP Servers → Add Server**:
- **Type**: HTTP
- **URL**: `https://your-domain.com/mcp?token=YOUR_TOKEN_HERE`

#### Generic (any MCP-compatible tool)

- **Streamable HTTP**: `https://your-domain.com/mcp?token=YOUR_TOKEN_HERE`
- **Legacy SSE**: `GET https://your-domain.com/mcp/sse?token=YOUR_TOKEN_HERE`

## Available tools

| Tool | Description |
|---|---|
| `list_content_types` | See what types of content you can manage (articles, etc.) |
| `list_entries` | List entries with pagination and sorting |
| `get_entry` | Get a single entry by ID or by a field value (e.g. slug) |
| `create_entry` | Create new content |
| `update_entry` | Edit existing content |
| `delete_entry` | Permanently delete content |
| `publish_entry` | Make a draft visible on the website |
| `unpublish_entry` | Hide content from the website (keeps it as draft) |
| `upload_media` | Upload an image or file from a URL |
| `list_media` | Browse the media library |

## Deployment

The MCP server is deployed automatically as part of the Docker Compose stack. It only needs `STRAPI_URL` (the internal Strapi URL, set in docker-compose). No secrets or API tokens are stored on the server — authentication is fully delegated to Strapi via client-provided tokens.

### Local development

```bash
cd strapi/mcp
pnpm install    # first time only
STRAPI_URL=http://localhost:1337 pnpm start
```

The server listens on port 3100. Endpoints (no Traefik prefix stripping locally):
- Streamable HTTP: `http://localhost:3100/`
- Legacy SSE: `http://localhost:3100/sse`

You still need a Strapi API token — create one in your local Strapi admin at `http://localhost:1337/admin` and pass it via the `Authorization: Bearer <token>` header.

## Troubleshooting

**"Not authenticated"**
→ Your MCP config is missing the `Authorization` header with a Strapi API token.

**"Strapi error (401): Unauthorized"**
→ The API token is invalid or expired. Create a new one in Strapi admin → Settings → API Tokens.

**"Strapi error (403): Forbidden"**
→ The token doesn't have enough permissions. Make sure it's set to **Full access**.

**Connection refused**
→ The website or MCP server is not running.

## Security

- API tokens are created and managed in Strapi's admin panel — the same system that manages all CMS access
- The MCP server stores no tokens on disk — it receives them from the client on each request
- Strapi controls permissions: you can create scoped tokens that only allow specific operations
- All communication uses HTTPS via Traefik's Let's Encrypt TLS
- Tokens can be revoked at any time from the Strapi admin panel
