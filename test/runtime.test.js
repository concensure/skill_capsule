const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
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

test('compose uses capsule registry and respects no_push negative intent', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = await runtime.compose({
    description: 'Upload this project to GitHub but do not push',
    budget: 800,
    remote: 'origin',
    branch: 'main',
  });

  assert.deepEqual(result.selectedCapsules, ['github.upload.safe']);
  assert.ok(result.atoms.includes('github.upload.safety'));
  assert.ok(result.atoms.includes('github.commit.message'));
  assert.ok(!result.atoms.includes('github.push.confirmation'));
  assert.deepEqual(result.receipt.intents, ['no_push']);
  assert.ok(result.hookPlan.before_render.includes('hook.git.status'));
  assert.ok(result.hookPlan.before_action.includes('hook.secrets.scan'));
  assert.match(result.compiledCapsule, /Negative Intents: no_push/);
  assert.ok(fs.existsSync(path.join(tempRoot, '.skillcapsule', 'compiled')));
  assert.ok(result.artifactPath);
  assert.ok(fs.existsSync(result.artifactPath));
  const listed = runtime.listArtifacts({ kind: 'compose', limit: 5 });
  assert.ok(listed.some((record) => record.path === result.artifactPath));
});

test('verify runs after_action hook and returns PASS in unrestricted scope', async () => {
  const { configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = await runtime.verify('code.edit.scope_guard', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['*'],
  });

  assert.equal(result.receipt.status, 'PASS');
  assert.equal(result.hookResults.after_action?.length, 1);
  assert.equal(result.hookResults.after_action?.[0].id, 'hook.diff.scope_check');
  assert.equal(result.hookResults.after_action?.[0].status, 'PASS');
  assert.ok(result.artifactPath);
  assert.ok(fs.existsSync(result.artifactPath));
});

test('prepare executes before_render and before_action hooks and reports READY', async () => {
  const { configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
    remote: 'origin',
    branch: 'main',
  });

  assert.equal(result.receipt.status, 'READY');
  assert.deepEqual(result.receipt.executedPhases, ['before_render', 'before_action']);
  assert.equal(result.hookResults.before_render?.[0].id, 'hook.git.status');
  assert.equal(result.hookResults.before_action?.[0].id, 'hook.secrets.scan');
  assert.equal(result.hookResults.before_action?.[0].status, 'PASS');
  assert.match(result.compiledCapsule, /hook\.secrets\.scan:PASS/);
  assert.ok(result.artifactPath);
  assert.ok(fs.existsSync(result.artifactPath));
  const artifact = JSON.parse(fs.readFileSync(result.artifactPath, 'utf-8'));
  assert.equal(artifact.receipt.status, 'READY');
  assert.equal(artifact.atomId, 'github.upload.safety');
  const fetched = runtime.getArtifact(result.artifactPath);
  assert.equal(fetched.atomId, 'github.upload.safety');
});

test('verify preserves dependency order for after_action hooks', async () => {
  const { configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = await runtime.verify('code.edit.safe', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['*'],
  });

  assert.deepEqual(
    result.hookResults.after_action?.map((item) => item.id),
    ['hook.diff.scope_check', 'hook.verify.typecheck'],
  );
});

test('validatePatch rejects unsupported operations', () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);
  const patchPath = path.join(tempRoot, 'bad-patch.json');

  fs.writeFileSync(
    patchPath,
    JSON.stringify(
      {
        target_atom: 'github.upload.safety',
        base_version: '1.0.0',
        ops: [{ op: 'rewrite_everything', value: 'nope' }],
      },
      null,
      2,
    ),
  );

  const result = runtime.validatePatch(patchPath);
  assert.equal(result.status, 'FAIL');
  assert.match(result.violations.join(' '), /Operation not allowed/);
});

test('prepare reports BLOCKED when before_action verification fails', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);
  fs.writeFileSync(
    path.join(tempRoot, 'secret.txt'),
    `sk-${'a'.repeat(48)}\n`,
  );

  const result = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });

  assert.equal(result.receipt.status, 'BLOCKED');
  assert.deepEqual(result.receipt.blockingHooks, ['hook.secrets.scan']);
  assert.equal(result.hookResults.before_action?.[0].status, 'FAIL');
  assert.ok(result.artifactPath);
  const artifact = JSON.parse(fs.readFileSync(result.artifactPath, 'utf-8'));
  assert.equal(artifact.receipt.status, 'BLOCKED');
});

test('verify fails fast on hook dependency cycles', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const registryPath = path.join(tempRoot, '.skillcapsule', 'hooks', 'hooks.registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));

  registry.hooks = registry.hooks.map((hook) => {
    if (hook.id === 'hook.diff.scope_check') {
      return { ...hook, depends_on: ['hook.verify.typecheck'] };
    }
    if (hook.id === 'hook.verify.typecheck') {
      return { ...hook, depends_on: ['hook.diff.scope_check'] };
    }
    return hook;
  });
  writeRegistry(tempRoot, registry);

  const runtime = new SkillCapsuleRuntime(configPath);

  await assert.rejects(
    runtime.verify('code.edit.safe', {
      description: 'Fix a bug in the workspace',
    }),
    /Hook dependency cycle detected/,
  );
});

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

test('verify persists failing verification artifacts', async () => {
  const { tempRoot, configPath } = makeTempProject();
  execFileSync('git', ['add', 'README.md'], { cwd: tempRoot, stdio: 'ignore' });
  fs.writeFileSync(path.join(tempRoot, 'README.md'), '# temp project changed\n');
  const runtime = new SkillCapsuleRuntime(configPath);

  const result = await runtime.verify('code.edit.safe', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['src/**'],
  });

  assert.equal(result.receipt.status, 'FAIL');
  assert.ok(result.receipt.blockingHooks.includes('hook.diff.scope_check'));
  assert.ok(result.artifactPath);
  const artifact = JSON.parse(fs.readFileSync(result.artifactPath, 'utf-8'));
  assert.equal(artifact.receipt.status, 'FAIL');
  assert.deepEqual(artifact.receipt.executedPhases, ['after_action']);
  const listed = runtime.listArtifacts({ kind: 'verify', limit: 10 });
  const indexed = listed.find((record) => record.path === result.artifactPath);
  assert.ok(indexed);
  const fetched = runtime.getArtifact(indexed.id);
  assert.equal(fetched.atomId, 'code.edit.safe');
});

test('artifact retention prunes older artifacts automatically', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.artifact_retention = {
    enabled: true,
    max_total: 2,
    max_per_kind: {
      compose: 2,
      prepare: 2,
      verify: 2,
    },
  };
  writeConfig(tempRoot, config);
  const runtime = new SkillCapsuleRuntime(configPath);

  const first = await runtime.compose('Upload this project to GitHub but do not push', 800);
  await new Promise((resolve) => setTimeout(resolve, 15));
  const second = await runtime.compose('Upload this project to GitHub but do not push', 800);
  await new Promise((resolve) => setTimeout(resolve, 15));
  const third = await runtime.compose('Upload this project to GitHub but do not push', 800);

  const artifacts = runtime.listArtifacts({ kind: 'compose', limit: 10 });
  assert.equal(artifacts.length, 2);
  assert.ok(artifacts.some((record) => record.path === second.artifactPath));
  assert.ok(artifacts.some((record) => record.path === third.artifactPath));
  assert.ok(!artifacts.some((record) => record.path === first.artifactPath));
  assert.ok(!fs.existsSync(first.artifactPath));
  assert.ok(fs.existsSync(second.artifactPath));
  assert.ok(fs.existsSync(third.artifactPath));
});

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

test('artifact list supports filtering by atom, status, and task type', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  await runtime.compose('Upload this project to GitHub but do not push', 800);
  const readyPrepare = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });
  fs.writeFileSync(path.join(tempRoot, 'secret.txt'), `sk-${'c'.repeat(48)}\n`);
  const blockedPrepare = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });
  const failedVerify = await runtime.verify('code.edit.safe', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['src/**'],
  });

  const byAtom = runtime.listArtifacts({ atomId: 'github.upload.safety', limit: 10 });
  assert.ok(byAtom.every((record) => record.atomId === 'github.upload.safety'));
  assert.ok(byAtom.some((record) => record.path === readyPrepare.artifactPath));
  assert.ok(byAtom.some((record) => record.path === blockedPrepare.artifactPath));

  const blockedOnly = runtime.listArtifacts({ status: 'BLOCKED', limit: 10 });
  assert.ok(blockedOnly.length >= 1);
  assert.ok(blockedOnly.every((record) => record.status === 'BLOCKED'));
  assert.ok(blockedOnly.some((record) => record.path === blockedPrepare.artifactPath));

  const publishOnly = runtime.listArtifacts({ taskType: 'publish', limit: 10 });
  assert.ok(publishOnly.length >= 2);
  assert.ok(publishOnly.every((record) => record.taskType === 'publish'));

  const verifyFailOnly = runtime.listArtifacts({ kind: 'verify', status: 'FAIL', taskType: 'coding', limit: 10 });
  assert.ok(verifyFailOnly.length >= 1);
  assert.ok(verifyFailOnly.some((record) => record.path === failedVerify.artifactPath));
});

test('artifact latest helpers return newest matching and newest successful records', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  const readyPrepare = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  fs.writeFileSync(path.join(tempRoot, 'secret.txt'), `sk-${'d'.repeat(48)}\n`);
  const blockedPrepare = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });

  const latestAny = runtime.getLatestArtifact({
    kind: 'prepare',
    atomId: 'github.upload.safety',
  });
  assert.equal(latestAny?.path, blockedPrepare.artifactPath);
  assert.equal(latestAny?.status, 'BLOCKED');

  const latestSuccess = runtime.getLatestSuccessfulArtifact({
    kind: 'prepare',
    atomId: 'github.upload.safety',
  });
  assert.equal(latestSuccess?.path, readyPrepare.artifactPath);
  assert.equal(latestSuccess?.status, 'READY');

  const impossible = runtime.getLatestSuccessfulArtifact({
    kind: 'prepare',
    atomId: 'github.upload.safety',
    status: 'BLOCKED',
  });
  assert.equal(impossible, null);
});

test('artifact summary reports counts by kind, status, and task type', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  await runtime.compose('Upload this project to GitHub but do not push', 800);
  await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });
  fs.writeFileSync(path.join(tempRoot, 'secret.txt'), `sk-${'e'.repeat(48)}\n`);
  await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });
  await runtime.verify('code.edit.safe', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['src/**'],
  });

  const summary = runtime.summarizeArtifacts();
  assert.equal(summary.total, 4);
  assert.equal(summary.byKind.compose, 1);
  assert.equal(summary.byKind.prepare, 2);
  assert.equal(summary.byKind.verify, 1);
  assert.equal(summary.byStatus.ok, 1);
  assert.equal(summary.byStatus.READY, 1);
  assert.equal(summary.byStatus.BLOCKED, 1);
  assert.equal(summary.byStatus.FAIL, 1);
  assert.equal(summary.byTaskType.publish, 3);
  assert.equal(summary.byTaskType.coding, 1);

  const prepareSummary = runtime.summarizeArtifacts({ kind: 'prepare', atomId: 'github.upload.safety' });
  assert.equal(prepareSummary.total, 2);
  assert.equal(prepareSummary.byKind.prepare, 2);
  assert.equal(prepareSummary.byStatus.READY, 1);
  assert.equal(prepareSummary.byStatus.BLOCKED, 1);
});

test('artifacts can be correlated by run ID across compose, prepare, and verify', async () => {
  const { configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);
  const runId = 'run-shared-flow';

  const compose = await runtime.compose({
    description: 'Upload this project to GitHub but do not push',
    budget: 800,
    run_id: runId,
  });
  const prepare = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
    run_id: runId,
  });
  const verify = await runtime.verify('code.edit.scope_guard', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['*'],
    run_id: runId,
  });

  assert.equal(compose.runId, runId);
  assert.equal(prepare.runId, runId);
  assert.equal(verify.runId, runId);

  const byRun = runtime.listArtifacts({ runId, limit: 10 });
  assert.equal(byRun.length, 3);
  assert.ok(byRun.every((record) => record.runId === runId));

  const lineage = runtime.getArtifactLineage(runId);
  assert.equal(lineage.runId, runId);
  assert.equal(lineage.artifacts.length, 3);
  assert.deepEqual(lineage.roots.length, 1);
  assert.deepEqual(
    lineage.artifacts.map((record) => record.kind).sort(),
    ['compose', 'prepare', 'verify'],
  );

  const latestVerify = runtime.getLatestSuccessfulArtifact({ runId, kind: 'verify' });
  assert.equal(latestVerify?.kind, 'verify');
  assert.equal(latestVerify?.runId, runId);

  const summary = runtime.summarizeArtifacts({ runId });
  assert.equal(summary.total, 3);
  assert.equal(summary.runIds, 1);
  assert.equal(summary.byKind.compose, 1);
  assert.equal(summary.byKind.prepare, 1);
  assert.equal(summary.byKind.verify, 1);
});

test('artifact lineage tracks inferred parents and explicit retry branches', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);
  const runId = 'run-branch-flow';

  const compose = await runtime.compose({
    description: 'Upload this project to GitHub but do not push',
    budget: 800,
    run_id: runId,
  });
  const prepare = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
    run_id: runId,
  });

  execFileSync('git', ['add', 'README.md'], { cwd: tempRoot, stdio: 'ignore' });
  fs.writeFileSync(path.join(tempRoot, 'README.md'), '# temp project changed\n');
  const failedVerify = await runtime.verify('code.edit.safe', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['src/**'],
    run_id: runId,
  });

  const failedVerifyRecord = runtime.getLatestArtifact({ runId, kind: 'verify' });
  const retryVerify = await runtime.verify('code.edit.scope_guard', {
    description: 'Retry scoped verification',
    allowed_paths: ['*'],
    run_id: runId,
    parent_artifact_id: failedVerifyRecord.id,
  });

  const lineage = runtime.getArtifactLineage(runId);
  const composeRecord = lineage.artifacts.find((item) => item.path === compose.artifactPath);
  const prepareRecord = lineage.artifacts.find((item) => item.path === prepare.artifactPath);
  const failedVerifyIndexed = lineage.artifacts.find((item) => item.path === failedVerify.artifactPath);
  const retryVerifyIndexed = lineage.artifacts.find((item) => item.path === retryVerify.artifactPath);

  assert.ok(composeRecord);
  assert.ok(prepareRecord);
  assert.ok(failedVerifyIndexed);
  assert.ok(retryVerifyIndexed);
  assert.deepEqual(lineage.roots, [composeRecord.id]);
  assert.equal(prepareRecord?.parentArtifactId, composeRecord?.id);
  assert.equal(failedVerifyIndexed?.parentArtifactId, prepareRecord?.id);
  assert.equal(retryVerifyIndexed?.parentArtifactId, failedVerifyIndexed?.id);

  const retryChildren = runtime.listArtifacts({ runId, parentArtifactId: failedVerifyIndexed.id, limit: 10 });
  assert.equal(retryChildren.length, 1);
  assert.equal(retryChildren[0].id, retryVerifyIndexed?.id);
  assert.deepEqual(lineage.childrenByParent[composeRecord.id], [prepareRecord.id]);
  assert.deepEqual(lineage.childrenByParent[prepareRecord.id], [failedVerifyIndexed.id]);
  assert.deepEqual(lineage.childrenByParent[failedVerifyIndexed.id], [retryVerifyIndexed.id]);
});

test('artifact resume and latest failed helpers return actionable follow-up context', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);
  const runId = 'run-resume-flow';

  const compose = await runtime.compose({
    description: 'Upload this project to GitHub but do not push',
    budget: 800,
    run_id: runId,
  });
  fs.writeFileSync(path.join(tempRoot, 'secret.txt'), `sk-${'f'.repeat(48)}\n`);
  const blockedPrepare = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
    run_id: runId,
  });
  const latestFailedPrepare = runtime.getLatestFailedArtifact({ runId, kind: 'prepare' });
  assert.equal(latestFailedPrepare?.path, blockedPrepare.artifactPath);

  const blockedResume = runtime.resumeFromArtifact(latestFailedPrepare.id);
  assert.equal(blockedResume.recommendedAction, 'prepare');
  assert.equal(blockedResume.atomId, 'github.upload.safety');
  assert.equal(blockedResume.task.run_id, runId);
  assert.equal(blockedResume.task.parent_artifact_id, latestFailedPrepare.id);

  execFileSync('git', ['add', 'README.md'], { cwd: tempRoot, stdio: 'ignore' });
  fs.writeFileSync(path.join(tempRoot, 'README.md'), '# temp project changed\n');
  const failedVerify = await runtime.verify('code.edit.safe', {
    description: 'Fix a bug in the workspace',
    allowed_paths: ['src/**'],
    run_id: runId,
  });
  const latestFailedVerify = runtime.getLatestFailedArtifact({ runId, kind: 'verify' });
  assert.equal(latestFailedVerify?.path, failedVerify.artifactPath);

  const verifyResume = runtime.resumeFromArtifact(latestFailedVerify.id);
  assert.equal(verifyResume.recommendedAction, 'verify');
  assert.equal(verifyResume.atomId, 'code.edit.safe');
  assert.equal(verifyResume.task.parent_artifact_id, latestFailedVerify.id);

  const composeRecord = runtime.listArtifacts({ runId, kind: 'compose', limit: 1 })[0];
  const composeResume = runtime.resumeFromArtifact(composeRecord.id);
  assert.equal(composeResume.recommendedAction, 'prepare');
  assert.equal(composeResume.task.parent_artifact_id, composeRecord.id);
});

test('hook command policy blocks non-allowlisted commands', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const registryPath = path.join(tempRoot, '.skillcapsule', 'hooks', 'hooks.registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  registry.hooks = registry.hooks.map((hook) =>
    hook.id === 'hook.secrets.scan'
      ? { ...hook, command: 'powershell -Command Get-Date' }
      : hook,
  );
  writeRegistry(tempRoot, registry);

  const runtime = new SkillCapsuleRuntime(configPath);
  const result = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });

  assert.equal(result.receipt.status, 'BLOCKED');
  assert.equal(result.hookResults.before_action?.[0].status, 'FAIL');
  assert.match(result.hookResults.before_action?.[0].summary ?? '', /not allowlisted/i);
});

test('hook command policy blocks node scripts outside hook scripts directory', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const registryPath = path.join(tempRoot, '.skillcapsule', 'hooks', 'hooks.registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.security.hook_policy.allowed_prefixes.read_only.push('node scripts/');
  writeConfig(tempRoot, config);
  registry.hooks = registry.hooks.map((hook) =>
    hook.id === 'hook.secrets.scan'
      ? { ...hook, command: 'node scripts/escape.js' }
      : hook,
  );
  writeRegistry(tempRoot, registry);

  const runtime = new SkillCapsuleRuntime(configPath);
  const result = await runtime.prepare('github.upload.safety', {
    description: 'Upload this project to GitHub',
  });

  assert.equal(result.receipt.status, 'BLOCKED');
  assert.equal(result.hookResults.before_action?.[0].status, 'FAIL');
  assert.match(result.hookResults.before_action?.[0].summary ?? '', /must stay under/i);
});

test('artifact write rolls back artifact file when index persistence fails', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);
  const originalWriteArtifactIndex = runtime.writeArtifactIndex;
  runtime.writeArtifactIndex = () => {
    throw new Error('simulated index write failure');
  };

  await assert.rejects(
    runtime.compose('Upload this project to GitHub but do not push', 800),
    /simulated index write failure/,
  );

  runtime.writeArtifactIndex = originalWriteArtifactIndex;
  const compiledFiles = fs
    .readdirSync(path.join(tempRoot, '.skillcapsule', 'compiled'))
    .filter((file) => file !== 'artifacts.index.json');
  assert.deepEqual(compiledFiles, []);
  const indexPath = path.join(tempRoot, '.skillcapsule', 'compiled', 'artifacts.index.json');
  assert.equal(fs.existsSync(indexPath), false);
});

test('runtime emits audit log entries for successful lifecycle actions', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  await runtime.compose('Upload this project to GitHub but do not push', 800);

  const logPath = path.join(tempRoot, '.skillcapsule', 'logs', 'runtime.jsonl');
  assert.equal(fs.existsSync(logPath), true);
  const entries = fs
    .readFileSync(logPath, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.ok(entries.some((entry) => entry.action === 'compose' && entry.status === 'started'));
  assert.ok(entries.some((entry) => entry.action === 'compose' && entry.status === 'succeeded'));
});

test('runtime error formatter returns stable structured payload', () => {
  const { configPath } = makeTempProject();
  const runtime = new SkillCapsuleRuntime(configPath);

  try {
    runtime.getArtifactLineage('missing-run');
    assert.fail('Expected getArtifactLineage to throw');
  } catch (error) {
    const payload = formatRuntimeError(error);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'ARTIFACT_LINEAGE_NOT_FOUND');
    assert.match(payload.error.message, /missing-run/);
    assert.equal(payload.error.retryable, false);
  }
});

test('bootstrap validation rejects invalid budget range at startup', () => {
  const { tempRoot, configPath } = makeTempProject();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.context_budget.default = 2000;
  config.context_budget.max = 1000;
  writeConfig(tempRoot, config);

  const bootstrapModule = loadFreshModule(path.join(repoRoot, 'dist', 'bootstrap.js'));
  assert.throws(
    () => bootstrapModule.validateRuntimeEnvironment(configPath),
    /default cannot exceed max/i,
  );
});

test('http server exposes readiness endpoint with validated startup metadata', async () => {
  const { configPath } = makeTempProject();
  const oldConfigPath = process.env.SKILLCAP_CONFIG_PATH;
  process.env.SKILLCAP_CONFIG_PATH = configPath;

  try {
    const serverModule = loadFreshModule(path.join(repoRoot, 'dist', 'server.js'));
    const { app } = serverModule.createApp();
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    assert.ok(port);

    const response = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, 'ready');
    assert.equal(payload.config_path, path.resolve(configPath));
    assert.ok(Array.isArray(payload.warnings));

    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  } finally {
    if (oldConfigPath === undefined) {
      delete process.env.SKILLCAP_CONFIG_PATH;
    } else {
      process.env.SKILLCAP_CONFIG_PATH = oldConfigPath;
    }
  }
});

test('http server exposes doctor endpoint with degraded status on invalid deployment config', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.context_budget.default = 5000;
  config.context_budget.max = 1000;
  writeConfig(tempRoot, config);

  const oldConfigPath = process.env.SKILLCAP_CONFIG_PATH;
  process.env.SKILLCAP_CONFIG_PATH = configPath;

  try {
    const serverModule = loadFreshModule(path.join(repoRoot, 'dist', 'server.js'));
    const { app } = serverModule.createApp();
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    assert.ok(port);

    const response = await fetch(`http://127.0.0.1:${port}/doctor`);
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.ok(payload.checks.some((check) => check.status === 'FAIL'));

    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  } finally {
    if (oldConfigPath === undefined) {
      delete process.env.SKILLCAP_CONFIG_PATH;
    } else {
      process.env.SKILLCAP_CONFIG_PATH = oldConfigPath;
    }
  }
});

test('http server returns structured startup error for MCP requests when not ready', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.context_budget.default = 5000;
  config.context_budget.max = 1000;
  writeConfig(tempRoot, config);

  const oldConfigPath = process.env.SKILLCAP_CONFIG_PATH;
  process.env.SKILLCAP_CONFIG_PATH = configPath;

  try {
    const serverModule = loadFreshModule(path.join(repoRoot, 'dist', 'server.js'));
    const { app } = serverModule.createApp();
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    assert.ok(port);

    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 500);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'STARTUP_NOT_READY');

    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  } finally {
    if (oldConfigPath === undefined) {
      delete process.env.SKILLCAP_CONFIG_PATH;
    } else {
      process.env.SKILLCAP_CONFIG_PATH = oldConfigPath;
    }
  }
});

test('doctor collects passing deployment diagnostics for a healthy project', () => {
  const { configPath } = makeTempProject();
  const bootstrapModule = loadFreshModule(path.join(repoRoot, 'dist', 'bootstrap.js'));
  const result = bootstrapModule.collectRuntimeDiagnostics(configPath);

  assert.equal(result.ok, true);
  assert.ok(result.checks.some((check) => check.name === 'config.validation' && check.status === 'PASS'));
  assert.ok(result.checks.some((check) => check.name === 'runtime.registry' && check.status === 'PASS'));
  assert.ok(result.checks.some((check) => check.name === 'runtime.container_image_tag' && check.status === 'WARN'));
});

test('bootstrap validation warns when temporal recording is configured but disabled', () => {
  const { tempRoot, configPath } = makeTempProject();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.temporal = {
    enabled: false,
    provider: 'timetrace',
    record_selection_events: true,
  };
  writeConfig(tempRoot, config);

  const bootstrapModule = loadFreshModule(path.join(repoRoot, 'dist', 'bootstrap.js'));
  const result = bootstrapModule.validateRuntimeEnvironment(configPath);

  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((warning) => warning.includes('temporal recording is configured but temporal.enabled is false')));
});

test('doctor reports temporal integration as warn when TimeTrace is configured but not ready', () => {
  const { tempRoot, configPath } = makeTempProject();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.temporal = {
    provider: 'timetrace',
    workspace_dir: '.timetrace',
    record_selection_events: true,
  };
  writeConfig(tempRoot, config);

  const bootstrapModule = loadFreshModule(path.join(repoRoot, 'dist', 'bootstrap.js'));
  const result = bootstrapModule.collectRuntimeDiagnostics(configPath);

  assert.equal(result.ok, true);
  assert.ok(
    result.checks.some(
      (check) =>
        check.name === 'runtime.temporal' &&
        check.status === 'WARN' &&
        /configured but not ready/i.test(check.detail),
    ),
  );
});

test('doctor returns a failing diagnostic result instead of throwing on invalid config', () => {
  const { tempRoot, configPath } = makeTempProject();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.context_budget.default = 5000;
  config.context_budget.max = 1000;
  writeConfig(tempRoot, config);

  const bootstrapModule = loadFreshModule(path.join(repoRoot, 'dist', 'bootstrap.js'));
  const result = bootstrapModule.collectRuntimeDiagnostics(configPath);

  assert.equal(result.ok, false);
  assert.ok(result.checks.some((check) => check.status === 'FAIL'));
  assert.match(result.checks[0].detail, /default cannot exceed max/i);
});

test('bootstrap validation rejects hook registries with missing script targets', () => {
  const { tempRoot, configPath } = makeTempProject();
  const registryPath = path.join(tempRoot, '.skillcapsule', 'hooks', 'hooks.registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  registry.hooks = registry.hooks.map((hook) =>
    hook.id === 'hook.secrets.scan'
      ? { ...hook, command: 'node .skillcapsule/hooks/scripts/does-not-exist.js' }
      : hook,
  );
  writeRegistry(tempRoot, registry);

  const bootstrapModule = loadFreshModule(path.join(repoRoot, 'dist', 'bootstrap.js'));
  assert.throws(
    () => bootstrapModule.validateRuntimeEnvironment(configPath),
    /references a missing script/i,
  );
});

test('bootstrap validation rejects hook registries with unknown dependencies', () => {
  const { tempRoot, configPath } = makeTempProject();
  const registryPath = path.join(tempRoot, '.skillcapsule', 'hooks', 'hooks.registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  registry.hooks = registry.hooks.map((hook) =>
    hook.id === 'hook.verify.typecheck'
      ? { ...hook, depends_on: ['hook.missing.dependency'] }
      : hook,
  );
  writeRegistry(tempRoot, registry);

  const bootstrapModule = loadFreshModule(path.join(repoRoot, 'dist', 'bootstrap.js'));
  assert.throws(
    () => bootstrapModule.validateRuntimeEnvironment(configPath),
    /depends on an unknown hook/i,
  );
});

test('bootstrap validation rejects enforced container runner when engine is unavailable', () => {
  const { tempRoot, configPath } = makeTempProject();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.security.hook_runner = {
    mode: 'container',
    enforce: true,
    executable: 'missing-container-engine',
    workspace_mount_path: '/workspace',
    network_mode: 'none',
  };
  writeConfig(tempRoot, config);

  const bootstrapModule = loadFreshModule(path.join(repoRoot, 'dist', 'bootstrap.js'));
  assert.throws(
    () => bootstrapModule.validateRuntimeEnvironment(configPath),
    /container hook runner executable is unavailable/i,
  );
});

test('hook execution does not leak arbitrary parent environment variables by default', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const scriptPath = path.join(tempRoot, '.skillcapsule', 'hooks', 'scripts', 'print-env.js');
  fs.writeFileSync(
    scriptPath,
    "console.log(process.env.SKILLCAP_TEST_SECRET ? 'leaked:yes' : 'leaked:no');\n",
  );

  const registryPath = path.join(tempRoot, '.skillcapsule', 'hooks', 'hooks.registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  registry.hooks = registry.hooks.map((hook) =>
    hook.id === 'hook.secrets.scan'
      ? { ...hook, command: 'node .skillcapsule/hooks/scripts/print-env.js' }
      : hook,
  );
  writeRegistry(tempRoot, registry);

  const runtime = new SkillCapsuleRuntime(configPath);
  const previous = process.env.SKILLCAP_TEST_SECRET;
  process.env.SKILLCAP_TEST_SECRET = 'top-secret';

  try {
    const result = await runtime.prepare('github.upload.safety', {
      description: 'Upload this project to GitHub',
    });
    assert.equal(result.receipt.status, 'READY');
    assert.equal(result.hookResults.before_action?.[0].status, 'PASS');
    assert.match(result.hookResults.before_action?.[0].summary ?? '', /leaked:no/);
  } finally {
    if (previous === undefined) {
      delete process.env.SKILLCAP_TEST_SECRET;
    } else {
      process.env.SKILLCAP_TEST_SECRET = previous;
    }
  }
});

test('hook execution only passes through allowlisted parent environment variables', async () => {
  const { tempRoot, configPath } = makeTempProject();
  const scriptPath = path.join(tempRoot, '.skillcapsule', 'hooks', 'scripts', 'print-visible-env.js');
  fs.writeFileSync(
    scriptPath,
    "console.log(process.env.SKILLCAP_TEST_VISIBLE ? 'visible:yes' : 'visible:no');\n",
  );

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.security.hook_policy.allowed_env_passthrough = ['SKILLCAP_TEST_VISIBLE'];
  writeConfig(tempRoot, config);

  const registryPath = path.join(tempRoot, '.skillcapsule', 'hooks', 'hooks.registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  registry.hooks = registry.hooks.map((hook) =>
    hook.id === 'hook.secrets.scan'
      ? { ...hook, command: 'node .skillcapsule/hooks/scripts/print-visible-env.js' }
      : hook,
  );
  writeRegistry(tempRoot, registry);

  const runtime = new SkillCapsuleRuntime(configPath);
  const previous = process.env.SKILLCAP_TEST_VISIBLE;
  process.env.SKILLCAP_TEST_VISIBLE = 'allowed';

  try {
    const result = await runtime.prepare('github.upload.safety', {
      description: 'Upload this project to GitHub',
    });
    assert.equal(result.receipt.status, 'READY');
    assert.equal(result.hookResults.before_action?.[0].status, 'PASS');
    assert.match(result.hookResults.before_action?.[0].summary ?? '', /visible:yes/);
  } finally {
    if (previous === undefined) {
      delete process.env.SKILLCAP_TEST_VISIBLE;
    } else {
      process.env.SKILLCAP_TEST_VISIBLE = previous;
    }
  }
});

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
