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


test('artifact list supports filtering by atom, status, and task type', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  await runtime.compose('Upload this project to GitHub but do not push', 800);
  const readyPrepare = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });
  fs.writeFileSync(path.join(tempRoot, 'secret.txt'), `sk-${'c'.repeat(48)}\n`);
  const blockedPrepare = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });
  const failedVerify = await runtime.verify('code.edit.safe', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['src/**'],
  });

  const byAtom = runtime.listArtifacts({ atomId: 'github.upload.safety', limit: 10 });
  assert.ok(byAtom.every((record) => record.atomId === 'github.upload.safety'));
  assert.ok(byAtom.some((record) => record.path === readyPrepare.artifactPath));
  assert.ok(byAtom.some((record) => record.path === blockedPrepare.artifactPath));

  const blockedOnly = runtime.listArtifacts({ status: 'BLOCKED', limit: 10 });
  assert.ok(blockedOnly.length >= 1);
  assert.ok(blockedOnly.every((record) => record.status === 'BLOCKED'));
  assert.ok(blockedOnly.some((record) => record.path === blockedPrepare.artifactPath));

  const publishOnly = runtime.listArtifacts({ taskType: 'publish', limit: 10 });
  assert.ok(publishOnly.length >= 2);
  assert.ok(publishOnly.every((record) => record.taskType === 'publish'));

  const verifyFailOnly = runtime.listArtifacts({ kind: 'verify', status: 'FAIL', taskType: 'coding', limit: 10 });
  assert.ok(verifyFailOnly.length >= 1);
  assert.ok(verifyFailOnly.some((record) => record.path === failedVerify.artifactPath));
});


