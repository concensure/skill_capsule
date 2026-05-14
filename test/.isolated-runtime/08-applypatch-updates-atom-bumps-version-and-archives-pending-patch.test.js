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


test('applyPatch updates atom, bumps version, and archives pending patch', () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);
  const patchPath = path.join(
    tempRoot,
    '.skillcapsule',
    'patches',
    'pending',
    'github-upload-add-keyword.json',
  );

  fs.writeFileSync(
    patchPath,
    JSON.stringify(
      {
        target_atom: 'github.upload.safety',
        base_version: '1.0.0',
        ops: [
          { op: 'add_trigger_keyword', value: 'shipit' },
          { op: 'replace_render', level: 'S', value: 'Before GitHub upload: inspect status, secrets, and commit intent.' },
        ],
      },
      null,
      2,
    ),
  );

  const result = runtime.applyPatch(patchPath);
  const atom = JSON.parse(
    fs.readFileSync(path.join(tempRoot, '.skillcapsule', 'atoms', 'github.upload.safety.json'), 'utf-8'),
  );

  assert.equal(result.status, 'APPLIED');
  assert.equal(atom.version, '1.0.1');
  assert.ok(atom.triggers.keywords.includes('shipit'));
  assert.equal(
    atom.render.S,
    'Before GitHub upload: inspect status, secrets, and commit intent.',
  );
  assert.ok(result.archivedPatchPath.endsWith(path.join('accepted', 'github-upload-add-keyword.json')));
  assert.ok(fs.existsSync(result.archivedPatchPath));
  assert.ok(!fs.existsSync(patchPath));
});


