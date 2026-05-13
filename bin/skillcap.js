#!/usr/bin/env node

const { Command } = require('commander');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

function loadRuntimeModule() {
  try {
    return require('../dist/runtime.js');
  } catch (error) {
    console.error(chalk.red('Build output not found. Run "npm run build" first.'));
    process.exit(1);
  }
}

function loadRuntime() {
  return loadRuntimeModule().default;
}

function loadBootstrapModule() {
  try {
    return require('../dist/bootstrap.js');
  } catch (error) {
    console.error(chalk.red('Build output not found. Run "npm run build" first.'));
    process.exit(1);
  }
}

function handleCliError(error) {
  const runtimeModule = loadRuntimeModule();
  const formatter = runtimeModule.formatRuntimeError;
  const payload = typeof formatter === 'function'
    ? formatter(error)
    : {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: String(error.message || error),
          retryable: false,
        },
      };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

async function runCli(action) {
  try {
    await action();
  } catch (error) {
    handleCliError(error);
  }
}

function configPath() {
  return path.join(process.cwd(), '.skillcapsule', 'skillcapsule.config.json');
}

function ensureInitialized() {
  const file = configPath();
  if (!fs.existsSync(file)) {
    console.error(chalk.red('Error: .skillcapsule not initialized. Run "skillcap init" first.'));
    process.exit(1);
  }
  return file;
}

function loadTaskOption(taskOption, descriptionArgs) {
  if (taskOption) {
    return taskOption;
  }
  if (descriptionArgs.length > 0) {
    return descriptionArgs.join(' ');
  }
  console.error(chalk.red('Error: provide --task <task.json|text> or a task description.'));
  process.exit(1);
}

function withTaskMetadata(task, options) {
  if (typeof task !== 'string' || task.endsWith('.json')) {
    return task;
  }
  if (!options.runId && !options.parentArtifactId) {
    return task;
  }
  return {
    description: task,
    ...(options.runId ? { run_id: options.runId } : {}),
    ...(options.parentArtifactId ? { parent_artifact_id: options.parentArtifactId } : {}),
  };
}

const program = new Command();

program
  .name('skillcap')
  .description('Skill Capsule CLI')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize Skill Capsule in the current directory')
  .option('-p, --project <name>', 'Project name', 'My Project')
  .action(async (options) => {
    const dirs = [
      '.skillcapsule/capsules',
      '.skillcapsule/atoms',
      '.skillcapsule/hooks/scripts',
      '.skillcapsule/outcomes',
      '.skillcapsule/patches/pending',
      '.skillcapsule/patches/accepted',
      '.skillcapsule/patches/rejected',
      '.skillcapsule/compiled',
    ];

    for (const dir of dirs) {
      await fs.ensureDir(path.join(process.cwd(), dir));
    }

    const config = {
      project_name: options.project,
      version: '0.1.0',
      context_budget: {
        default: 800,
        max: 1200,
        mandatory_budget_reserved: {
          low: 0.2,
          medium: 0.35,
          high: 0.5,
          critical: 0.65,
        },
      },
      security: { sandbox_mode: 'container' },
    };

    await fs.writeJson(configPath(), config, { spaces: 2 });
    await fs.writeFile(
      path.join(process.cwd(), 'CLAUDE.md'),
      '# Claude Skill Capsule\nUse .skillcapsule/ for capsule registry and hooks.\n',
    );
    await fs.writeFile(
      path.join(process.cwd(), '.cursorrules'),
      '// Use Skill Capsule atoms from .skillcapsule/atoms/\n',
    );
    await fs.writeFile(
      path.join(process.cwd(), 'GEMINI.md'),
      '# Gemini Skill Capsule\nUse .skillcapsule/atoms/ for project-specific capability atoms.\n',
    );

    console.log(chalk.green('Skill Capsule initialized.'));
  });

program
  .command('doctor')
  .description('Run deployment diagnostics for config, registry, filesystem, and hook runner readiness')
  .action(() => {
    runCli(async () => {
      const bootstrap = loadBootstrapModule();
      const result = bootstrap.collectRuntimeDiagnostics(ensureInitialized());
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) {
        process.exit(1);
      }
    });
  });

program
  .command('index')
  .description('List discovered capsules, atoms, and hooks; generate CIF.md and INDEX.md')
  .action(() => {
    runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      const capsules = runtime.listCapsules();
      const atoms = runtime.listAtoms();
      const hooks = runtime.listHooks();

      console.log(JSON.stringify({
        capsules: capsules.map((c) => c.id),
        atoms: atoms.map((a) => a.id),
        hooks: hooks.map((h) => h.id),
      }, null, 2));

      const skillcapsuleDir = path.join(process.cwd(), '.skillcapsule');

      // Risk level ordering for max() comparisons
      const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 };
      // Activation mode ordering — higher = more restrictive
      const MODE_ORDER = { activate: 0, inspect: 1, block: 2, approval: 3 };

      function atomRisk(atom) {
        return atom.activation?.risk_min ?? 'low';
      }

      function atomMode(atom) {
        return atom.activation_mode ?? 'activate';
      }

      function maxRisk(riskList) {
        return riskList.reduce((max, r) => {
          return (RISK_ORDER[r] ?? 0) > (RISK_ORDER[max] ?? 0) ? r : max;
        }, 'low');
      }

      function maxMode(modeList) {
        return modeList.reduce((max, m) => {
          return (MODE_ORDER[m] ?? 0) > (MODE_ORDER[max] ?? 0) ? m : max;
        }, 'activate');
      }

      // Build atom-to-capsules membership map
      const atomCapsuleMap = {};
      for (const cap of capsules) {
        for (const atomId of (cap.atoms || [])) {
          if (!atomCapsuleMap[atomId]) atomCapsuleMap[atomId] = [];
          atomCapsuleMap[atomId].push(cap.id);
        }
      }

      const atomsInCapsules = new Set(capsules.flatMap((c) => c.atoms || []));
      const atomById = Object.fromEntries(atoms.map((a) => [a.id, a]));

      // ─── CIF.md ────────────────────────────────────────────────────────────
      const cifLines = [
        '<!-- generated: true -->',
        '<!-- source: atoms/*.json capsules/*.json -->',
        '<!-- do-not-edit: true -->',
        '',
        'intent_terms -> id | risk | deps | mode',
        '',
      ];

      // Capsule rows: one row per capsule, keywords = union of all member atom keywords
      for (const cap of capsules) {
        const members = (cap.atoms || []).map((id) => atomById[id]).filter(Boolean);
        const keywords = [...new Set(members.flatMap((a) => a.triggers?.keywords || []))];
        const risk = maxRisk(members.map(atomRisk));
        const mode = maxMode(members.map(atomMode));
        cifLines.push(`${keywords.join('|')} -> ${cap.id} | ${risk} | capsule | ${mode}`);
      }

      if (capsules.length > 0) cifLines.push('');

      // Standalone atom rows (atoms not bundled in any capsule)
      for (const atom of atoms) {
        if (atomsInCapsules.has(atom.id)) continue;
        const keywords = atom.triggers?.keywords || [];
        const risk = atomRisk(atom);
        const deps = atom.dependencies?.length ? atom.dependencies.join('+') : 'none';
        const mode = atomMode(atom);
        cifLines.push(`${keywords.join('|')} -> ${atom.id} | ${risk} | ${deps} | ${mode}`);
      }

      await fs.writeFile(path.join(skillcapsuleDir, 'CIF.md'), cifLines.join('\n') + '\n');

      // ─── INDEX.md ──────────────────────────────────────────────────────────
      const ts = new Date().toISOString();
      const indexLines = [
        '# Skill Capsule Index',
        '<!-- generated: true -->',
        '<!-- source: atoms/*.json capsules/*.json -->',
        '<!-- do-not-edit: true -->',
        `<!-- generated-at: ${ts} -->`,
        '',
        '## Capsules',
        '',
      ];

      for (const cap of capsules) {
        indexLines.push(`### ${cap.id} (v${cap.version})`);
        if (cap.description) indexLines.push(cap.description);
        indexLines.push(`Atoms: ${(cap.atoms || []).join(', ')}`);
        if (cap.default_budget) indexLines.push(`Budget: ${cap.default_budget}`);
        indexLines.push('');
      }

      indexLines.push('## Atoms', '');

      for (const atom of atoms) {
        const inCaps = atomCapsuleMap[atom.id];
        indexLines.push(`### ${atom.id} (v${atom.version})`);
        if (atom.render?.S) indexLines.push(atom.render.S);
        const kw = atom.triggers?.keywords?.join(', ') || '';
        const tt = atom.triggers?.task_types?.join(', ') || '';
        if (kw) indexLines.push(`Triggers: ${kw}`);
        if (tt) indexLines.push(`Task types: ${tt}`);
        indexLines.push(`Risk: ${atomRisk(atom)} | Mode: ${atomMode(atom)}`);
        if (inCaps?.length) indexLines.push(`Capsule: ${inCaps.join(', ')}`);
        if (atom.dependencies?.length) indexLines.push(`Depends: ${atom.dependencies.join(', ')}`);
        indexLines.push('');
      }

      indexLines.push('## Hooks', '');

      for (const hook of hooks) {
        indexLines.push(`### ${hook.id}`);
        indexLines.push(`Command: \`${hook.command}\``);
        indexLines.push(`Permission: ${hook.permission} | Kind: ${hook.kind}`);
        indexLines.push('');
      }

      // ─── Governance metrics ────────────────────────────────────────────
      const metricsDir = path.join(skillcapsuleDir, 'metrics');
      await fs.ensureDir(metricsDir);

      const composeArtifacts = runtime.listArtifacts({ kind: 'compose', limit: 100 });
      const verifyArtifacts = runtime.listArtifacts({ kind: 'verify', limit: 100 });

      const outcomesDir = path.join(skillcapsuleDir, 'outcomes');
      const outcomes = [];
      if (fs.existsSync(outcomesDir)) {
        for (const file of fs.readdirSync(outcomesDir).filter((f) => f.endsWith('.json'))) {
          try { outcomes.push(await fs.readJson(path.join(outcomesDir, file))); } catch {}
        }
      }

      const governanceAtoms = [];
      for (const atom of atoms) {
        const maxCost = atom.token_estimate?.X ?? 0;

        // Token efficiency: 1 - (avg actual cost / max cost). Lower render level = higher efficiency.
        const renderEntries = [];
        for (const record of composeArtifacts) {
          try {
            const payload = await fs.readJson(record.path);
            const entry = (payload.renderPlan ?? []).find((p) => p.atomId === atom.id);
            if (entry) renderEntries.push(entry);
          } catch {}
        }
        const tokenEfficiency = renderEntries.length >= 3 && maxCost > 0
          ? parseFloat((1 - (renderEntries.reduce((s, e) => s + (e.tokenCost ?? 0), 0) / renderEntries.length / maxCost)).toFixed(3))
          : null;

        // Hook pass rate: passing after_action hooks / total, from verify artifacts for this atom.
        const verifyForAtom = verifyArtifacts.filter((r) => r.atomId === atom.id);
        let hookPassRate = null;
        if (verifyForAtom.length >= 3) {
          let pass = 0, total = 0;
          for (const record of verifyForAtom) {
            try {
              const payload = await fs.readJson(record.path);
              for (const result of (payload.hookResults?.after_action ?? [])) {
                total++;
                if (result.status === 'PASS') pass++;
              }
            } catch {}
          }
          hookPassRate = total > 0 ? parseFloat((pass / total).toFixed(3)) : null;
        }

        // Activation accept rate: from outcomes with Evo-1 fields.
        const atomOutcomes = outcomes.filter(
          (o) => o.atom_id === atom.id && o.activation_accepted !== null && o.activation_accepted !== undefined,
        );
        const activationAcceptRate = atomOutcomes.length >= 3
          ? parseFloat((atomOutcomes.filter((o) => o.activation_accepted === true).length / atomOutcomes.length).toFixed(3))
          : null;

        governanceAtoms.push({
          atom_id: atom.id,
          sample_count: renderEntries.length,
          token_efficiency: tokenEfficiency,
          hook_pass_rate: hookPassRate,
          activation_accept_rate: activationAcceptRate,
          computed_at: new Date().toISOString(),
        });
      }

      const governanceReport = {
        version: '1.0',
        computed_at: new Date().toISOString(),
        atoms: governanceAtoms,
      };
      await fs.writeJson(path.join(metricsDir, 'governance.json'), governanceReport, { spaces: 2 });

      // Append governance section to INDEX.md
      const govLines = [
        '',
        '## Governance Metrics',
        '<!-- computed from artifact and outcome history -->',
        '',
        '| Atom | Samples | Token Efficiency | Hook Pass Rate | Activation Accept Rate |',
        '|---|---|---|---|---|',
      ];
      for (const m of governanceAtoms) {
        const te = m.token_efficiency !== null ? m.token_efficiency.toFixed(2) : 'n/a';
        const hp = m.hook_pass_rate !== null ? m.hook_pass_rate.toFixed(2) : 'n/a';
        const aa = m.activation_accept_rate !== null ? m.activation_accept_rate.toFixed(2) : 'n/a';
        govLines.push(`| ${m.atom_id} | ${m.sample_count} | ${te} | ${hp} | ${aa} |`);
      }
      await fs.appendFile(path.join(skillcapsuleDir, 'INDEX.md'), govLines.join('\n') + '\n');
      // ───────────────────────────────────────────────────────────────────

      console.log(chalk.green('Generated .skillcapsule/CIF.md, INDEX.md, and metrics/governance.json'));
    });
  });

program
  .command('score')
  .description('Print per-atom governance scores from the last index run')
  .action(() => {
    runCli(async () => {
      const metricsPath = path.join(process.cwd(), '.skillcapsule', 'metrics', 'governance.json');
      if (!fs.existsSync(metricsPath)) {
        console.error(chalk.yellow('No governance metrics found. Run "skillcap index" first.'));
        process.exit(1);
      }
      const report = await fs.readJson(metricsPath);
      console.log(JSON.stringify(report, null, 2));
    });
  });

program
  .command('classify')
  .description('Classify a task')
  .option('--task <task>', 'Task JSON path or raw task description')
  .argument('[description...]')
  .action((descriptionArgs, options) => {
    runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      const task = loadTaskOption(options.task, descriptionArgs);
      console.log(JSON.stringify(runtime.classifyTask(task), null, 2));
    });
  });

program
  .command('match')
  .description('Match capsules and atoms for a task')
  .option('--task <task>', 'Task JSON path or raw task description')
  .argument('[description...]')
  .action((descriptionArgs, options) => {
    runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      const task = loadTaskOption(options.task, descriptionArgs);
      console.log(JSON.stringify(runtime.match(task), null, 2));
    });
  });

program
  .command('compose')
  .description('Compile a compact LLM-ready capsule')
  .option('--task <task>', 'Task JSON path or raw task description')
  .option('--run-id <runId>', 'Optional execution run ID for artifact correlation')
  .option('--parent-artifact-id <artifactId>', 'Optional parent artifact ID for branching lineage')
  .option('-b, --budget <tokens>', 'Maximum token budget', (value) => parseInt(value, 10))
  .argument('[description...]')
  .action(async (descriptionArgs, options) => {
    await runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      const task = loadTaskOption(options.task, descriptionArgs);
      const taskInput = withTaskMetadata(task, options);
      const result = await runtime.compose(taskInput, options.budget);
      console.log(result.compiledCapsule);
      console.log('\n[Activation Receipt]');
      console.log(JSON.stringify(result.receipt, null, 2));
    });
  });

program
  .command('prepare')
  .description('Run before_render and before_action hooks for one atom')
  .argument('<atom-id>', 'Atom ID')
  .option('--task <task>', 'Task JSON path or raw task description')
  .option('--run-id <runId>', 'Optional execution run ID for artifact correlation')
  .option('--parent-artifact-id <artifactId>', 'Optional parent artifact ID for branching lineage')
  .action(async (atomId, options) => {
    await runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      const taskInput = withTaskMetadata(options.task, options);
      const result = await runtime.prepare(atomId, taskInput);
      console.log(JSON.stringify(result, null, 2));
      if (result.receipt.status === 'BLOCKED') {
        process.exit(1);
      }
    });
  });

program
  .command('activate')
  .description('Activate and render one atom')
  .argument('<atom-id>', 'Atom ID')
  .option('--task <task>', 'Task JSON path or raw task description')
  .option('--run-id <runId>', 'Optional execution run ID for artifact correlation')
  .option('--parent-artifact-id <artifactId>', 'Optional parent artifact ID for branching lineage')
  .action(async (atomId, options) => {
    await runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      const taskInput = withTaskMetadata(options.task, options);
      const result = await runtime.activate(atomId, taskInput);
      console.log(JSON.stringify(result, null, 2));
    });
  });

program
  .command('verify')
  .description('Run registered after_action hooks for one atom')
  .argument('<atom-id>', 'Atom ID')
  .option('--task <task>', 'Task JSON path or raw task description')
  .option('--run-id <runId>', 'Optional execution run ID for artifact correlation')
  .option('--parent-artifact-id <artifactId>', 'Optional parent artifact ID for branching lineage')
  .action(async (atomId, options) => {
    await runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      const taskInput = withTaskMetadata(options.task, options);
      const result = await runtime.verify(atomId, taskInput);
      console.log(JSON.stringify(result, null, 2));
      if (result.receipt.status === 'FAIL') {
        process.exit(1);
      }
    });
  });

const patch = program.command('patch').description('Patch proposal operations');

patch
  .command('validate')
  .description('Validate a patch proposal')
  .argument('<patch-file>', 'Patch file path')
  .action((patchFile) => {
    runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      const result = runtime.validatePatch(patchFile);
      console.log(JSON.stringify(result, null, 2));
      if (result.status === 'FAIL') {
        process.exit(1);
      }
    });
  });

patch
  .command('apply')
  .description('Apply a validated patch proposal')
  .argument('<patch-file>', 'Patch file path')
  .action((patchFile) => {
    runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      const result = runtime.applyPatch(patchFile);
      console.log(JSON.stringify(result, null, 2));
    });
  });

const outcome = program.command('outcome').description('Outcome recording operations');
const artifact = program.command('artifact').description('Artifact inspection operations');

outcome
  .command('record')
  .description('Record an outcome JSON file')
  .argument('<outcome-file>', 'Outcome file path')
  .action(async (outcomeFile) => {
    await runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      const outputPath = await runtime.recordOutcome(outcomeFile);
      console.log(JSON.stringify({ recorded_to: outputPath }, null, 2));
    });
  });

artifact
  .command('list')
  .description('List recent compiled artifacts')
  .option('--kind <kind>', 'Filter by artifact kind: compose, prepare, verify')
  .option('--run-id <runId>', 'Filter by execution run ID')
  .option('--parent-artifact-id <artifactId>', 'Filter by parent artifact ID')
  .option('--atom-id <atomId>', 'Filter by atom ID')
  .option('--status <status>', 'Filter by status such as READY, BLOCKED, PASS, FAIL, ok')
  .option('--task-type <taskType>', 'Filter by task type such as publish or coding')
  .option('--limit <count>', 'Maximum number of artifacts', (value) => parseInt(value, 10), 20)
  .action((options) => {
    runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      console.log(
        JSON.stringify(
          runtime.listArtifacts({
            kind: options.kind,
            runId: options.runId,
            parentArtifactId: options.parentArtifactId,
            atomId: options.atomId,
            status: options.status,
            taskType: options.taskType,
            limit: options.limit,
          }),
          null,
          2,
        ),
      );
    });
  });

artifact
  .command('show')
  .description('Show one artifact by ID or file path')
  .argument('<artifact-id-or-path>', 'Artifact ID from artifact list or artifact file path')
  .action((artifactIdOrPath) => {
    runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      console.log(JSON.stringify(runtime.getArtifact(artifactIdOrPath), null, 2));
    });
  });

artifact
  .command('resume')
  .description('Show the recommended next action and task metadata for continuing from an artifact')
  .argument('<artifact-id-or-path>', 'Artifact ID from artifact list or artifact file path')
  .action((artifactIdOrPath) => {
    runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      console.log(JSON.stringify(runtime.resumeFromArtifact(artifactIdOrPath), null, 2));
    });
  });

artifact
  .command('latest')
  .description('Show the latest artifact matching the supplied filters')
  .option('--kind <kind>', 'Filter by artifact kind: compose, prepare, verify')
  .option('--run-id <runId>', 'Filter by execution run ID')
  .option('--parent-artifact-id <artifactId>', 'Filter by parent artifact ID')
  .option('--atom-id <atomId>', 'Filter by atom ID')
  .option('--status <status>', 'Filter by status such as READY, BLOCKED, PASS, FAIL, ok')
  .option('--task-type <taskType>', 'Filter by task type such as publish or coding')
  .option('--success-only', 'Restrict to successful receipts')
  .option('--failed-only', 'Restrict to failed receipts such as BLOCKED or FAIL')
  .action((options) => {
    runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      const query = {
        kind: options.kind,
        runId: options.runId,
        parentArtifactId: options.parentArtifactId,
        atomId: options.atomId,
        status: options.status,
        taskType: options.taskType,
      };
      const result = options.successOnly
        ? runtime.getLatestSuccessfulArtifact(query)
        : options.failedOnly
          ? runtime.getLatestFailedArtifact(query)
          : runtime.getLatestArtifact(query);
      console.log(JSON.stringify(result, null, 2));
    });
  });

artifact
  .command('summary')
  .description('Summarize compiled artifacts by kind, status, and task type')
  .option('--kind <kind>', 'Filter by artifact kind: compose, prepare, verify')
  .option('--run-id <runId>', 'Filter by execution run ID')
  .option('--parent-artifact-id <artifactId>', 'Filter by parent artifact ID')
  .option('--atom-id <atomId>', 'Filter by atom ID')
  .option('--status <status>', 'Filter by status such as READY, BLOCKED, PASS, FAIL, ok')
  .option('--task-type <taskType>', 'Filter by task type such as publish or coding')
  .action((options) => {
    runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      console.log(
        JSON.stringify(
          runtime.summarizeArtifacts({
            kind: options.kind,
            runId: options.runId,
            parentArtifactId: options.parentArtifactId,
            atomId: options.atomId,
            status: options.status,
            taskType: options.taskType,
          }),
          null,
          2,
        ),
      );
    });
  });

artifact
  .command('lineage')
  .description('Show all artifacts associated with one execution run ID')
  .argument('<run-id>', 'Execution run ID')
  .action((runId) => {
    runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      console.log(JSON.stringify(runtime.getArtifactLineage(runId), null, 2));
    });
  });

artifact
  .command('prune')
  .description('Prune compiled artifacts according to retention policy')
  .action(() => {
    runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      console.log(JSON.stringify(runtime.pruneArtifacts(), null, 2));
    });
  });

program.parse(process.argv);
