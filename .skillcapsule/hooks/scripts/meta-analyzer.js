const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '../../outcomes/activations.jsonl');

try {
    if (!fs.existsSync(logPath)) {
        console.log('INFO: No usage data yet.');
        process.exit(0);
    }

    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    const logs = lines.map(l => JSON.parse(l));

    // Gated Promotion Criteria
    const PROMOTION_MIN_COUNT = 10;
    const PROMOTION_MIN_DAYS = 3;

    const coOccurrences = {};
    const firstSeen = {};
    const lastSeen = {};
    const dates = new Set();

    logs.forEach(log => {
        const date = log.timestamp.split('T')[0];
        dates.add(date);
        const atoms = log.activated_atoms.filter(a => a && a !== 'meta.monitor.usage');
        for (let i = 0; i < atoms.length; i++) {
            for (let j = i + 1; j < atoms.length; j++) {
                const pair = [atoms[i], atoms[j]].sort().join(' + ');
                coOccurrences[pair] = (coOccurrences[pair] || 0) + 1;
                if (!firstSeen[pair]) firstSeen[pair] = date;
                lastSeen[pair] = date;
            }
        }
    });

    const suggestions = Object.entries(coOccurrences)
        .filter(([pair, count]) => {
            const daysActive = (new Date(lastSeen[pair]) - new Date(firstSeen[pair])) / (1000 * 60 * 60 * 24) + 1;
            return count >= PROMOTION_MIN_COUNT && daysActive >= PROMOTION_MIN_DAYS;
        })
        .map(([pair, count]) => `${pair} (Count: ${count}, Days: ${Math.round((new Date(lastSeen[pair]) - new Date(firstSeen[pair])) / (1000 * 60 * 60 * 24) + 1)})`);

    if (suggestions.length > 0) {
        console.log('CANDIDATE: Gated promotion criteria met for:');
        suggestions.forEach(s => console.log(`- ${s}`));
        console.log('\nAction: Initiate replay test and promote to "Experimental" status.');
    } else {
        console.log('INFO: Evidence collection in progress. No candidates meet gated promotion criteria (min 10 pairs across 3 days).');
    }
} catch (err) {
    console.error('FAIL: Pattern analysis failed:', err.message);
}
