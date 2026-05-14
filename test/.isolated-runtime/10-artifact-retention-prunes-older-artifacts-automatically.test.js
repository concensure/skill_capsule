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


test('artifact retention prunes older artifacts automatically', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.artifact_retention = {
    enabled: true,
    max_total: 2,
    max_per_kind: {
      compose: 2,
      prepare: 2,
      verify: 2,
    },
  };
  writeConfig(tempRoot, config);
  const runtime = new SkillCapsuleRuntime(configPath);

  const first = await runtime.compose('Upload this project to GitHub but do not push', 800);
  await new Promise((resolve) => setTimeout(resolve, 15));
  const second = await runtime.compose('Upload this project to GitHub but do not push', 800);
  await new Promise((resolve) => setTimeout(resolve, 15));
  const third = await runtime.compose('Upload this project to GitHub but do not push', 800);

  const artifacts = runtime.listArtifacts({ kind: 'compose', limit: 10 });
  assert.equal(artifacts.length, 2);
  assert.ok(artifacts.some((record) => record.path === second.artifactPath));
  assert.ok(artifacts.some((record) => record.path === third.artifactPath));
  assert.ok(!artifacts.some((record) => record.path === first.artifactPath));
  assert.ok(!fs.existsSync(first.artifactPath));
  assert.ok(fs.existsSync(second.artifactPath));
  assert.ok(fs.existsSync(third.artifactPath));
});


