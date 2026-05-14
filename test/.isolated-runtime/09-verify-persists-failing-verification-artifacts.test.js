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


test('verify persists failing verification artifacts', async () => {
  const { tempRoot, configPath } = makeTempProject();
  execFileSync('git', ['add', 'README.md'], { cwd: tempRoot, stdio: 'ignore' });
  fs.writeFileSync(path.join(tempRoot, 'README.md'), '# temp project changed\n');
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = await runtime.verify('code.edit.safe', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['src/**'],
  });

  assert.equal(result.receipt.status, 'FAIL');
  assert.ok(result.receipt.blockingHooks.includes('hook.diff.scope_check'));
  assert.ok(result.artifactPath);
  const artifact = JSON.parse(fs.readFileSync(result.artifactPath, 'utf-8'));
  assert.equal(artifact.receipt.status, 'FAIL');
  assert.deepEqual(artifact.receipt.executedPhases, ['after_action']);
  const listed = runtime.listArtifacts({ kind: 'verify', limit: 10 });
  const indexed = listed.find((record) => record.path === result.artifactPath);
  assert.ok(indexed);
  const fetched = runtime.getArtifact(indexed.id);
  assert.equal(fetched.atomId, 'code.edit.safe');
});


