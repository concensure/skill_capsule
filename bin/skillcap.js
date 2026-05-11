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
  .description('List discovered capsules, atoms, and hooks')
  .action(() => {
    runCli(async () => {
      const SkillCapsuleRuntime = loadRuntime();
      const runtime = new SkillCapsuleRuntime(ensureInitialized());
      const payload = {
        capsules: runtime.listCapsules().map((item) => item.id),
        atoms: runtime.listAtoms().map((item) => item.id),
        hooks: runtime.listHooks().map((item) => item.id),
      };
      console.log(JSON.stringify(payload, null, 2));
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
