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


test('runtime can execute hooks through a repo-local container runner shim', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const shimRelativePath = '.skillcapsule/hooks/scripts/fake-container-runner.cmd';
  const shimPath = path.join(tempRoot, '.skillcapsule', 'hooks', 'scripts', 'fake-container-runner.cmd');
  const markerPath = path.join(tempRoot, '.skillcapsule', 'hooks', 'scripts', 'runner-invoked.txt');

  fs.writeFileSync(
    shimPath,
    [
      '@echo off',
      `echo invoked>%~dp0runner-invoked.txt`,
      'echo PASS: fake container runner',
      'exit /b 0',
      '',
    ].join('\r\n'),
  );

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.security.hook_runner = {
    mode: 'container',
    enforce: true,
    executable: shimRelativePath,
    workspace_mount_path: '/workspace',
    network_mode: 'none',
  };
  writeConfig(tempRoot, config);

  const bootstrapModule = loadFreshModule(path.join(repoRoot, 'dist', 'bootstrap.js'));
  assert.equal(bootstrapModule.validateRuntimeEnvironment(configPath).ok, true);

  const runtime = new SkillCapsuleRuntime(configPath);
  const result = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });

  assert.equal(result.receipt.status, 'READY');
  assert.equal(fs.existsSync(markerPath), true);
  assert.ok(
    result.hookResults.before_render?.every((item) => item.summary.includes('fake container runner')),
  );
  assert.ok(
    result.hookResults.before_action?.every((item) => item.summary.includes('fake container runner')),
  );
});

