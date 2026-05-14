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


test('manual artifact prune removes excess indexed files', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.artifact_retention = {
    enabled: true,
    max_total: 50,
    max_per_kind: {
      compose: 50,
      prepare: 50,
      verify: 50,
    },
  };
  writeConfig(tempRoot, config);
  const runtime = new SkillCapsuleRuntime(configPath);

  const compose = await runtime.compose('Upload this project to GitHub but do not push', 800);
  const prepare = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });
  const verify = await runtime.verify('code.edit.scope_guard', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['*'],
  });

  const tightenedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  tightenedConfig.artifact_retention.max_total = 1;
  tightenedConfig.artifact_retention.max_per_kind = {
    compose: 1,
    prepare: 1,
    verify: 1,
  };
  writeConfig(tempRoot, tightenedConfig);
  const tightenedRuntime = new SkillCapsuleRuntime(configPath);

  const pruned = tightenedRuntime.pruneArtifacts();
  assert.ok(pruned.removed.length >= 2);
  const remaining = tightenedRuntime.listArtifacts({ limit: 10 });
  assert.equal(remaining.length, 1);
  assert.ok(fs.existsSync(remaining[0].path));
  const removedPaths = pruned.removed.map((record) => record.path);
  assert.ok(removedPaths.includes(compose.artifactPath) || removedPaths.includes(prepare.artifactPath) || removedPaths.includes(verify.artifactPath));
});


