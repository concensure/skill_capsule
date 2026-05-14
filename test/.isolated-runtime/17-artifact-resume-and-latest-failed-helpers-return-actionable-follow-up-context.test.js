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


test('artifact resume and latest failed helpers return actionable follow-up context', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);
  const runId = 'run-resume-flow';

  const compose = await runtime.compose({
    description: 'Upload this project to GitHub but do not push',
    budget: 800,
    run_id: runId,
  });
  fs.writeFileSync(path.join(tempRoot, 'secret.txt'), `sk-${'f'.repeat(48)}\n`);
  const blockedPrepare = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
    run_id: runId,
  });
  const latestFailedPrepare = runtime.getLatestFailedArtifact({ runId, kind: 'prepare' });
  assert.equal(latestFailedPrepare?.path, blockedPrepare.artifactPath);

  const blockedResume = runtime.resumeFromArtifact(latestFailedPrepare.id);
  assert.equal(blockedResume.recommendedAction, 'prepare');
  assert.equal(blockedResume.atomId, 'github.upload.safety');
  assert.equal(blockedResume.task.run_id, runId);
  assert.equal(blockedResume.task.parent_artifact_id, latestFailedPrepare.id);

  execFileSync('git', ['add', 'README.md'], { cwd: tempRoot, stdio: 'ignore' });
  fs.writeFileSync(path.join(tempRoot, 'README.md'), '# temp project changed\n');
  const failedVerify = await runtime.verify('code.edit.safe', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['src/**'],
    run_id: runId,
  });
  const latestFailedVerify = runtime.getLatestFailedArtifact({ runId, kind: 'verify' });
  assert.equal(latestFailedVerify?.path, failedVerify.artifactPath);

  const verifyResume = runtime.resumeFromArtifact(latestFailedVerify.id);
  assert.equal(verifyResume.recommendedAction, 'verify');
  assert.equal(verifyResume.atomId, 'code.edit.safe');
  assert.equal(verifyResume.task.parent_artifact_id, latestFailedVerify.id);

  const composeRecord = runtime.listArtifacts({ runId, kind: 'compose', limit: 1 })[0];
  const composeResume = runtime.resumeFromArtifact(composeRecord.id);
  assert.equal(composeResume.recommendedAction, 'prepare');
  assert.equal(composeResume.task.parent_artifact_id, composeRecord.id);
});


