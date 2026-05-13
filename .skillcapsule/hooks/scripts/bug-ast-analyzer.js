#!/usr/bin/env node

// Hook: bug.ast_analyzer
// Analyzes the AST of problematic code to extract patterns

const fs = require('fs');
const path = require('path');

// Simple pattern extraction for common bugs
function extractPattern(code) {
  const patterns = [];

  // Race condition in useEffect
  if (code.includes('useEffect') && code.includes('async') && !code.includes('return () =>')) {
    patterns.push({
      type: 'react_race_condition',
      description: 'useEffect with async operation missing cleanup',
      keywords: ['useEffect', 'async', 'cleanup'],
      ast_shape: 'CallExpression[callee.name="useEffect"][arguments.0.body.hasAsync]'
    });
  }

  // Missing dependency in useEffect
  if (code.includes('useEffect') && code.includes('state') && !code.includes('state]')) {
    patterns.push({
      type: 'react_dependency_missing',
      description: 'useEffect using state without dependency',
      keywords: ['useEffect', 'state', 'dependency'],
      ast_shape: 'CallExpression[callee.name="useEffect"][arguments.0.body.usesState]'
    });
  }

  return patterns;
}

function main() {
  const inputFile = process.argv[2] || '.skillcapsule/temp/bug_code.js';
  const code = fs.existsSync(inputFile) ? fs.readFileSync(inputFile, 'utf8') : process.env.CODE_SNIPPET || '';

  if (!code) {
    console.error('No code provided for analysis');
    process.exit(1);
  }

  const patterns = extractPattern(code);

  const output = {
    patterns,
    timestamp: new Date().toISOString(),
    analysis_type: 'ast_pattern_extraction'
  };

  console.log(JSON.stringify(output, null, 2));

  // Write to artifact
  const artifactPath = '.skillcapsule/artifacts/bug_patterns.json';
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, JSON.stringify(output, null, 2));
}

if (require.main === module) {
  main();
}