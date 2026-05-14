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


test('bootstrap validation rejects hook registries with missing script targets', () => {
  const { tempRoot, configPath } = makeTempProject();
  const registryPath = path.join(tempRoot, '.skillcapsule', 'hooks', 'hooks.registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  registry.hooks = registry.hooks.map((hook) =>
    hook.id === 'hook.secrets.scan'
      ? { ...hook, command: 'node .skillcapsule/hooks/scripts/does-not-exist.js' }
      : hook,
  );
  writeRegistry(tempRoot, registry);

  const bootstrapModule = loadFreshModule(path.join(repoRoot, 'dist', 'bootstrap.js'));
  assert.throws(
    () => bootstrapModule.validateRuntimeEnvironment(configPath),
    /references a missing script/i,
  );
});


