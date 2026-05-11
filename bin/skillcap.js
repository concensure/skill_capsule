#!/usr/bin/env node

const { Command } = require('commander');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

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
      context_budget: { default: 800, max: 1200 },
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

program.parse(process.argv);
