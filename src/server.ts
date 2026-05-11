import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './mcp';
import { collectRuntimeDiagnostics, createValidatedRuntime, validateRuntimeEnvironment } from './bootstrap';
import { formatRuntimeError, SkillCapsuleRuntimeError } from './runtime';

const CONFIG_PATH = process.env.SKILLCAP_CONFIG_PATH ?? '.skillcapsule/skillcapsule.config.json';

export function createApp() {
  const app = express();
  app.use(express.json());
  const diagnostics = collectRuntimeDiagnostics(CONFIG_PATH);
  const startup = diagnostics.ok ? validateRuntimeEnvironment(CONFIG_PATH) : null;
  if (startup) {
    createValidatedRuntime(CONFIG_PATH);
  }

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', server: 'skill-capsule-mcp', version: '1.0.0' });
  });

  app.get('/ready', (_req: Request, res: Response) => {
    if (!startup) {
      res.status(503).json({
        status: 'not_ready',
        server: 'skill-capsule-mcp',
        version: '1.0.0',
        diagnostics,
      });
      return;
    }

    res.json({
      status: 'ready',
      server: 'skill-capsule-mcp',
      version: '1.0.0',
      config_path: startup.configPath,
      warnings: startup.warnings,
    });
  });

  app.get('/doctor', (_req: Request, res: Response) => {
    res.status(diagnostics.ok ? 200 : 503).json(diagnostics);
  });

  const handleMcp = async (req: Request, res: Response) => {
    try {
      if (!startup) {
        throw new SkillCapsuleRuntimeError(
          'STARTUP_NOT_READY',
          'Skill Capsule server startup validation failed.',
          false,
          { diagnostics },
        );
      }
      const server = buildMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      res.status(500).json(formatRuntimeError(error));
    }
  };

  app.get('/mcp', handleMcp);
  app.post('/mcp', handleMcp);
  app.delete('/mcp', handleMcp);
  app.get('/', handleMcp);
  app.post('/', handleMcp);
  app.delete('/', handleMcp);

  return { app, startup, diagnostics };
}

async function main() {
  const { app } = createApp();

  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '0.0.0.0';

  app.listen(port, host, () => {
    console.log(`Skill Capsule MCP server listening on http://${host}:${port}/mcp`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error starting Skill Capsule MCP server:', error);
    process.exit(1);
  });
}
