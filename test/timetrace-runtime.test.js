const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const SkillCapsuleRuntime = require(path.join(repoRoot, 'dist', 'runtime.js')).default;

function makeTempProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcap-timetrace-test-'));
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

function writeConfig(configPath, config) {
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function installFakeTimeTrace(tempRoot, configPath) {
  const timetraceDir = path.join(tempRoot, '.timetrace');
  fs.mkdirSync(timetraceDir, { recursive: true });
  const scriptPath = path.join(tempRoot, 'fake-tt.js');
  const recordsPath = path.join(tempRoot, 'fake-tt-records.jsonl');
  fs.writeFileSync(
    scriptPath,
    [
      "const args = process.argv.slice(2);",
      "const fs = require('node:fs');",
      "const workspaceIndex = args.indexOf('--workspace');",
      "if (workspaceIndex === -1 || !args[workspaceIndex + 1]) {",
      "  console.error('missing workspace');",
      '  process.exit(1);',
      '}',
      "const recordIndex = args.indexOf('record');",
      "const mode = recordIndex >= 0 ? `record:${args[recordIndex + 1] || 'unknown'}` : args.includes('history') ? 'history' : args.includes('compare') ? 'compare' : 'unknown';",
      "const capabilityIndex = args.indexOf('--capability-id');",
      "const capabilityId = capabilityIndex >= 0 ? args[capabilityIndex + 1] : null;",
      "const scoreIndex = args.indexOf('--score');",
      "const score = scoreIndex >= 0 ? Number(args[scoreIndex + 1]) : null;",
      "const contextIndex = args.indexOf('--context');",
      "const context = contextIndex >= 0 ? args[contextIndex + 1] : null;",
      "const outcomeIndex = args.indexOf('--outcome');",
      "const outcome = outcomeIndex >= 0 ? args[outcomeIndex + 1] : null;",
      "const summaryIndex = args.indexOf('--summary');",
      "const summary = summaryIndex >= 0 ? args[summaryIndex + 1] : null;",
      "if (mode === 'history') {",
      '  process.stdout.write(JSON.stringify([',
      '    {',
      "      event_id: 'evt_001',",
      "      event_type: 'audit_receipt',",
      "      timestamp: '2026-05-14T00:00:00Z',",
      "      repo: 'skill_capsule',",
      '      files: [],',
      '      symbols: [],',
      '      diff_loc: null,',
      '      bug_signature: null,',
      '      capability_id: capabilityId,',
      '      atom_id: null,',
      "      verified: 'verified',",
      "      evidence: { test_command: null, test_status: null, commit_hash: null, linked_events: [], outcome: 'approved', score: null, notes: ['scope:selection-history'] },",
      "      summary: 'Audit approved'",
      '    }',
      '  ]));',
      '  process.exit(0);',
      '}',
      "if (mode === 'compare') {",
      '  process.stdout.write(JSON.stringify({',
      '    total_events: 4,',
      '    audit_count: 3,',
      '    approved_count: 3,',
      '    rejected_count: 0,',
      '    verified_count: 3,',
      '    rollback_count: 0,',
      '    mutation_count: 1,',
      '    approval_rate: 1.0,',
      "    evidence_quality: 'high',",
      '    has_recent_rollback: false,',
      "    confidence: 'stable'",
      '  }));',
      '  process.exit(0);',
      '}',
      "if (mode === 'record:selection') {",
      `  fs.appendFileSync(${JSON.stringify(recordsPath)}, JSON.stringify({ type: 'selection', capability_id: capabilityId, context, score }) + '\\n');`,
      "  if (context && context.includes('force-fail')) {",
      "    console.error('selection write failed');",
      '    process.exit(1);',
      '  }',
      "  process.stdout.write('recorded');",
      '  process.exit(0);',
      '}',
      "if (mode === 'record:audit') {",
      `  fs.appendFileSync(${JSON.stringify(recordsPath)}, JSON.stringify({ type: 'audit', capability_id: capabilityId, outcome, summary }) + '\\n');`,
      "  if (summary && summary.includes('force-fail')) {",
      "    console.error('audit write failed');",
      '    process.exit(1);',
      '  }',
      "  process.stdout.write('recorded');",
      '  process.exit(0);',
      '}',
      "console.error('unsupported command');",
      'process.exit(1);',
      '',
    ].join('\n'),
  );

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.temporal = {
    provider: 'timetrace',
    workspace_dir: '.timetrace',
    binary: process.execPath,
    binary_args: [scriptPath],
  };
  writeConfig(configPath, config);
  return { recordsPath };
}

test('runtime.historyCapability returns TimeTrace-backed capability history with scope warnings', () => {
  const { tempRoot, configPath } = makeTempProject();
  installFakeTimeTrace(tempRoot, configPath);
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = runtime.historyCapability('github.publish.preflight', 'selection-history');

  assert.equal(result.provider, 'timetrace');
  assert.equal(result.workspace_path, path.join(tempRoot, '.timetrace'));
  assert.equal(result.temporal_tracking_declared, false);
  assert.equal(result.event_count, 1);
  assert.equal(result.events[0].event_id, 'evt_001');
  assert.ok(result.warnings.some((warning) => warning.includes('selection-history')));
  assert.ok(result.warnings.some((warning) => warning.includes('temporal_tracking')));
});

test('runtime.evolveCapability derives recommendation from TimeTrace comparison stats', () => {
  const { tempRoot, configPath } = makeTempProject();
  installFakeTimeTrace(tempRoot, configPath);
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = runtime.evolveCapability('code.edit.safety');

  assert.equal(result.provider, 'timetrace');
  assert.equal(result.workspace_path, path.join(tempRoot, '.timetrace'));
  assert.equal(result.recommendation, 'promote');
  assert.equal(result.confidence_gate, 'high');
  assert.equal(result.stats.approval_rate, 1);
  assert.ok(result.reasoning.some((reason) => reason.includes('Approval rate')));
});

test('runtime.historyCapability fails explicitly when TimeTrace workspace is missing', () => {
  const { configPath } = makeTempProject();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.temporal = {
    provider: 'timetrace',
    workspace_dir: '.timetrace',
    binary: process.execPath,
    binary_args: [path.join(repoRoot, 'test', 'does-not-matter.js')],
  };
  writeConfig(configPath, config);
  const runtime = new SkillCapsuleRuntime(configPath);

  assert.throws(
    () => runtime.historyCapability('code.edit.safety'),
    /TIMETRACE_HISTORY_UNAVAILABLE|TimeTrace workspace not found/i,
  );
});

test('runtime.selectCapability records TimeTrace selection event when enabled', () => {
  const { tempRoot, configPath } = makeTempProject();
  const { recordsPath } = installFakeTimeTrace(tempRoot, configPath);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.temporal.record_selection_events = true;
  writeConfig(configPath, config);
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = runtime.selectCapability('code.edit.safety', ['git', 'typescript']);

  assert.equal(result.selected_atom, 'code.edit.safe');
  assert.deepEqual(result.temporal_warnings, []);
  const records = fs.readFileSync(recordsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(records.length, 1);
  assert.equal(records[0].type, 'selection');
  assert.equal(records[0].capability_id, 'code.edit.safety');
  assert.match(records[0].context, /selected_atom=code\.edit\.safe/);
  assert.equal(records[0].score, 1);
});

test('runtime.auditAtom records TimeTrace audit receipt when enabled', () => {
  const { tempRoot, configPath } = makeTempProject();
  const { recordsPath } = installFakeTimeTrace(tempRoot, configPath);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.temporal.record_audit_receipts = true;
  writeConfig(configPath, config);
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = runtime.auditAtom('code.edit.safe');

  assert.deepEqual(result.temporal_warnings, []);
  const records = fs.readFileSync(recordsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(records.length, 1);
  assert.equal(records[0].type, 'audit');
  assert.equal(records[0].capability_id, 'code.edit.safety');
  assert.equal(records[0].outcome, 'approved');
  assert.match(records[0].summary, /atom=code\.edit\.safe/);
});

test('runtime.selectCapability surfaces temporal warning when selection recording fails', () => {
  const { tempRoot, configPath } = makeTempProject();
  installFakeTimeTrace(tempRoot, configPath);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.temporal.record_selection_events = true;
  writeConfig(configPath, config);
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = runtime.selectCapability('code.edit.safety', ['git', 'typescript', 'force-fail']);

  assert.equal(result.selected_atom, 'code.edit.safe');
  assert.ok(result.temporal_warnings.some((warning) => warning.includes('selection recording failed')));
});
