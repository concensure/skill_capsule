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


test('artifact write rolls back artifact file when index persistence fails', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);
  const originalWriteArtifactIndex = runtime.writeArtifactIndex;
  runtime.writeArtifactIndex = () => {
    throw new Error('simulated index write failure');
  };

  await assert.rejects(
    runtime.compose('Upload this project to GitHub but do not push', 800),
    /simulated index write failure/,
  );

  runtime.writeArtifactIndex = originalWriteArtifactIndex;
  const compiledFiles = fs
    .readdirSync(path.join(tempRoot, '.skillcapsule', 'compiled'))
    .filter((file) => file !== 'artifacts.index.json');
  assert.deepEqual(compiledFiles, []);
  const indexPath = path.join(tempRoot, '.skillcapsule', 'compiled', 'artifacts.index.json');
  assert.equal(fs.existsSync(indexPath), false);
});


