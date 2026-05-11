# CLAIR Hosting Guide

## Option 1: stdio (Local — Recommended to Start)

No server needed. Claude Desktop or Claude Code runs the MCP as a subprocess.

**Pros:** Zero infrastructure, zero latency overhead, no auth needed  
**Cons:** Single user, not shareable  

**Config:**
```json
{
  "mcpServers": {
    "clair": {
      "command": "node",
      "args": ["/absolute/path/to/clair-mcp-server/dist/index.js"]
    }
  }
}
```

---

## Option 2: Railway (Remote HTTP — Easiest Cloud Deploy)

Railway gives you a free tier and one-command deploys from GitHub.

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

Set environment variables in Railway dashboard if needed.

Your MCP endpoint will be: `https://your-app.railway.app/mcp`

**Cost:** Free tier: 500 hours/month. $5/month for always-on.

---

## Option 3: Fly.io (Remote HTTP — Best Performance)

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Deploy
fly launch
fly deploy
```

Add a `fly.toml`:
```toml
app = "clair-mcp-server"
primary_region = "sjc"

[build]

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
```

**Cost:** Free tier available. ~$2–5/month for small instance.

---

## Option 4: Render (Remote HTTP — Simple UI)

1. Push to GitHub
2. Go to render.com → New Web Service
3. Connect your repo
4. Build command: `npm install && npm run build`
5. Start command: `node dist/index.js`

**Cost:** Free tier (spins down after 15min inactivity). $7/month for always-on.

---

## Switching from stdio to HTTP Transport

To add HTTP support, modify `src/index.ts`:

```typescript
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined // stateless
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(process.env.PORT ?? 3000);
```

Then in Claude Desktop config:
```json
{
  "mcpServers": {
    "clair": {
      "url": "https://your-app.railway.app/mcp"
    }
  }
}
```

---

## Recommendation

**Start with stdio** — it requires zero infrastructure and works immediately.  
**Move to Railway** when you want to share the server with a team or access it from multiple devices.
