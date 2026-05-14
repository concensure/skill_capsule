const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function makeTempProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcap-index-report-test-'));
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

test('buildIndexMarkdown renders capsule, atom, hook, and governance sections deterministically', () => {
  const { default: SkillCapsuleRuntime } = require(path.join(repoRoot, 'dist', 'runtime.js'));
  const { buildIndexMarkdown } = require(path.join(repoRoot, 'dist', 'index-report.js'));
  const { configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  const markdown = buildIndexMarkdown(
    runtime.listCapsules(),
    runtime.listAtoms(),
    runtime.listHooks(),
    {
      version: '1.0',
      computed_at: '2026-05-14T00:00:00.000Z',
      atoms: [
        {
          atom_id: 'github.upload.safety',
          sample_count: 3,
          token_efficiency: 0.5,
          hook_pass_rate: 1,
          activation_accept_rate: null,
          computed_at: '2026-05-14T00:00:00.000Z',
        },
      ],
    },
    '2026-05-14T00:00:00.000Z',
  );

  assert.match(markdown, /# Skill Capsule Index/);
  assert.match(markdown, /<!-- generated-at: 2026-05-14T00:00:00.000Z -->/);
  assert.match(markdown, /## Capsules/);
  assert.match(markdown, /### github\.upload\.safe \(v0\.1\.0\)/);
  assert.match(markdown, /## Atoms/);
  assert.match(markdown, /### github\.upload\.safety \(v1\.0\.0\)/);
  assert.match(markdown, /## Hooks/);
  assert.match(markdown, /### hook\.git\.status/);
  assert.match(markdown, /## Governance Metrics/);
  assert.match(markdown, /\| github\.upload\.safety \| 3 \| 0\.50 \| 1\.00 \| n\/a \|/);
});

test('computeGovernanceReport derives stable metrics from artifact and outcome history', () => {
  const { default: SkillCapsuleRuntime } = require(path.join(repoRoot, 'dist', 'runtime.js'));
  const { computeGovernanceReport } = require(path.join(repoRoot, 'dist', 'index-report.js'));
  const { configPath, tempRoot } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  const compiledDir = path.join(tempRoot, '.skillcapsule', 'compiled');
  const composeArtifacts = [];
  const verifyArtifacts = [];
  for (let i = 0; i < 3; i += 1) {
    const composePath = path.join(compiledDir, `compose-${i}.json`);
    fs.writeFileSync(
      composePath,
      JSON.stringify({ renderPlan: [{ atomId: 'github.upload.safety', tokenCost: 25 }] }, null, 2),
    );
    composeArtifacts.push({
      id: `compose-${i}`,
      kind: 'compose',
      createdAt: `2026-05-14T00:00:0${i}.000Z`,
      atomId: 'github.upload.safety',
      path: composePath,
    });

    const verifyPath = path.join(compiledDir, `verify-${i}.json`);
    fs.writeFileSync(
      verifyPath,
      JSON.stringify({ hookResults: { after_action: [{ status: 'PASS' }, { status: 'PASS' }] } }, null, 2),
    );
    verifyArtifacts.push({
      id: `verify-${i}`,
      kind: 'verify',
      createdAt: `2026-05-14T00:00:1${i}.000Z`,
      atomId: 'github.upload.safety',
      path: verifyPath,
    });
  }

  const report = computeGovernanceReport(
    runtime.listAtoms(),
    composeArtifacts,
    verifyArtifacts,
    [
      { atom_id: 'github.upload.safety', activation_accepted: true },
      { atom_id: 'github.upload.safety', activation_accepted: true },
      { atom_id: 'github.upload.safety', activation_accepted: false },
    ],
    '2026-05-14T00:00:00.000Z',
  );

  const metric = report.atoms.find((item) => item.atom_id === 'github.upload.safety');
  assert.ok(metric);
  assert.equal(metric.sample_count, 3);
  assert.equal(metric.token_efficiency, 0.75);
  assert.equal(metric.hook_pass_rate, 1);
  assert.equal(metric.activation_accept_rate, 0.667);
});
