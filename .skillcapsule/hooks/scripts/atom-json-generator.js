#!/usr/bin/env node

// Hook: atom.json_generator
// Creates new atom JSON from learned patterns and strategies

const fs = require('fs');
const path = require('path');

function generateAtom(patterns, strategies) {
  if (patterns.length === 0 || strategies.length === 0) {
    throw new Error('No patterns or strategies to generate atom from');
  }

  const primaryPattern = patterns[0];
  const primaryStrategy = strategies[0];

  // Generate atom ID based on pattern type
  const atomId = `auto.${primaryPattern.type.replace(/_/g, '.')}.fixer`;

  const atom = {
    id: atomId,
    version: "0.1.0",
    kind: "fixer",
    source: {
      file: "atoms/auto_generated.md",
      section_id: `${atomId.replace(/\./g, '-')}`
    },
    triggers: {
      keywords: [...new Set([...primaryPattern.keywords, ...primaryStrategy.keywords])],
      task_types: ["bug_fix", "code_improvement"],
      blocked_by_intents: ["no_auto_fix"]
    },
    activation: {
      risk_min: "low",
      auto_activate: false
    },
    autonomy_level: "level_2",
    activation_mode: "inspect",
    hooks: [
      {
        id: `hook.${atomId.replace(/\./g, '_')}`,
        phase: "before_action",
        kind: "fix",
        required: false,
        blocks_on_fail: false
      }
    ],
    status: "experimental",
    render: {
      S: `Auto-fix for ${primaryPattern.description}`,
      O: `Applying learned fix for ${primaryPattern.type}: ${primaryStrategy.description}`,
      X: `Generated fixer for ${primaryPattern.type}. Pattern: ${primaryPattern.ast_shape}. Strategy: ${primaryStrategy.type}. Code transform available.`
    },
    token_estimate: {
      S: 25,
      O: 50,
      X: 100
    }
  };

  return atom;
}

function main() {
  const patternsFile = '.skillcapsule/artifacts/bug_patterns.json';
  const strategiesFile = '.skillcapsule/artifacts/fix_strategies.json';

  const patterns = fs.existsSync(patternsFile) ? JSON.parse(fs.readFileSync(patternsFile, 'utf8')).patterns : [];
  const strategies = fs.existsSync(strategiesFile) ? JSON.parse(fs.readFileSync(strategiesFile, 'utf8')).strategies : [];

  const atom = generateAtom(patterns, strategies);

  console.log(JSON.stringify(atom, null, 2));

  // Write the atom file
  const atomPath = `.skillcapsule/atoms/${atom.id}.json`;
  fs.writeFileSync(atomPath, JSON.stringify(atom, null, 2));

  // Also write the strategy as a hook script
  const hookScriptPath = `.skillcapsule/hooks/scripts/${atom.hooks[0].id}.js`;
  const hookContent = `#!/usr/bin/env node

// Auto-generated hook for ${atom.id}
// Applies the learned fix

const fs = require('fs');

function applyFix(code) {
  // Simple string replacement for demo - in real implementation use AST transformation
  const strategy = ${JSON.stringify(strategies[0])};
  return code.replace(/useEffect\\(\\(\) => \{[^}]*\}, \\[\\]\\)/g, strategy.code_transform.trim());
}

function main() {
  const inputFile = process.argv[2] || 'src/component.js';
  let code = fs.readFileSync(inputFile, 'utf8');
  code = applyFix(code);
  fs.writeFileSync(inputFile, code);
  console.log('Fix applied to ' + inputFile);
}

if (require.main === module) {
  main();
}
`;

  fs.writeFileSync(hookScriptPath, hookContent);

  console.log(`Generated atom: ${atomPath}`);
  console.log(`Generated hook: ${hookScriptPath}`);
}

if (require.main === module) {
  main();
}