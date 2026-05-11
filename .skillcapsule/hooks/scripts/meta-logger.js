const fs = require('fs');
const path = require('path');

// Mock metadata of current activation
const activationData = {
    timestamp: new Date().toISOString(),
    task_id: process.env.SC_TASK_ID || 'unknown',
    activated_atoms: (process.env.SC_ACTIVATED_ATOMS || '').split(','),
    context: process.env.SC_CONTEXT || 'none'
};

const logPath = path.join(__dirname, '../../outcomes/activations.jsonl');

try {
    fs.appendFileSync(logPath, JSON.stringify(activationData) + '\n');
    console.log('PASS: Activation logged for meta-analysis.');
} catch (err) {
    console.error('FAIL: Could not log activation:', err.message);
}
