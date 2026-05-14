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


test('prepare executes before_render and before_action hooks and reports READY', async () => {
  const { configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
    remote: 'origin',
    branch: 'main',
  });

  assert.equal(result.receipt.status, 'READY');
  assert.deepEqual(result.receipt.executedPhases, ['before_render', 'before_action']);
  assert.equal(result.hookResults.before_render?.[0].id, 'hook.git.status');
  assert.equal(result.hookResults.before_action?.[0].id, 'hook.secrets.scan');
  assert.equal(result.hookResults.before_action?.[0].status, 'PASS');
  assert.match(result.compiledCapsule, /hook\.secrets\.scan:PASS/);
  assert.ok(result.artifactPath);
  assert.ok(fs.existsSync(result.artifactPath));
  const artifact = JSON.parse(fs.readFileSync(result.artifactPath, 'utf-8'));
  assert.equal(artifact.receipt.status, 'READY');
  assert.equal(artifact.atomId, 'github.upload.safety');
  const fetched = runtime.getArtifact(result.artifactPath);
  assert.equal(fetched.atomId, 'github.upload.safety');
});


