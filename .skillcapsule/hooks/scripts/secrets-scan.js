const fs = require('fs');
const path = require('path');

// Simple secret scanning script
const SECRET_PATTERNS = [
    /sk-[a-zA-Z0-9]{48}/, // OpenAI
    /AIza[0-9A-Za-z-_]{35}/, // Google Cloud
    /ghp_[a-zA-Z0-9]{36}/, // GitHub PAT
    /xox[baprs]-[0-9]{12}-[0-9]{12}-[a-zA-Z0-9]{24}/ // Slack
];

function scanDir(dir) {
    let findings = [];
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git') {
                findings = findings.concat(scanDir(fullPath));
            }
        } else {
            const content = fs.readFileSync(fullPath, 'utf8');
            SECRET_PATTERNS.forEach(pattern => {
                if (pattern.test(content)) {
                    findings.push(`${fullPath}: Potential secret detected.`);
                }
            });
        }
    }
    return findings;
}

try {
    const findings = scanDir(process.cwd());
    if (findings.length > 0) {
        console.log('FAIL: Secrets detected!');
        findings.forEach(f => console.log(`- ${f}`));
        process.exit(1);
    } else {
        console.log('PASS: No secrets detected.');
    }
} catch (err) {
    console.error('ERROR: Secret scan failed:', err.message);
    process.exit(1);
}
