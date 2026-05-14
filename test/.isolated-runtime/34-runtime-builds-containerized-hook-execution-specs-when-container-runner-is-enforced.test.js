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


test('runtime builds containerized hook execution specs when container runner is enforced', () => {
  const { tempRoot, configPath } = makeTempProject();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.security.hook_runner = {
    mode: 'container',
    enforce: true,
    executable: 'docker',
    workspace_mount_path: '/workspace',
    network_mode: 'none',
  };
  writeConfig(tempRoot, config);

  const runtime = new SkillCapsuleRuntime(configPath);
  const spec = runtime.buildHookExecutionSpec(
    { file: 'node', args: ['.skillcapsule/hooks/scripts/secrets-scan.js'] },
    { SC_TASK: 'Upload this project' },
    'read_only',
  );

  assert.equal(spec.file, 'docker');
  assert.ok(spec.args.includes('run'));
  assert.ok(spec.args.includes('--rm'));
  assert.ok(spec.args.includes('--network'));
  assert.ok(spec.args.includes('none'));
  assert.ok(spec.args.includes('--workdir'));
  assert.ok(spec.args.includes('/workspace'));
  assert.ok(spec.args.includes('--volume'));
  assert.ok(spec.args.some((arg) => arg.includes(`${tempRoot}:/workspace:ro`)));
  assert.ok(spec.args.includes('--env'));
  assert.ok(spec.args.includes('SC_TASK=Upload this project'));
  assert.ok(spec.args.includes('skillcapsule/hook-runner:latest'));
  assert.deepEqual(spec.env.SC_TASK, undefined);
});


