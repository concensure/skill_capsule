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


test('artifact latest helpers return newest matching and newest successful records', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  const readyPrepare = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  fs.writeFileSync(path.join(tempRoot, 'secret.txt'), `sk-${'d'.repeat(48)}\n`);
  const blockedPrepare = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });

  const latestAny = runtime.getLatestArtifact({
    kind: 'prepare',
    atomId: 'github.upload.safety',
  });
  assert.equal(latestAny?.path, blockedPrepare.artifactPath);
  assert.equal(latestAny?.status, 'BLOCKED');

  const latestSuccess = runtime.getLatestSuccessfulArtifact({
    kind: 'prepare',
    atomId: 'github.upload.safety',
  });
  assert.equal(latestSuccess?.path, readyPrepare.artifactPath);
  assert.equal(latestSuccess?.status, 'READY');

  const impossible = runtime.getLatestSuccessfulArtifact({
    kind: 'prepare',
    atomId: 'github.upload.safety',
    status: 'BLOCKED',
  });
  assert.equal(impossible, null);
});


