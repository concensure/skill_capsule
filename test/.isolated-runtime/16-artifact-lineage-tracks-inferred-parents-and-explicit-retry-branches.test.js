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


test('artifact lineage tracks inferred parents and explicit retry branches', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);
  const runId = 'run-branch-flow';

  const compose = await runtime.compose({
    description: 'Upload this project to GitHub but do not push',
    budget: 800,
    run_id: runId,
  });
  const prepare = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
    run_id: runId,
  });

  execFileSync('git', ['add', 'README.md'], { cwd: tempRoot, stdio: 'ignore' });
  fs.writeFileSync(path.join(tempRoot, 'README.md'), '# temp project changed\n');
  const failedVerify = await runtime.verify('code.edit.safe', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['src/**'],
    run_id: runId,
  });

  const failedVerifyRecord = runtime.getLatestArtifact({ runId, kind: 'verify' });
  const retryVerify = await runtime.verify('code.edit.scope_guard', {
    description: 'Retry scoped verification',
    allowed_paths: ['*'],
    run_id: runId,
    parent_artifact_id: failedVerifyRecord.id,
  });

  const lineage = runtime.getArtifactLineage(runId);
  const composeRecord = lineage.artifacts.find((item) => item.path === compose.artifactPath);
  const prepareRecord = lineage.artifacts.find((item) => item.path === prepare.artifactPath);
  const failedVerifyIndexed = lineage.artifacts.find((item) => item.path === failedVerify.artifactPath);
  const retryVerifyIndexed = lineage.artifacts.find((item) => item.path === retryVerify.artifactPath);

  assert.ok(composeRecord);
  assert.ok(prepareRecord);
  assert.ok(failedVerifyIndexed);
  assert.ok(retryVerifyIndexed);
  assert.deepEqual(lineage.roots, [composeRecord.id]);
  assert.equal(prepareRecord?.parentArtifactId, composeRecord?.id);
  assert.equal(failedVerifyIndexed?.parentArtifactId, prepareRecord?.id);
  assert.equal(retryVerifyIndexed?.parentArtifactId, failedVerifyIndexed?.id);

  const retryChildren = runtime.listArtifacts({ runId, parentArtifactId: failedVerifyIndexed.id, limit: 10 });
  assert.equal(retryChildren.length, 1);
  assert.equal(retryChildren[0].id, retryVerifyIndexed?.id);
  assert.deepEqual(lineage.childrenByParent[composeRecord.id], [prepareRecord.id]);
  assert.deepEqual(lineage.childrenByParent[prepareRecord.id], [failedVerifyIndexed.id]);
  assert.deepEqual(lineage.childrenByParent[failedVerifyIndexed.id], [retryVerifyIndexed.id]);
});


