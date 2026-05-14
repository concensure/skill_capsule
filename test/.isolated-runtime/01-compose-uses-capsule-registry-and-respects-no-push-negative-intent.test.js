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


test('compose uses capsule registry and respects no_push negative intent', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = await runtime.compose({
    description: 'Upload this project to GitHub but do not push',
    budget: 800,
    remote: 'origin',
    branch: 'main',
  });

  assert.deepEqual(result.selectedCapsules, ['github.upload.safe']);
  assert.ok(result.atoms.includes('github.upload.safety'));
  assert.ok(result.atoms.includes('github.commit.message'));
  assert.ok(!result.atoms.includes('github.push.confirmation'));
  assert.deepEqual(result.receipt.intents, ['no_push']);
  assert.ok(result.hookPlan.before_render.includes('hook.git.status'));
  assert.ok(result.hookPlan.before_action.includes('hook.secrets.scan'));
  assert.match(result.compiledCapsule, /Negative Intents: no_push/);
  assert.ok(fs.existsSync(path.join(tempRoot, '.skillcapsule', 'compiled')));
  assert.ok(result.artifactPath);
  assert.ok(fs.existsSync(result.artifactPath));
  const listed = runtime.listArtifacts({ kind: 'compose', limit: 5 });
  assert.ok(listed.some((record) => record.path === result.artifactPath));
});


