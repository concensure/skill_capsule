#!/usr/bin/env node

const { Command } = require('commander');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const SkillCapsuleRuntime = require('../src/runtime');

const program = new Command();

program
  .name('skillcap')
  .description('Skill Capsule CLI - Manage atomic AI skills')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize Skill Capsule in the current directory')
  .option('-p, --project <name>', 'Project name', 'My Project')
  .action(async (options) => {
    console.log(chalk.blue(`Initializing Skill Capsule for ${options.project}...`));
    
    const dirs = [
      '.skillcapsule/capsules',
      '.skillcapsule/atoms',
      '.skillcapsule/hooks/scripts',
      '.skillcapsule/outcomes',
      '.skillcapsule/patches/pending',
      '.skillcapsule/patches/accepted',
      '.skillcapsule/patches/rejected'
    ];

    for (const dir of dirs) {
      await fs.ensureDir(path.join(process.cwd(), dir));
    }

    // Create default config
    const config = {
      project_name: options.project,
      version: '0.1.0',
      context_budget: { 
        default: 800, 
        max: 1200,
        mandatory_budget_reserved: { low: 0.20, medium: 0.35, high: 0.50, critical: 0.65 }
      },
      security: { sandbox_mode: 'container' }
    };
    await fs.writeJson(path.join(process.cwd(), '.skillcapsule/skillcapsule.config.json'), config, { spaces: 2 });

    // Agent Recognition Files
    console.log(chalk.green('Generating Agent Recognition Files...'));
    
    const claudeMd = `# Claude Skill Capsule\nThis project uses Skill Capsule for atomic skills. Refer to \`.skillcapsule/\` for capability atoms and hooks.`;
    const cursorRules = `// Cursor Rules\n// Use Skill Capsule atoms in .skillcapsule/atoms/ for project-specific logic.`;
    const geminiMd = `# Gemini Skill Capsule\nProject instructions are managed via Skill Capsule atoms in \`.skillcapsule/atoms/\`.`;

    await fs.writeFile(path.join(process.cwd(), 'CLAUDE.md'), claudeMd);
    await fs.writeFile(path.join(process.cwd(), '.cursorrules'), cursorRules);
    await fs.writeFile(path.join(process.cwd(), 'GEMINI.md'), geminiMd);

    console.log(chalk.bold.green('\nSuccess! Skill Capsule initialized.'));
    console.log('Run ' + chalk.cyan('skillcap --help') + ' to see available commands.');
  });

program
  .command('compose')
  .description('Classify a task and compile a compact skill capsule')
  .argument('<task>', 'Description of the task to perform')
  .option('-b, --budget <tokens>', 'Maximum token budget for the capsule', parseInt)
  .action(async (task, options) => {
    const configPath = path.join(process.cwd(), '.skillcapsule/skillcapsule.config.json');
    if (!fs.existsSync(configPath)) {
      console.error(chalk.red('Error: .skillcapsule not initialized. Run "skillcap init" first.'));
      process.exit(1);
    }

    const runtime = new SkillCapsuleRuntime(configPath);
    console.log(chalk.blue('Composing capsule for task: ') + chalk.italic(task));

    try {
      const result = await runtime.compose(task, options.budget);
      
      console.log(chalk.green('\n' + result.receipt));
      console.log(chalk.bold.blue('\n--- Compiled Context Capsule ---\n'));
      console.log(result.compiledCapsule);
      console.log(chalk.bold.blue('--- End of Capsule ---\n'));
    } catch (err) {
      console.error(chalk.red('\nComposition failed:'), err.message);
      process.exit(1);
    }
  });

program
  .command('verify')
  .description('Run post-action verification hooks for a specific atom')
  .argument('<atom-id>', 'ID of the atom to verify')
  .action(async (atomId) => {
    const configPath = path.join(process.cwd(), '.skillcapsule/skillcapsule.config.json');
    if (!fs.existsSync(configPath)) {
      console.error(chalk.red('Error: .skillcapsule not initialized.'));
      process.exit(1);
    }

    const runtime = new SkillCapsuleRuntime(configPath);
    console.log(chalk.blue(`Verifying atom: `) + chalk.bold(atomId));

    try {
      const atomPath = path.join(process.cwd(), `.skillcapsule/atoms/${atomId}.json`);
      if (!fs.existsSync(atomPath)) {
        throw new Error(`Atom definition not found: ${atomId}`);
      }
      const atom = fs.readJsonSync(atomPath);
      const postHooks = atom.hooks ? atom.hooks.filter(h => h.phase === 'after_action') : [];
      
      if (postHooks.length === 0) {
        console.log(chalk.yellow('No after_action hooks found for this atom.'));
        return;
      }

      const results = await runtime.runHooks(postHooks);
      
      console.log(chalk.bold.green('\n[Patch Receipt]'));
      let allPass = true;
      for (const [id, res] of Object.entries(results)) {
        console.log(`${id}: ${res.status === 'PASS' ? chalk.green('PASS') : chalk.red('FAIL')} (${res.output})`);
        if (res.status !== 'PASS') allPass = false;
      }

      if (allPass) {
        console.log(chalk.bold.green('\nVerification successful! Patch is safe to accept.'));
      } else {
        console.log(chalk.bold.red('\nVerification failed! Please address the issues above.'));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red('\nVerification failed:'), err.message);
      process.exit(1);
    }
  });

program
  .command('test')
  .description('Run routing and negative intent replay tests')
  .action(async () => {
    const configPath = path.join(process.cwd(), '.skillcapsule/skillcapsule.config.json');
    const runtime = new SkillCapsuleRuntime(configPath);
    console.log(chalk.blue('Running Replay Tests...\n'));

    const results = await runtime.runReplayTests();
    results.forEach(r => {
      const status = r.passed ? chalk.green('PASS') : chalk.red('FAIL');
      console.log(`${status} [${r.name}] (Matched: ${r.actual.join(', ') || 'none'})`);
    });

    if (results.some(r => !r.passed)) process.exit(1);
  });

program
  .command('patch:validate')
  .description('Validate a proposed atom patch')
  .argument('<patch-file>', 'Path to the patch JSON file')
  .action(async (patchFile) => {
    const configPath = path.join(process.cwd(), '.skillcapsule/skillcapsule.config.json');
    const runtime = new SkillCapsuleRuntime(configPath);
    console.log(chalk.blue(`Validating patch: `) + chalk.bold(patchFile));

    try {
      const result = await runtime.validatePatch(patchFile);
      if (result.status === 'PASS') {
        console.log(chalk.bold.green('\nPatch is valid and safe to apply.'));
      } else {
        console.log(chalk.bold.red('\nPatch validation FAILED:'));
        result.violations.forEach(v => console.log(`- ${v}`));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red('\nValidation error:'), err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
