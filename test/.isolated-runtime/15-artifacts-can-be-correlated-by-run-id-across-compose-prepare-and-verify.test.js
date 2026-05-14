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


test('artifacts can be correlated by run ID across compose, prepare, and verify', async () => {
  const { configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);
  const runId = 'run-shared-flow';

  const compose = await runtime.compose({
    description: 'Upload this project to GitHub but do not push',
    budget: 800,
    run_id: runId,
  });
  const prepare = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
    run_id: runId,
  });
  const verify = await runtime.verify('code.edit.scope_guard', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['*'],
    run_id: runId,
  });

  assert.equal(compose.runId, runId);
  assert.equal(prepare.runId, runId);
  assert.equal(verify.runId, runId);

  const byRun = runtime.listArtifacts({ runId, limit: 10 });
  assert.equal(byRun.length, 3);
  assert.ok(byRun.every((record) => record.runId === runId));

  const lineage = runtime.getArtifactLineage(runId);
  assert.equal(lineage.runId, runId);
  assert.equal(lineage.artifacts.length, 3);
  assert.deepEqual(lineage.roots.length, 1);
  assert.deepEqual(
    lineage.artifacts.map((record) => record.kind).sort(),
    ['compose', 'prepare', 'verify'],
  );

  const latestVerify = runtime.getLatestSuccessfulArtifact({ runId, kind: 'verify' });
  assert.equal(latestVerify?.kind, 'verify');
  assert.equal(latestVerify?.runId, runId);

  const summary = runtime.summarizeArtifacts({ runId });
  assert.equal(summary.total, 3);
  assert.equal(summary.runIds, 1);
  assert.equal(summary.byKind.compose, 1);
  assert.equal(summary.byKind.prepare, 1);
  assert.equal(summary.byKind.verify, 1);
});


