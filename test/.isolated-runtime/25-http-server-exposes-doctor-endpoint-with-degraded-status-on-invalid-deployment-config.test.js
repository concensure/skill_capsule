const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const runtimeModule = require(path.join(repoRoot, 'dist', 'runtime.js'));
const SkillCapsuleRuntime = runtimeModule.default;
const { formatRuntimeError } = runtimeModule;

function makeTempProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcap-test-'));
  fs.cpSync(path.join(repoRoot, '.skillcapsule'), path.join(tempRoot, '.skillcapsule'), {
    recursive: true,
  });
  fs.writeFileSync(path.join(tempRoot, 'README.md'), '# temp project\n');
  execFileSync('git', ['init'], { cwd: tempRoot, stdio: 'ignore' });
  return {
    tempRoot,
    configPath: path.join(tempRoot, '.skillcapsule', 'skillcapsule.config.json'),
  };
}

function writeRegistry(tempRoot, registry) {
  fs.writeFileSync(
    path.join(tempRoot, '.skillcapsule', 'hooks', 'hooks.registry.json'),
    `${JSON.stringify(registry, null, 2)}\n`,
  );
}

function writeConfig(tempRoot, config) {
  fs.writeFileSync(
    path.join(tempRoot, '.skillcapsule', 'skillcapsule.config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

function loadFreshModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}


test('http server exposes doctor endpoint with degraded status on invalid deployment config', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.context_budget.default = 5000;
  config.context_budget.max = 1000;
  writeConfig(tempRoot, config);

  const oldConfigPath = process.env.SKILLCAP_CONFIG_PATH;
  process.env.SKILLCAP_CONFIG_PATH = configPath;

  try {
    const serverModule = loadFreshModule(path.join(repoRoot, 'dist', 'server.js'));
    const { app } = serverModule.createApp();
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    assert.ok(port);

    const response = await fetch(`http://127.0.0.1:${port}/doctor`);
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.ok(payload.checks.some((check) => check.status === 'FAIL'));

    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  } finally {
    if (oldConfigPath === undefined) {
      delete process.env.SKILLCAP_CONFIG_PATH;
    } else {
      process.env.SKILLCAP_CONFIG_PATH = oldConfigPath;
    }
  }
});


