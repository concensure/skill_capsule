const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const fixturesRoot = path.join(__dirname, 'fixtures', 'golden');

function makeTempProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcap-golden-test-'));
  fs.cpSync(path.join(repoRoot, '.skillcapsule'), path.join(tempRoot, '.skillcapsule'), {
    recursive: true,
  });
  fs.writeFileSync(path.join(tempRoot, 'README.md'), '# temp project\n');
  execFileSync('git', ['init'], { cwd: tempRoot, stdio: 'ignore' });
  return {
    tempRoot,
    skillcapsuleDir: path.join(tempRoot, '.skillcapsule'),
  };
}

function readFixture(name) {
  return fs.readFileSync(path.join(fixturesRoot, name), 'utf8');
}

function readJsonFixture(name) {
  return JSON.parse(readFixture(name));
}

function runCliJson(projectRoot, ...args) {
  const output = execFileSync('node', [path.join(repoRoot, 'bin', 'skillcap.js'), ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

function normalizeDoctorPayload(payload, projectRoot) {
  const normalizedRoot = path.resolve(projectRoot).replace(/\\/g, '/');
  const normalizeValue = (value) => {
    const normalizedValue = String(value).replace(/\\/g, '/');
    return normalizedValue.split(normalizedRoot).join('<PROJECT_ROOT>');
  };

  return {
    ok: payload.ok,
    configPath: normalizeValue(payload.configPath),
    projectRoot: normalizeValue(payload.projectRoot),
    checks: payload.checks.map((check) => ({
      name: check.name,
      status: check.status,
      detail: normalizeValue(check.detail),
    })),
  };
}

function summarizeRoutingManifest(manifest) {
  return {
    version: manifest.version,
    atom_ids: manifest.atoms.map((atom) => atom.id),
    capability_atoms: manifest.atoms
      .filter((atom) => atom.capability_id)
      .map((atom) => ({
        id: atom.id,
        capability_id: atom.capability_id,
        capability_level: atom.capability_level,
        activation_mode: atom.activation_mode,
      })),
    capsule_ids: manifest.capsules.map((capsule) => capsule.id),
    stage_capsule_ids: manifest.capsules.filter((capsule) => capsule.type === 'stage').map((capsule) => capsule.id),
  };
}

test('generated CIF matches the golden routing contract', () => {
  const { SkillCapsuleIndexer } = require(path.join(repoRoot, 'dist', 'indexer.js'));
  const project = makeTempProject();
  const indexer = new SkillCapsuleIndexer({
    atomsDir: path.join(project.skillcapsuleDir, 'atoms'),
    capsulesDir: path.join(project.skillcapsuleDir, 'capsules'),
    outputDir: project.skillcapsuleDir,
    validateContracts: true,
  });

  const result = indexer.generate();

  assert.equal(result.errorCount, 0);
  assert.equal(result.cifMarkdown, readFixture('cif.md'));
});

test('generated routing manifest summary matches the golden contract', () => {
  const { SkillCapsuleIndexer } = require(path.join(repoRoot, 'dist', 'indexer.js'));
  const project = makeTempProject();
  const indexer = new SkillCapsuleIndexer({
    atomsDir: path.join(project.skillcapsuleDir, 'atoms'),
    capsulesDir: path.join(project.skillcapsuleDir, 'capsules'),
    outputDir: project.skillcapsuleDir,
    validateContracts: true,
  });

  const result = indexer.generate();
  const summary = summarizeRoutingManifest(result.routingManifest);

  assert.deepEqual(summary, readJsonFixture('routing-summary.json'));
});

test('inspect CLI JSON output matches the golden contract', () => {
  const project = makeTempProject();
  const result = runCliJson(project.tempRoot, 'inspect', 'github.publish.preflight');

  assert.deepEqual(result, readJsonFixture('inspect-github.publish.preflight.json'));
});

test('select CLI JSON output matches the golden contract', () => {
  const project = makeTempProject();
  const result = runCliJson(project.tempRoot, 'select', 'code.edit.safety', '--project-constraints', 'git', 'typescript');

  assert.deepEqual(result, readJsonFixture('select-code.edit.safety.json'));
});

test('doctor CLI JSON output matches the golden contract after path normalization', () => {
  const project = makeTempProject();
  const result = runCliJson(project.tempRoot, 'doctor');
  const normalized = normalizeDoctorPayload(result, project.tempRoot);

  assert.deepEqual(normalized, readJsonFixture('doctor.json'));
});
