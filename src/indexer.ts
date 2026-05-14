import * as fs from 'fs';
import * as path from 'path';
import {
  ActivationMode,
  AtomRoutingSummary,
  AtomDefinition,
  CapsuleRoutingSummary,
  CapsuleDefinition,
  CIFEntry,
  RoutingManifest,
  TokenEfficiencyReport,
  TokenEfficiencyViolation,
  ValidationViolation,
} from './types';
import {
  buildCapabilityIdIndex,
  buildSwappableGroupIndex,
  classifyCapabilityLevel,
  parseAtomDefinition,
  parseCapsuleDefinition,
  resolveCapabilityId,
  validateAllAtoms,
} from './validators';

/**
 * CIF (Compiled Intent Fingerprint) generator for Skill Capsule.
 * Generates a compact capability routing artifact from atom trigger metadata.
 */

export interface IndexerOptions {
  atomsDir: string;
  capsulesDir: string;
  outputDir: string;
  validateContracts?: boolean;
}

export interface LoadedAtomsResult {
  atoms: AtomDefinition[];
  violations: ValidationViolation[];
}

export interface IndexerGenerateResult {
  cifMarkdown: string;
  routingManifest: RoutingManifest;
  validationReport: string;
  errorCount: number;
  warningCount: number;
  tokenEfficiency: TokenEfficiencyReport;
}

// T12 thresholds
const MAX_CONTRACT_BYTES = 2_048;
const MAX_EVIDENCE_ITEMS = 10;
const MAX_COMPATIBILITY_ITEMS = 20;

export class SkillCapsuleIndexer {
  private readonly atomsDir: string;
  private readonly capsulesDir: string;
  private readonly outputDir: string;
  private readonly validateContracts: boolean;

  constructor(options: IndexerOptions) {
    this.atomsDir = options.atomsDir;
    this.capsulesDir = options.capsulesDir;
    this.outputDir = options.outputDir;
    this.validateContracts = options.validateContracts ?? true;
  }

  loadAtoms(): LoadedAtomsResult {
    const atoms: AtomDefinition[] = [];
    const violations: ValidationViolation[] = [];
    const files = fs
      .readdirSync(this.atomsDir)
      .filter((file) => file.endsWith('.json'))
      .sort((left, right) => left.localeCompare(right));

    for (const file of files) {
      const fullPath = path.join(this.atomsDir, file);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const raw = JSON.parse(content) as unknown;
        const parsed = parseAtomDefinition(raw, file);
        if (parsed.atom) {
          atoms.push(parsed.atom);
        }
        violations.push(...parsed.violations);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        violations.push({
          atom_id: file,
          rule: 'ATOM_FILE_UNREADABLE',
          severity: 'error',
          message,
          remediation: 'Fix the JSON file so it can be parsed and validated.',
        });
      }
    }

    return { atoms, violations };
  }

  loadCapsules(): CapsuleDefinition[] {
    const capsules: CapsuleDefinition[] = [];
    if (!fs.existsSync(this.capsulesDir)) {
      return capsules;
    }

    const files = fs
      .readdirSync(this.capsulesDir)
      .filter((file) => file.endsWith('.json'))
      .sort((left, right) => left.localeCompare(right));

    for (const file of files) {
      const fullPath = path.join(this.capsulesDir, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      try {
        const parsed = parseCapsuleDefinition(JSON.parse(content), file);
        if (parsed.capsule) {
          capsules.push(parsed.capsule);
        }
      } catch {
        // Capsule loading is best-effort for index summaries; atom contract validation remains authoritative.
      }
    }

    return capsules;
  }

  generateCIFEntries(atoms: AtomDefinition[]): CIFEntry[] {
    const entriesBySignature = new Map<string, CIFEntry>();
    const swappableIndex = buildSwappableGroupIndex(atoms);

    for (const atom of atoms) {
      const intentTerms = Array.from(new Set(atom.triggers.keywords ?? [])).sort((a, b) => a.localeCompare(b));
      if (intentTerms.length === 0) {
        continue;
      }

      const capabilityId = resolveCapabilityId(atom);
      if (!capabilityId) {
        continue;
      }

      const risk = atom.locs_capsule?.risk_level ?? 'low';
      const mode = (atom.activation_mode ?? 'activate') as ActivationMode;
      const swappableAtomGroup = atom.locs_capsule?.swappable_atom_group;
      const compatibleAtoms = swappableAtomGroup
        ? swappableIndex.get(swappableAtomGroup) ?? [atom.id]
        : [atom.id];
      const signature = [
        intentTerms.join('|'),
        capabilityId,
        risk,
        swappableAtomGroup ?? '',
        mode,
      ].join('::');

      const existing = entriesBySignature.get(signature);
      if (existing) {
        existing.compatible_atoms = Array.from(new Set([...existing.compatible_atoms, ...compatibleAtoms])).sort();
        continue;
      }

      entriesBySignature.set(signature, {
        intent_terms: intentTerms,
        capability_id: capabilityId,
        risk,
        swappable_atom_group: swappableAtomGroup,
        mode,
        compatible_atoms: Array.from(new Set(compatibleAtoms)).sort(),
      });
    }

    return Array.from(entriesBySignature.values()).sort((left, right) => {
      const leftKey = `${left.intent_terms.join('|')}::${left.capability_id}::${left.mode}`;
      const rightKey = `${right.intent_terms.join('|')}::${right.capability_id}::${right.mode}`;
      return leftKey.localeCompare(rightKey);
    });
  }

  formatCIFMarkdown(entries: CIFEntry[]): string {
    const lines = [
      '<!-- generated: true -->',
      '<!-- source: atoms/*.json capsules/*.json -->',
      '<!-- do-not-edit: true -->',
      '',
      'intent_terms -> capability_id | risk | group | mode | atoms',
      '',
    ];

    for (const entry of entries) {
      lines.push(
        [
          entry.intent_terms.join('|') || '(empty)',
          '->',
          entry.capability_id,
          `| risk:${entry.risk}`,
          `| group:${entry.swappable_atom_group ?? 'none'}`,
          `| mode:${entry.mode}`,
          `| atoms:${entry.compatible_atoms.join(',')}`,
        ].join(' '),
      );
    }

    return `${lines.join('\n')}\n`;
  }

  buildRoutingManifest(atoms: AtomDefinition[], capsules: CapsuleDefinition[]): RoutingManifest {
    const atomSummaries: AtomRoutingSummary[] = atoms
      .map((atom) => ({
        id: atom.id,
        file: `${atom.id}.json`,
        version: atom.version,
        capability_level: classifyCapabilityLevel(atom),
        capability_id: resolveCapabilityId(atom),
        triggers: atom.triggers,
        activation: atom.activation,
        dependencies: atom.dependencies ?? [],
        conflicts: atom.conflicts ?? [],
        activation_mode: atom.activation_mode,
        locs_capsule: atom.locs_capsule,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));

    const capsuleSummaries: CapsuleRoutingSummary[] = capsules
      .map((capsule) => ({
        id: capsule.id,
        version: capsule.version,
        type: capsule.type,
        atoms: [...capsule.atoms].sort((left, right) => left.localeCompare(right)),
        default_budget: capsule.default_budget,
        status: capsule.status,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));

    return {
      version: '1.0',
      generated_at: new Date().toISOString(),
      atoms: atomSummaries,
      capsules: capsuleSummaries,
    };
  }

  generateContractValidationReport(
    schemaViolations: ValidationViolation[],
    atoms: AtomDefinition[],
  ): { report: string; errorCount: number; warningCount: number } {
    if (!this.validateContracts && schemaViolations.length === 0) {
      return { report: '', errorCount: 0, warningCount: 0 };
    }

    const contractResults = this.validateContracts ? validateAllAtoms(atoms) : [];
    const violations = [
      ...schemaViolations,
      ...contractResults.flatMap((result) => result.violations),
    ];
    const warnings = contractResults.flatMap((result) => result.warnings);

    if (violations.length === 0 && warnings.length === 0) {
      return {
        report: '<!-- contract validation: PASS -->\n',
        errorCount: 0,
        warningCount: 0,
      };
    }

    const lines = ['<!-- contract validation report -->'];
    if (violations.length > 0) {
      lines.push(`<!-- CRITICAL: ${violations.length} violation(s) -->`);
      for (const violation of violations.slice(0, 20)) {
        lines.push(`<!-- [${violation.atom_id}] ${violation.rule}: ${violation.message} -->`);
      }
      if (violations.length > 20) {
        lines.push(`<!-- ... and ${violations.length - 20} more violation(s) -->`);
      }
    }

    if (warnings.length > 0) {
      lines.push(`<!-- WARNING: ${warnings.length} warning(s) -->`);
      for (const warning of warnings.slice(0, 10)) {
        lines.push(`<!-- [${warning.atom_id}] ${warning.rule}: ${warning.message} -->`);
      }
      if (warnings.length > 10) {
        lines.push(`<!-- ... and ${warnings.length - 10} more warning(s) -->`);
      }
    }

    lines.push('');
    return {
      report: `${lines.join('\n')}\n`,
      errorCount: violations.length,
      warningCount: warnings.length,
    };
  }

  // T12: token-efficiency discipline checks
  checkTokenEfficiency(atoms: AtomDefinition[]): TokenEfficiencyReport {
    const violations: TokenEfficiencyViolation[] = [];
    const warnings: TokenEfficiencyViolation[] = [];
    let totalContractBytes = 0;
    const oversizedAtoms: string[] = [];

    for (const atom of atoms) {
      if (!atom.locs_capsule) continue;

      // Check 1: oversized locs_capsule contract payload
      const contractJson = JSON.stringify(atom.locs_capsule);
      const contractBytes = Buffer.byteLength(contractJson, 'utf-8');
      totalContractBytes += contractBytes;

      if (contractBytes > MAX_CONTRACT_BYTES) {
        oversizedAtoms.push(atom.id);
        warnings.push({
          atom_id: atom.id,
          check: 'OVERSIZED_CONTRACT_PAYLOAD',
          severity: 'warning',
          message:
            `locs_capsule payload is ${contractBytes} bytes (limit: ${MAX_CONTRACT_BYTES}). ` +
            `Trim success_evidence, compatibility, or capability_summary to reduce token cost.`,
        });
      }

      // Check 2: too many success_evidence items
      const evidenceCount = atom.locs_capsule.success_evidence.length;
      if (evidenceCount > MAX_EVIDENCE_ITEMS) {
        warnings.push({
          atom_id: atom.id,
          check: 'TOO_MANY_EVIDENCE_ITEMS',
          severity: 'warning',
          message:
            `success_evidence has ${evidenceCount} items (limit: ${MAX_EVIDENCE_ITEMS}). ` +
            `Consolidate evidence items to reduce per-atom token overhead.`,
        });
      }

      // Check 3: oversized compatibility list
      const compatibilityCount = atom.locs_capsule.compatibility.length;
      if (compatibilityCount > MAX_COMPATIBILITY_ITEMS) {
        warnings.push({
          atom_id: atom.id,
          check: 'COMPATIBILITY_BLOAT',
          severity: 'warning',
          message:
            `compatibility list has ${compatibilityCount} items (limit: ${MAX_COMPATIBILITY_ITEMS}). ` +
            `Use capability grouping instead of enumerating every compatible atom.`,
        });
      }

      // Check 4: temporal_scope declared without temporal_tracking enabled
      if (
        atom.locs_capsule.temporal_scope &&
        atom.locs_capsule.temporal_scope.length > 0 &&
        !atom.locs_capsule.temporal_tracking
      ) {
        violations.push({
          atom_id: atom.id,
          check: 'TEMPORAL_SCOPE_WITHOUT_TRACKING',
          severity: 'error',
          message:
            `temporal_scope is declared but temporal_tracking is not true. ` +
            `Set temporal_tracking: true or remove temporal_scope to avoid misleading routing.`,
        });
      }

      // Check 5: duplicate capability_id (top-level vs locs_capsule diverge)
      if (
        atom.capability_id &&
        atom.locs_capsule.capability_id &&
        atom.capability_id !== atom.locs_capsule.capability_id
      ) {
        violations.push({
          atom_id: atom.id,
          check: 'DUPLICATE_METADATA_FIELD',
          severity: 'error',
          message:
            `Top-level capability_id ("${atom.capability_id}") diverges from ` +
            `locs_capsule.capability_id ("${atom.locs_capsule.capability_id}"). ` +
            `Remove the top-level field — locs_capsule is the authoritative source.`,
        });
      }
    }

    return {
      checked_at: new Date().toISOString(),
      atom_count: atoms.length,
      violations,
      warnings,
      total_contract_bytes: totalContractBytes,
      oversized_atoms: oversizedAtoms,
    };
  }

  generate(): IndexerGenerateResult {
    const { atoms, violations: schemaViolations } = this.loadAtoms();
    const capsules = this.loadCapsules();
    const entries = this.generateCIFEntries(atoms);
    const cifMarkdown = this.formatCIFMarkdown(entries);
    const routingManifest = this.buildRoutingManifest(atoms, capsules);
    const validation = this.generateContractValidationReport(schemaViolations, atoms);
    const tokenEfficiency = this.checkTokenEfficiency(atoms);

    return {
      cifMarkdown,
      routingManifest,
      validationReport: validation.report,
      errorCount: validation.errorCount + tokenEfficiency.violations.length,
      warningCount: validation.warningCount + tokenEfficiency.warnings.length,
      tokenEfficiency,
    };
  }

  writeCIFMarkdown(markdown: string): void {
    const outputPath = path.join(this.outputDir, 'CIF.md');
    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.writeFileSync(outputPath, markdown, 'utf-8');
  }

  writeRoutingManifest(manifest: RoutingManifest): void {
    const outputPath = path.join(this.outputDir, 'routing.manifest.json');
    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  }

  writeTokenEfficiencyReport(report: TokenEfficiencyReport): void {
    const metricsDir = path.join(this.outputDir, 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    const outputPath = path.join(metricsDir, 'token_efficiency.json');
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  }

  buildFullIndex(): string {
    const { atoms } = this.loadAtoms();
    const { cifMarkdown, routingManifest, validationReport, errorCount, warningCount } = this.generate();
    this.writeCIFMarkdown(validationReport + cifMarkdown);
    this.writeRoutingManifest(routingManifest);

    const capabilityIndex = buildCapabilityIdIndex(atoms);
    return [
      `Generated: ${new Date().toISOString()}`,
      `Atoms: ${atoms.length}`,
      `Capabilities: ${capabilityIndex.size}`,
      `Contract Errors: ${errorCount}`,
      `Contract Warnings: ${warningCount}`,
      '',
    ].join('\n');
  }
}

export function indexSkillCapsule(
  atomsDir: string,
  capsulesDir: string,
  outputDir: string,
  validateContracts = true,
): { success: boolean; errors: string[]; warnings: string[] } {
  try {
    const indexer = new SkillCapsuleIndexer({
      atomsDir,
      capsulesDir,
      outputDir,
      validateContracts,
    });

    const result = indexer.generate();
    indexer.writeCIFMarkdown(result.validationReport + result.cifMarkdown);
    indexer.writeRoutingManifest(result.routingManifest);
    indexer.writeTokenEfficiencyReport(result.tokenEfficiency);

    const errors: string[] = [];
    const warnings: string[] = [];

    // Contract errors
    if (result.errorCount > 0) {
      errors.push(
        `Indexing completed with ${result.errorCount} contract/token-efficiency error(s).`,
        'Review violations in generated .skillcapsule/CIF.md and metrics/token_efficiency.json.',
      );
    }

    // Token-efficiency errors (TEMPORAL_SCOPE_WITHOUT_TRACKING, DUPLICATE_METADATA_FIELD)
    for (const v of result.tokenEfficiency.violations) {
      errors.push(`[${v.atom_id}] ${v.check}: ${v.message}`);
    }

    // Token-efficiency warnings
    for (const w of result.tokenEfficiency.warnings) {
      warnings.push(`[${w.atom_id}] ${w.check}: ${w.message}`);
    }

    // Generic warning count line
    if (result.warningCount > 0 && warnings.length === 0) {
      warnings.push(`Indexing completed with ${result.warningCount} warning(s).`);
    }

    return { success: errors.length === 0, errors, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, errors: [message], warnings: [] };
  }
}
