const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function makeTempProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcap-indexer-test-'));
  fs.cpSync(path.join(repoRoot, '.skillcapsule'), path.join(tempRoot, '.skillcapsule'), {
    recursive: true,
  });
  fs.writeFileSync(path.join(tempRoot, 'README.md'), '# temp project\n');
  execFileSync('git', ['init'], { cwd: tempRoot, stdio: 'ignore' });
  return {
    tempRoot,
    atomsDir: path.join(tempRoot, '.skillcapsule', 'atoms'),
    capsulesDir: path.join(tempRoot, '.skillcapsule', 'capsules'),
    outputDir: path.join(tempRoot, '.skillcapsule'),
  };
}

test('indexer emits capability-aware CIF rows for Level 1 atoms', () => {
  const { SkillCapsuleIndexer } = require(path.join(repoRoot, 'dist', 'indexer.js'));
  const project = makeTempProject();
  const indexer = new SkillCapsuleIndexer({
    atomsDir: project.atomsDir,
    capsulesDir: project.capsulesDir,
    outputDir: project.outputDir,
    validateContracts: true,
  });

  const result = indexer.generate();

  assert.equal(result.errorCount, 0);
  assert.ok(result.routingManifest.atoms.some((atom) => atom.id === 'github.upload.safety'));
  assert.ok(result.routingManifest.capsules.some((capsule) => capsule.id === 'github.upload.safe'));
  assert.match(
    result.cifMarkdown,
    /github\|push\|upload -> github\.publish\.preflight \| risk:medium \| group:github-publish-preflight \| mode:inspect \| atoms:github\.upload\.safety/,
  );
  assert.match(
    result.cifMarkdown,
    /edit\|fix\|update -> code\.edit\.safety \| risk:medium \| group:code-edit-safety \| mode:activate \| atoms:code\.edit\.safe/,
  );
  assert.doesNotMatch(result.cifMarkdown, /code\.review\.diff_risk/);
});

test('indexSkillCapsule fails when LOCS contract risk is lower than declared side effects', () => {
  const { indexSkillCapsule } = require(path.join(repoRoot, 'dist', 'indexer.js'));
  const project = makeTempProject();
  const atomPath = path.join(project.atomsDir, 'code.edit.safe.json');
  const atom = JSON.parse(fs.readFileSync(atomPath, 'utf8'));
  atom.locs_capsule.risk_level = 'low';
  fs.writeFileSync(atomPath, `${JSON.stringify(atom, null, 2)}\n`);

  const result = indexSkillCapsule(project.atomsDir, project.capsulesDir, project.outputDir, true);
  const cifPath = path.join(project.outputDir, 'CIF.md');
  const cif = fs.readFileSync(cifPath, 'utf8');

  assert.equal(result.success, false);
  assert.match(result.errors.join(' '), /contract\/token-efficiency error/i);
  assert.match(cif, /RISK_LEVEL_CONFLICTS_WITH_SIDE_EFFECTS/);
});

test('skillcap index exits nonzero and writes CIF report when a Level 1 profile is malformed', () => {
  const project = makeTempProject();
  const atomPath = path.join(project.atomsDir, 'github.upload.safety.json');
  const atom = JSON.parse(fs.readFileSync(atomPath, 'utf8'));
  delete atom.locs_capsule.success_evidence;
  fs.writeFileSync(atomPath, `${JSON.stringify(atom, null, 2)}\n`);

  const command = spawnSync('node', [path.join(repoRoot, 'bin', 'skillcap.js'), 'index'], {
    cwd: project.tempRoot,
    encoding: 'utf8',
  });

  const cif = fs.readFileSync(path.join(project.outputDir, 'CIF.md'), 'utf8');

  assert.notEqual(command.status, 0);
  assert.match(cif, /ATOM_SCHEMA_INVALID/);
  assert.match(command.stderr, /validation failures/i);
});

test('indexSkillCapsule fails when a Level 2 atom omits locs_module_ref', () => {
  const { indexSkillCapsule } = require(path.join(repoRoot, 'dist', 'indexer.js'));
  const project = makeTempProject();
  const atomPath = path.join(project.atomsDir, 'code.edit.safe.json');
  const atom = JSON.parse(fs.readFileSync(atomPath, 'utf8'));
  atom.locs_level = 2;
  delete atom.locs_module_ref;
  fs.writeFileSync(atomPath, `${JSON.stringify(atom, null, 2)}\n`);

  const result = indexSkillCapsule(project.atomsDir, project.capsulesDir, project.outputDir, true);
  const cif = fs.readFileSync(path.join(project.outputDir, 'CIF.md'), 'utf8');

  assert.equal(result.success, false);
  assert.match(cif, /LEVEL2_REQUIRES_MODULE_REF/);
});
