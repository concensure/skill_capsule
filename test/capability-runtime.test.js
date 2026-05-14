const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const SkillCapsuleRuntime = require(path.join(repoRoot, 'dist', 'runtime.js')).default;
const { indexSkillCapsule } = require(path.join(repoRoot, 'dist', 'indexer.js'));

function makeTempProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcap-capability-runtime-test-'));
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

function writeAtom(tempRoot, atom) {
  const atomPath = path.join(tempRoot, '.skillcapsule', 'atoms', `${atom.id}.json`);
  fs.writeFileSync(atomPath, `${JSON.stringify(atom, null, 2)}\n`);
}

function reindexProject(tempRoot) {
  const skillcapsuleDir = path.join(tempRoot, '.skillcapsule');
  const result = indexSkillCapsule(
    path.join(skillcapsuleDir, 'atoms'),
    path.join(skillcapsuleDir, 'capsules'),
    skillcapsuleDir,
    true,
  );
  assert.equal(result.success, true);
}

test('runtime.inspectCapability returns Level 1 contract fields for matching atoms', () => {
  const { configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = runtime.inspectCapability('github.publish.preflight');

  assert.equal(result.capability_id, 'github.publish.preflight');
  assert.equal(result.atom_count, 1);
  assert.deepEqual(result.atoms[0], {
    id: 'github.upload.safety',
    version: '1.0.0',
    capability_level: 1,
    risk_level: 'medium',
    approval_policy: 'auto-if-readonly',
    audit_level: 'standard',
    compatibility: ['git', 'github'],
    swappable_group: 'github-publish-preflight',
    success_evidence: ['git_status_collected', 'secret_scan_passed'],
    governance_valid: true,
    contract_violations: [],
    contract_warnings: [],
  });
});

test('runtime.selectCapability scores candidates deterministically from compatibility constraints', () => {
  const { configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = runtime.selectCapability('code.edit.safety', ['git']);

  assert.equal(result.capability_id, 'code.edit.safety');
  assert.equal(result.selected_atom, undefined);
  assert.equal(result.selected_version, undefined);
  assert.equal(result.compatibility_score, 0);
  assert.equal(result.compatibility_matched, 0);
  assert.deepEqual(result.all_candidates, [
    {
      atom_id: 'code.edit.safe',
      version: '1.0.0',
      capability_level: 1,
      governance_valid: true,
      eligible: false,
      selected: false,
      compatibility_score: 0.5,
      matched: 1,
      missing: ['typescript'],
      rejection_reasons: ['missing_compatibility:typescript'],
    },
  ]);
});

test('runtime.auditAtom returns contract validation output for a Level 1 atom', () => {
  const { configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = runtime.auditAtom('github.upload.safety');

  assert.equal(result.atom_id, 'github.upload.safety');
  assert.equal(result.capability_level, 1);
  assert.equal(result.valid, true);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.locs_capsule?.capability_id, 'github.publish.preflight');
  assert.deepEqual(
    result.checks.map((check) => check.name),
    [
      'contract_compliance',
      'dependency_integrity',
      'execution_evidence',
      'approval_compliance',
      'unexpected_file_changes',
      'exit_status',
    ],
  );
  assert.equal(result.checks.find((check) => check.name === 'contract_compliance')?.status, 'PASS');
  assert.equal(result.checks.find((check) => check.name === 'execution_evidence')?.status, 'WARN');
  assert.deepEqual(result.evidence_summary.success_evidence, ['git_status_collected', 'secret_scan_passed']);
  assert.deepEqual(result.evidence_summary.satisfied_evidence, []);
  assert.deepEqual(result.evidence_summary.missing_evidence, ['git_status_collected', 'secret_scan_passed']);
});

test('runtime.selectCapability prefers the lightest sufficient capability level', () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);
  const candidate = {
    id: 'code.edit.safe.alt',
    version: '0.2.0',
    kind: 'verification',
    locs_level: 2,
    locs_module_ref: 'docs/modules/code-edit-safe-alt.md',
    capability_id: 'code.edit.safety',
    triggers: {
      keywords: ['edit', 'fix', 'update'],
      task_types: ['coding'],
    },
    render: {
      S: 'Alt safe edit.',
      O: 'Alt safe edit.',
      X: 'Alt safe edit.',
    },
    token_estimate: {
      S: 10,
      O: 20,
      X: 30,
    },
    hooks: [
      { id: 'hook.diff.scope_check', phase: 'after_action' },
    ],
    activation_mode: 'activate',
    locs_capsule: {
      capability_id: 'code.edit.safety',
      capability_name: 'Scoped Code Edit Safety',
      capability_summary: 'Alternative implementation.',
      state_model: 'external-boundary',
      side_effects: 'explicit',
      determinism: 'deterministic-if-environment-stable',
      risk_level: 'medium',
      approval_policy: 'approval-required',
      audit_level: 'standard',
      swappable_atom_group: 'code-edit-safety',
      compatibility: ['git'],
      success_evidence: ['diff_scope_check_passed'],
    },
  };
  writeAtom(tempRoot, candidate);
  reindexProject(tempRoot);

  const result = runtime.selectCapability('code.edit.safety', ['git', 'typescript']);

  assert.equal(result.selected_atom, 'code.edit.safe');
  assert.deepEqual(result.all_candidates, [
    {
      atom_id: 'code.edit.safe',
      version: '1.0.0',
      capability_level: 1,
      governance_valid: true,
      eligible: true,
      selected: true,
      compatibility_score: 1,
      matched: 2,
      missing: [],
      rejection_reasons: [],
    },
    {
      atom_id: 'code.edit.safe.alt',
      version: '0.2.0',
      capability_level: 2,
      governance_valid: true,
      eligible: true,
      selected: false,
      compatibility_score: 1,
      matched: 1,
      missing: [],
      rejection_reasons: ['not_selected:higher_ranked_candidate'],
    },
  ]);
});

test('runtime.auditAtom uses latest verification artifacts to satisfy evidence and exit checks', async () => {
  const { configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  await runtime.verify('code.edit.scope_guard', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['*'],
  });

  const result = runtime.auditAtom('code.edit.scope_guard');

  assert.equal(result.valid, true);
  assert.equal(result.checks.find((check) => check.name === 'execution_evidence')?.status, 'PASS');
  assert.equal(result.checks.find((check) => check.name === 'unexpected_file_changes')?.status, 'PASS');
  assert.equal(result.checks.find((check) => check.name === 'exit_status')?.status, 'PASS');
  assert.deepEqual(result.evidence_summary.satisfied_evidence, ['diff_scope_check_passed']);
  assert.deepEqual(result.evidence_summary.missing_evidence, []);
  assert.equal(result.evidence_summary.latest_verify_status, 'PASS');
});

test('runtime.auditAtom reports failing verification evidence and approval-sensitive warnings', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  execFileSync('git', ['add', 'README.md'], { cwd: tempRoot, stdio: 'ignore' });
  fs.writeFileSync(path.join(tempRoot, 'README.md'), '# temp project changed\n');
  await runtime.verify('code.edit.safe', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['src/**'],
  });

  const failedAudit = runtime.auditAtom('code.edit.safe');
  assert.equal(failedAudit.checks.find((check) => check.name === 'execution_evidence')?.status, 'FAIL');
  assert.equal(failedAudit.checks.find((check) => check.name === 'unexpected_file_changes')?.status, 'FAIL');
  assert.equal(failedAudit.checks.find((check) => check.name === 'exit_status')?.status, 'FAIL');
  assert.ok(failedAudit.evidence_summary.missing_evidence.includes('diff_scope_check_passed'));
  assert.ok(failedAudit.evidence_summary.missing_evidence.includes('typecheck_passed'));

  const approvalAudit = runtime.auditAtom('github.push.confirmation');
  assert.equal(approvalAudit.checks.find((check) => check.name === 'approval_compliance')?.status, 'WARN');
});
