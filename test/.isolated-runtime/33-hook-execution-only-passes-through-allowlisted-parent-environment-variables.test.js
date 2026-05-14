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


test('hook execution only passes through allowlisted parent environment variables', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const scriptPath = path.join(tempRoot, '.skillcapsule', 'hooks', 'scripts', 'print-visible-env.js');
  fs.writeFileSync(
    scriptPath,
    "console.log(process.env.SKILLCAP_TEST_VISIBLE ? 'visible:yes' : 'visible:no');\n",
  );

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.security.hook_policy.allowed_env_passthrough = ['SKILLCAP_TEST_VISIBLE'];
  writeConfig(tempRoot, config);

  const registryPath = path.join(tempRoot, '.skillcapsule', 'hooks', 'hooks.registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  registry.hooks = registry.hooks.map((hook) =>
    hook.id === 'hook.secrets.scan'
      ? { ...hook, command: 'node .skillcapsule/hooks/scripts/print-visible-env.js' }
      : hook,
  );
  writeRegistry(tempRoot, registry);

  const runtime = new SkillCapsuleRuntime(configPath);
  const previous = process.env.SKILLCAP_TEST_VISIBLE;
  process.env.SKILLCAP_TEST_VISIBLE = 'allowed';

  try {
    const result = await runtime.prepare('github.upload.safety', {
      description: 'Upload this project to GitHub',
    });
    assert.equal(result.receipt.status, 'READY');
    assert.equal(result.hookResults.before_action?.[0].status, 'PASS');
    assert.match(result.hookResults.before_action?.[0].summary ?? '', /visible:yes/);
  } finally {
    if (previous === undefined) {
      delete process.env.SKILLCAP_TEST_VISIBLE;
    } else {
      process.env.SKILLCAP_TEST_VISIBLE = previous;
    }
  }
});


