const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const SkillCapsuleRuntime = require(path.join(repoRoot, 'dist', 'runtime.js')).default;

function makeTempProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcap-runtime-registry-test-'));
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

test('runtime normalizes legacy capsule composition shape without breaking compose', async () => {
  const { configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  const capsules = runtime.listCapsules();
  const devStage = capsules.find((capsule) => capsule.id === 'stage.dev.velocity');
  assert.ok(devStage);
  assert.deepEqual(devStage.atoms, [
    'code.edit.safe',
    'meta.monitor.usage',
    'code.guard.local',
    'learning.atom.creator',
  ]);

  const result = await runtime.compose({
    description: 'Upload this project to GitHub but do not push',
    budget: 800,
    remote: 'origin',
    branch: 'main',
  });

  assert.ok(result.selectedCapsules.includes('github.upload.safe'));
  assert.ok(result.atoms.includes('github.upload.safety'));
});

test('compose requires a generated routing manifest instead of rescanning the full registry', async () => {
  const { tempRoot, configPath } = makeTempProject();
  fs.unlinkSync(path.join(tempRoot, '.skillcapsule', 'routing.manifest.json'));
  const runtime = new SkillCapsuleRuntime(configPath);

  await assert.rejects(
    runtime.compose({
      description: 'Upload this project to GitHub but do not push',
      budget: 800,
    }),
    /ROUTING_INDEX_MISSING|routing manifest/i,
  );
});
