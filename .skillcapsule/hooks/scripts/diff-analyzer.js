const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const checkScope = args.includes('--check-scope');
const analyzeRisk = args.includes('--analyze-risk');
const checkPublicApi = args.includes('--check-public-api');

function getDiffFiles() {
    try {
        const output = execSync('git diff --name-only').toString().trim();
        return output ? output.split('\n') : [];
    } catch (err) {
        console.error('ERROR: Could not get git diff:', err.message);
        return [];
    }
}

function getDiffStats() {
    try {
        const output = execSync('git diff --stat').toString().trim();
        return output;
    } catch (err) {
        return 'Could not retrieve diff stats.';
    }
}

const allowedPaths = (process.env.SC_ALLOWED_PATHS || '*').split(',').map(p => p.trim());
const readonlyPaths = (process.env.SC_READONLY_PATHS || '').split(',').map(p => p.trim());

const changedFiles = getDiffFiles();

if (changedFiles.length === 0) {
    console.log('PASS: No files changed.');
    process.exit(0);
}

let violations = [];
let riskFindings = [];

// 1. Scope Check
if (checkScope) {
    changedFiles.forEach(file => {
        const isAllowed = allowedPaths.some(pattern => {
            if (pattern === '*') return true;
            return file.startsWith(pattern.replace('/**', ''));
        });
        if (!isAllowed) {
            violations.push(`${file}: Outside of allowed edit scope.`);
        }
        const isReadonly = readonlyPaths.some(pattern => {
            if (!pattern) return false;
            return file.startsWith(pattern.replace('/**', ''));
        });
        if (isReadonly) {
            violations.push(`${file}: Attempted to edit a readonly file.`);
        }
    });
}

// 2. Risk Analysis
if (analyzeRisk) {
    riskFindings.push(`Files changed: ${changedFiles.length}`);
    riskFindings.push(`Diff stats:\n${getDiffStats()}`);
    
    // Heuristic: Check for many lines changed in a single file
    try {
        const lineChanges = execSync('git diff --shortstat').toString().trim();
        riskFindings.push(`Complexity: ${lineChanges}`);
    } catch (e) {}
}

// 3. Public API Change Detector (Mock for demonstration)
if (checkPublicApi) {
    const publicFiles = changedFiles.filter(f => f.includes('public/') || f.endsWith('.d.ts') || f.includes('api/'));
    if (publicFiles.length > 0) {
        console.log('WARNING: Potential public API changes detected in:');
        publicFiles.forEach(f => console.log(`- ${f}`));
    } else {
        console.log('PASS: No public API changes detected.');
    }
}

if (violations.length > 0) {
    console.log('FAIL: Edit scope violations detected!');
    violations.forEach(v => console.log(`- ${v}`));
    process.exit(1);
}

if (analyzeRisk && riskFindings.length > 0) {
    console.log('REVIEW: Diff Risk Analysis:');
    riskFindings.forEach(f => console.log(`- ${f}`));
}

if (!checkPublicApi && !analyzeRisk && !checkScope) {
    console.log('PASS: Edit verified.');
}
