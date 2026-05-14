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


test('hook command policy blocks node scripts outside hook scripts directory', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const registryPath = path.join(tempRoot, '.skillcapsule', 'hooks', 'hooks.registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.security.hook_policy.allowed_prefixes.read_only.push('node scripts/');
  writeConfig(tempRoot, config);
  registry.hooks = registry.hooks.map((hook) =>
    hook.id === 'hook.secrets.scan'
      ? { ...hook, command: 'node scripts/escape.js' }
      : hook,
  );
  writeRegistry(tempRoot, registry);

  const runtime = new SkillCapsuleRuntime(configPath);
  const result = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });

  assert.equal(result.receipt.status, 'BLOCKED');
  assert.equal(result.hookResults.before_action?.[0].status, 'FAIL');
  assert.match(result.hookResults.before_action?.[0].summary ?? '', /must stay under/i);
});


