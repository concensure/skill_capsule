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


test('artifact summary reports counts by kind, status, and task type', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  await runtime.compose('Upload this project to GitHub but do not push', 800);
  await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });
  fs.writeFileSync(path.join(tempRoot, 'secret.txt'), `sk-${'e'.repeat(48)}\n`);
  await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });
  await runtime.verify('code.edit.safe', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['src/**'],
  });

  const summary = runtime.summarizeArtifacts();
  assert.equal(summary.total, 4);
  assert.equal(summary.byKind.compose, 1);
  assert.equal(summary.byKind.prepare, 2);
  assert.equal(summary.byKind.verify, 1);
  assert.equal(summary.byStatus.ok, 1);
  assert.equal(summary.byStatus.READY, 1);
  assert.equal(summary.byStatus.BLOCKED, 1);
  assert.equal(summary.byStatus.FAIL, 1);
  assert.equal(summary.byTaskType.publish, 3);
  assert.equal(summary.byTaskType.coding, 1);

  const prepareSummary = runtime.summarizeArtifacts({ kind: 'prepare', atomId: 'github.upload.safety' });
  assert.equal(prepareSummary.total, 2);
  assert.equal(prepareSummary.byKind.prepare, 2);
  assert.equal(prepareSummary.byStatus.READY, 1);
  assert.equal(prepareSummary.byStatus.BLOCKED, 1);
});


