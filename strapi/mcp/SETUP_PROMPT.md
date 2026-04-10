# MCP Setup Instructions for AI Agents

You are helping a user connect their AI tool to their website's content management system via MCP.

## What this is

The user's website has a built-in MCP server that lets AI assistants manage content (articles, images, etc.). The server is already running on the website — the user needs to create an API token and configure their AI tool.

## What you need from the user

1. **Their website URL** (e.g. `https://example.com`)
2. **A Strapi API token** — the user creates this in their admin panel (instructions below)

## Step-by-step process

### 1. Determine the MCP endpoint

From the website URL, derive the MCP endpoint:

- Website URL: `https://example.com` → MCP endpoint: `https://example.com/mcp`
- The pattern is always `{website_url}/mcp`
- For local development: `http://localhost:3100/` (no `/mcp` prefix — Traefik isn't in the loop locally)

### 2. Ask the user to create an API token

Tell the user exactly this:

> To connect your AI assistant to your website, you need to create an API token. Here's how:
>
> 1. Open your website's admin panel: **{website_url}/strapi/admin**
> 2. Log in with your admin account
> 3. Click the **gear icon** (Settings) in the left sidebar
> 4. Under **Global Settings**, click **API Tokens**
> 5. Click the **Create new API Token** button (top right)
> 6. Fill in:
>    - **Name**: `AI Assistant` (or any name you like)
>    - **Token duration**: **Unlimited**
>    - **Token type**: **Full access**
> 7. Click **Save**
> 8. You'll see a long text string — that's your token. **Copy it now** — you won't be able to see it again after leaving this page.
>
> Paste the token here when you have it.

### 3. Configure the user's AI tool

Once you have the MCP endpoint URL and the token, configure the MCP connection.

The token is passed as a query parameter appended to the URL: `{mcp_endpoint}?token={token}`. If the tool supports custom headers, `Authorization: Bearer {token}` also works as an alternative.

**Claude Desktop** — edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):
```json
{
  "mcpServers": {
    "website-cms": {
      "type": "http",
      "url": "{mcp_endpoint}?token={token}"
    }
  }
}
```

**Claude Code** — create or edit `.mcp.json` in the user's project root:
```json
{
  "mcpServers": {
    "website-cms": {
      "type": "http",
      "url": "{mcp_endpoint}?token={token}"
    }
  }
}
```

**Cursor** — add via Settings → MCP Servers:
- Type: HTTP
- URL: `{mcp_endpoint}?token={token}`

**Windsurf** — edit `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "website-cms": {
      "type": "http",
      "url": "{mcp_endpoint}?token={token}"
    }
  }
}
```

**If you cannot determine the user's tool**, tell them:
> Add an MCP server in your AI tool's settings with:
> - **Type**: HTTP
> - **URL**: `{mcp_endpoint}?token={token}`

### Transport selection

The server supports two MCP transports. Use the one that fits the user's tool:

| Transport | When to use | Endpoint |
|---|---|---|
| **Streamable HTTP** (recommended) | Most modern MCP clients (Claude Desktop, Claude Code, Cursor, Windsurf) | `{mcp_endpoint}?token={token}` |
| **Legacy SSE** | Older clients that don't support Streamable HTTP | `GET {website_url}/mcp/sse?token={token}` to open stream, `POST {website_url}/mcp/messages?sessionId=<id>` to send |

Try Streamable HTTP first. Only fall back to SSE if the tool reports an error or explicitly requires SSE.

### 4. Tell the user what to do next

> Your MCP configuration is ready. Here's what to do:
>
> 1. {If you wrote the config file: "The config has been saved." / If not: "Copy the JSON above into your AI tool's MCP settings."}
> 2. **Restart your AI tool** to load the new MCP server.
> 3. Once restarted, ask me to "list my content types" to verify everything works.
>
> Your token is stored only in your local config — it's never shared with anyone else.

### 5. Verify the setup

Once the MCP is loaded, call the `list_content_types` tool. If it returns content types, the setup is complete.

If you get an auth error, the token may be wrong. Ask the user to double-check they copied the full token, or to create a new one following the steps above.

## If the user wants to revoke access

Tell them:
> Go to your admin panel ({website_url}/strapi/admin) → Settings → API Tokens. Find the token and click the trash icon to delete it. This immediately revokes access.
