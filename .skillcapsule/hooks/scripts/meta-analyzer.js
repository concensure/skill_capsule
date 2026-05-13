#!/usr/bin/env node
'use strict';

const fs = require('fs-extra');
const path = require('path');

const projectRoot = process.cwd();
const skillcapsuleDir = path.join(projectRoot, '.skillcapsule');
const outcomesDir = path.join(skillcapsuleDir, 'outcomes');
const metricsPath = path.join(skillcapsuleDir, 'metrics', 'governance.json');
const pendingDir = path.join(skillcapsuleDir, 'patches', 'pending');
const atomsDir = path.join(skillcapsuleDir, 'atoms');

const MIN_SAMPLES = 10;
const FALSE_POSITIVE_THRESHOLD = 0.3;
const LOW_TOKEN_EFFICIENCY_THRESHOLD = 0.2;
const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

function loadOutcomes() {
  if (!fs.existsSync(outcomesDir)) return [];
  return fs.readdirSync(outcomesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => { try { return fs.readJsonSync(path.join(outcomesDir, f)); } catch { return null; } })
    .filter(Boolean);
}

function loadGovernance() {
  if (!fs.existsSync(metricsPath)) return null;
  try { return fs.readJsonSync(metricsPath); } catch { return null; }
}

function loadAtom(atomId) {
  const atomPath = path.join(atomsDir, `${atomId}.json`);
  if (!fs.existsSync(atomPath)) return null;
  try { return fs.readJsonSync(atomPath); } catch { return null; }
}

function writePatchProposal(proposal) {
  fs.ensureDirSync(pendingDir);
  const safeId = proposal.target_atom.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const filename = 'meta-' + safeId + '-' + Date.now() + '.json';
  const filePath = path.join(pendingDir, filename);
  fs.writeJsonSync(filePath, proposal, { spaces: 2 });
  return filePath;
}

function analyze() {
  const outcomes = loadOutcomes();
  const governance = loadGovernance();
  const proposed = [];

  if (outcomes.length < MIN_SAMPLES) {
    process.stdout.write(
      JSON.stringify({ status: 'skipped', reason: 'insufficient outcomes (' + outcomes.length + '/' + MIN_SAMPLES + ')', proposed: [] })
    );
    return;
  }

  const byAtom = {};
  for (const outcome of outcomes) {
    const atomId = outcome.atom_id;
    if (!atomId) continue;
    if (!byAtom[atomId]) byAtom[atomId] = [];
    byAtom[atomId].push(outcome);
  }

  for (const atomId of Object.keys(byAtom)) {
    const atomOutcomes = byAtom[atomId];
    if (atomOutcomes.length < MIN_SAMPLES) continue;
    const atom = loadAtom(atomId);
    if (!atom) continue;

    // Rule 1: systematic false positives -> propose tighten_activation
    const withDecision = atomOutcomes.filter(
      (o) => o.activation_accepted !== null && o.activation_accepted !== undefined
    );
    if (withDecision.length >= MIN_SAMPLES) {
      const falsePositiveRate =
        withDecision.filter((o) => o.activation_accepted === false).length / withDecision.length;
      if (falsePositiveRate >= FALSE_POSITIVE_THRESHOLD) {
        const currentRisk = (atom.activation && atom.activation.risk_min) ? atom.activation.risk_min : 'low';
        const currentIdx = RISK_LEVELS.indexOf(currentRisk);
        const proposedRisk = RISK_LEVELS[currentIdx + 1];
        if (proposedRisk) {
          const filePath = writePatchProposal({
            target_atom: atomId,
            base_version: atom.version,
            ops: [{ op: 'tighten_activation', field: 'activation.risk_min', value: proposedRisk }],
            _evidence: {
              rule: 'false_positive_rate',
              false_positive_rate: parseFloat(falsePositiveRate.toFixed(3)),
              sample_count: withDecision.length,
              proposed_by: 'hook.meta.analyze_patterns',
            },
          });
          proposed.push({ atom: atomId, rule: 'tighten_activation', file: path.basename(filePath) });
        }
      }
    }

    // Rule 2: token-heavy with low efficiency -> flag for human review via append_evidence
    const metrics = governance && governance.atoms
      ? governance.atoms.find(function(m) { return m.atom_id === atomId; })
      : null;
    if (
      metrics &&
      metrics.token_efficiency !== null &&
      metrics.token_efficiency < LOW_TOKEN_EFFICIENCY_THRESHOLD &&
      metrics.sample_count >= MIN_SAMPLES
    ) {
      const filePath = writePatchProposal({
        target_atom: atomId,
        base_version: atom.version,
        ops: [{
          op: 'append_evidence',
          value: 'token_efficiency=' + metrics.token_efficiency.toFixed(2) + ' below threshold (' + LOW_TOKEN_EFFICIENCY_THRESHOLD + '); review render cards for verbosity',
        }],
        _evidence: {
          rule: 'low_token_efficiency',
          token_efficiency: metrics.token_efficiency,
          sample_count: metrics.sample_count,
          proposed_by: 'hook.meta.analyze_patterns',
        },
      });
      proposed.push({ atom: atomId, rule: 'append_evidence', file: path.basename(filePath) });
    }
  }

  process.stdout.write(
    JSON.stringify({ status: 'ok', outcomes_analyzed: outcomes.length, proposed: proposed })
  );
}

analyze();
