import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer } from './mcp';
import { validateRuntimeEnvironment } from './bootstrap';

async function main() {
  const configPath = process.env.SKILLCAP_CONFIG_PATH ?? '.skillcapsule/skillcapsule.config.json';
  const startup = validateRuntimeEnvironment(configPath);
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `Skill Capsule MCP server started (stdio mode). config=${startup.configPath} warnings=${startup.warnings.length}\n`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Fatal error starting Skill Capsule MCP server: ${String(error)}\n`);
    process.exit(1);
  });
}
