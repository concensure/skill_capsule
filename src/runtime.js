const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

class SkillCapsuleRuntime {
    constructor(configPath) {
        this.config = fs.readJsonSync(configPath);
        this.baseDir = path.dirname(configPath);
        this.atomsDir = path.join(this.baseDir, 'atoms');
        this.capsulesDir = path.join(this.baseDir, 'capsules');
        this.hooksRegistryPath = path.join(this.baseDir, 'hooks/hooks.registry.json');
    }

    async compose(taskDescription, budget) {
        const classification = this.classifyTask(taskDescription);
        const matchedAtoms = this.matchAtoms(classification);
        const resolvedAtoms = this.resolveDependencies(matchedAtoms);
        const hookPlan = this.planHooks(resolvedAtoms);
        
        // Run before_render hooks
        const hookResults = await this.runHooks(hookPlan.filter(h => h.phase === 'before_render'));

        const compiledCapsule = this.compile(resolvedAtoms, hookResults, budget || this.config.context_budget.default, classification);
        
        return {
            classification,
            atoms: resolvedAtoms.map(a => a.id),
            hookResults,
            compiledCapsule,
            receipt: this.generateReceipt(resolvedAtoms, hookResults, classification)
        };
    }

    classifyTask(desc) {
        const text = desc.toLowerCase();
        let taskType = 'general';
        let risk = 'low';
        let intents = [];

        if (text.includes('edit') || text.includes('fix') || text.includes('change')) {
            taskType = 'coding';
            risk = 'medium';
        }
        if (text.includes('refactor') || text.includes('restructure')) {
            taskType = 'refactor';
            risk = 'high';
        }
        if (text.includes('github') || text.includes('push') || text.includes('publish')) {
            taskType = 'publish';
            risk = 'high';
        }

        // Negative intent detection
        if (text.includes('do not push') || text.includes('dont push') || text.includes('no push')) intents.push('no_push');
        if (text.includes('no safety') || text.includes('skip checks')) intents.push('no_safety_checks');

        return { taskType, risk, intents, raw: desc };
    }

    matchAtoms(classification) {
        const allAtoms = fs.readdirSync(this.atomsDir)
            .filter(f => f.endsWith('.json'))
            .map(f => fs.readJsonSync(path.join(this.atomsDir, f)));

        return allAtoms.filter(atom => {
            // Check keyword triggers
            const hasKeyword = atom.triggers.keywords.some(k => classification.raw.toLowerCase().includes(k.toLowerCase()));
            const hasTaskType = atom.triggers.task_types && atom.triggers.task_types.includes(classification.taskType);
            
            // Intent blocking
            const isBlocked = atom.triggers.blocked_by_intents && atom.triggers.blocked_by_intents.some(i => classification.intents.includes(i));

            return (hasKeyword || hasTaskType || atom.triggers.auto_activate) && !isBlocked;
        });
    }

    resolveDependencies(atoms) {
        // Simple deduplication for now
        const seen = new Set();
        return atoms.filter(a => {
            if (seen.has(a.id)) return false;
            seen.add(a.id);
            return true;
        });
    }

    planHooks(atoms) {
        const hooks = [];
        atoms.forEach(atom => {
            if (atom.hooks) {
                atom.hooks.forEach(h => hooks.push({ ...h, atomId: atom.id }));
            }
        });
        // Deduplicate hooks by ID
        const uniqueHooks = [];
        const seenHooks = new Set();
        hooks.forEach(h => {
            if (!seenHooks.has(h.id)) {
                uniqueHooks.push(h);
                seenHooks.add(h.id);
            }
        });
        return uniqueHooks;
    }

    async runHooks(hookPlan) {
        const registry = fs.readJsonSync(this.hooksRegistryPath);
        const results = {};

        for (const planItem of hookPlan) {
            const hookDef = registry.hooks.find(h => h.id === planItem.id);
            if (!hookDef) continue;

            try {
                console.log(`Running hook: ${hookDef.id}...`);
                // Simple exec for now, real sandboxing would go here
                const output = execSync(hookDef.command, { timeout: hookDef.timeout_ms }).toString().trim();
                results[hookDef.id] = { status: 'PASS', output: output.substring(0, hookDef.summary.max_tokens) };
            } catch (err) {
                results[hookDef.id] = { status: 'FAIL', output: err.message };
                if (planItem.blocks_on_fail) break; 
            }
        }
        return results;
    }

    compile(atoms, hookResults, budget, classification) {
        let capsuleText = `[Skill Capsule: ${classification.taskType}]\n\n`;
        
        // Budget management
        const reserved = budget * (this.config.context_budget.mandatory_budget_reserved[classification.risk] || 0.35);
        let remaining = budget - reserved;

        atoms.forEach(atom => {
            const renderLevel = remaining > 200 ? 'O' : 'S';
            capsuleText += `Atom: ${atom.id}\n${atom.render[renderLevel]}\n\n`;
            remaining -= atom.token_estimate[renderLevel];
        });

        capsuleText += `Verifier Results:\n`;
        for (const [id, res] of Object.entries(hookResults)) {
            capsuleText += `- ${id}: ${res.status} (${res.output})\n`;
        }

        return capsuleText;
    }

    generateReceipt(atoms, hookResults, classification) {
        return `[Activation Receipt]\n` +
               `Task: ${classification.taskType} (${classification.risk})\n` +
               `Atoms: ${atoms.map(a => a.id).join(', ')}\n` +
               `Hooks: ${Object.keys(hookResults).join(', ')}\n` +
               `Intents: ${classification.intents.join(', ') || 'none'}`;
    }
}

module.exports = SkillCapsuleRuntime;
