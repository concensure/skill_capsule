#!/usr/bin/env node

// Hook: fix.strategy_builder
// Generates correction strategies based on identified patterns

const fs = require('fs');
const path = require('path');

function generateStrategy(patterns) {
  const strategies = [];

  patterns.forEach(pattern => {
    switch (pattern.type) {
      case 'react_race_condition':
        strategies.push({
          type: 'add_cleanup_function',
          description: 'Add cleanup function to prevent race conditions',
          code_transform: `
useEffect(() => {
  let isMounted = true;

  const asyncOperation = async () => {
    try {
      const result = await someAsyncCall();
      if (isMounted) {
        setState(result);
      }
    } catch (error) {
      if (isMounted) {
        setError(error);
      }
    }
  };

  asyncOperation();

  return () => {
    isMounted = false;
  };
}, [dependencies]);
          `,
          keywords: ['useEffect', 'cleanup', 'isMounted']
        });
        break;

      case 'react_dependency_missing':
        strategies.push({
          type: 'add_dependency_array',
          description: 'Add missing dependencies to useEffect',
          code_transform: `
useEffect(() => {
  // effect logic
}, [state, otherDependency]);
          `,
          keywords: ['useEffect', 'dependency', 'array']
        });
        break;
    }
  });

  return strategies;
}

function main() {
  const patternsFile = '.skillcapsule/artifacts/bug_patterns.json';
  const patterns = fs.existsSync(patternsFile) ? JSON.parse(fs.readFileSync(patternsFile, 'utf8')).patterns : [];

  const strategies = generateStrategy(patterns);

  const output = {
    strategies,
    timestamp: new Date().toISOString(),
    generation_type: 'fix_strategy'
  };

  console.log(JSON.stringify(output, null, 2));

  // Write to artifact
  const artifactPath = '.skillcapsule/artifacts/fix_strategies.json';
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, JSON.stringify(output, null, 2));
}

if (require.main === module) {
  main();
}