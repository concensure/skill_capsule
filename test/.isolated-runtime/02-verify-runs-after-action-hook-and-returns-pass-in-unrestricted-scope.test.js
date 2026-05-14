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


test('verify runs after_action hook and returns PASS in unrestricted scope', async () => {
  const { configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = await runtime.verify('code.edit.scope_guard', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['*'],
  });

  assert.equal(result.receipt.status, 'PASS');
  assert.equal(result.hookResults.after_action?.length, 1);
  assert.equal(result.hookResults.after_action?.[0].id, 'hook.diff.scope_check');
  assert.equal(result.hookResults.after_action?.[0].status, 'PASS');
  assert.ok(result.artifactPath);
  assert.ok(fs.existsSync(result.artifactPath));
});


