import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  SkillCapsuleConfig,
  TimeTraceComparisonStats,
  TimeTraceEventRecord,
} from './types';

export interface TemporalClientResolution {
  workspacePath: string;
  warnings: string[];
  file: string;
  args: string[];
  cwd: string;
  windowsVerbatimArguments?: boolean;
}

function quoteWindowsArg(value: string): string {
  if (!/[\s"]/u.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

export class TemporalClient {
  private readonly projectRoot: string;
  private readonly config: SkillCapsuleConfig;

  constructor(projectRoot: string, config: SkillCapsuleConfig) {
    this.projectRoot = path.resolve(projectRoot);
    this.config = config;
  }

  resolve(): TemporalClientResolution {
    const temporal = this.config.temporal;
    if (temporal?.enabled === false) {
      throw new Error('TimeTrace integration is disabled in skillcapsule.config.json.');
    }
    if (temporal?.provider && temporal.provider !== 'timetrace') {
      throw new Error(`Unsupported temporal provider: ${temporal.provider}`);
    }

    const workspacePath = path.resolve(
      this.projectRoot,
      temporal?.workspace_dir ?? '.timetrace',
    );
    if (!fs.existsSync(workspacePath)) {
      throw new Error(
        `TimeTrace workspace not found: ${workspacePath}. Run "tt init --workspace ${workspacePath}" first.`,
      );
    }

    const { file, args, cwd, warnings, windowsVerbatimArguments } = this.resolveCommand();
    return {
      workspacePath,
      warnings,
      file,
      args,
      cwd,
      windowsVerbatimArguments,
    };
  }

  getCapabilityHistory(capabilityId: string): {
    workspacePath: string;
    warnings: string[];
    events: TimeTraceEventRecord[];
  } {
    const resolution = this.resolve();
    const events = this.executeJson<TimeTraceEventRecord[]>(
      resolution,
      ['history', '--capability-id', capabilityId, '--format', 'json'],
    );
    return {
      workspacePath: resolution.workspacePath,
      warnings: resolution.warnings,
      events: Array.isArray(events) ? events : [],
    };
  }

  getCapabilityComparison(capabilityId: string): {
    workspacePath: string;
    warnings: string[];
    stats: TimeTraceComparisonStats;
  } {
    const resolution = this.resolve();
    const stats = this.executeJson<TimeTraceComparisonStats>(
      resolution,
      ['compare', '--capability-id', capabilityId, '--format', 'json'],
    );
    return {
      workspacePath: resolution.workspacePath,
      warnings: resolution.warnings,
      stats,
    };
  }

  recordSelectionEvent(
    capabilityId: string,
    context?: string,
    score?: number,
  ): {
    workspacePath: string;
    warnings: string[];
  } {
    const resolution = this.resolve();
    const commandArgs = ['record', 'selection', '--capability-id', capabilityId];
    if (context) {
      commandArgs.push('--context', context);
    }
    if (typeof score === 'number' && Number.isFinite(score)) {
      commandArgs.push('--score', score.toFixed(3));
    }
    this.executeCommand(resolution, commandArgs);
    return {
      workspacePath: resolution.workspacePath,
      warnings: resolution.warnings,
    };
  }

  recordAuditReceipt(
    capabilityId: string,
    outcome: string,
    summary?: string,
  ): {
    workspacePath: string;
    warnings: string[];
  } {
    const resolution = this.resolve();
    const commandArgs = ['record', 'audit', '--capability-id', capabilityId, '--outcome', outcome];
    if (summary) {
      commandArgs.push('--summary', summary);
    }
    this.executeCommand(resolution, commandArgs);
    return {
      workspacePath: resolution.workspacePath,
      warnings: resolution.warnings,
    };
  }

  private resolveCommand(): {
    file: string;
    args: string[];
    cwd: string;
    warnings: string[];
    windowsVerbatimArguments?: boolean;
  } {
    const temporal = this.config.temporal;
    const warnings: string[] = [];
    const binaryArgs = [...(temporal?.binary_args ?? [])];
    const configuredBinary = temporal?.binary
      ? path.resolve(this.projectRoot, temporal.binary)
      : undefined;
    const inferredProjectDir = path.resolve(
      this.projectRoot,
      temporal?.project_dir ?? '..\\TimeTrace',
    );
    const inferredBinary = process.platform === 'win32'
      ? path.join(inferredProjectDir, 'target', 'debug', 'tt.exe')
      : path.join(inferredProjectDir, 'target', 'debug', 'tt');

    const binaryPath = configuredBinary && fs.existsSync(configuredBinary)
      ? configuredBinary
      : fs.existsSync(inferredBinary)
        ? inferredBinary
        : undefined;

    if (configuredBinary && !fs.existsSync(configuredBinary)) {
      warnings.push(`Configured TimeTrace binary not found: ${configuredBinary}`);
    }

    if (binaryPath) {
      return {
        file: binaryPath,
        args: binaryArgs,
        cwd: this.projectRoot,
        warnings,
      };
    }

    if (temporal?.allow_cargo_run) {
      if (!fs.existsSync(inferredProjectDir) || !fs.existsSync(path.join(inferredProjectDir, 'Cargo.toml'))) {
        throw new Error(
          `TimeTrace project directory not found: ${inferredProjectDir}. Configure temporal.project_dir or build tt explicitly.`,
        );
      }
      warnings.push('Using cargo-run fallback for TimeTrace because no built tt binary was found.');
      return {
        file: 'cargo',
        args: ['run', '-q', '-p', 'tt-cli', '--'],
        cwd: inferredProjectDir,
        warnings,
      };
    }

    throw new Error(
      `TimeTrace binary not found. Expected ${configuredBinary ?? inferredBinary}. Build TimeTrace first or configure temporal.binary.`,
    );
  }

  private buildSpawnSpec(
    resolution: TemporalClientResolution & {
      file: string;
      args: string[];
      cwd: string;
      windowsVerbatimArguments?: boolean;
    },
    commandArgs: string[],
  ): {
    file: string;
    args: string[];
    windowsVerbatimArguments?: boolean;
  } {
    const finalArgs = [
      ...resolution.args,
      '--workspace',
      resolution.workspacePath,
      ...commandArgs,
    ];

    return process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolution.file)
      ? {
          file: process.env.ComSpec ?? 'cmd.exe',
          args: [
            '/d',
            '/s',
            '/c',
            [resolution.file, ...finalArgs].map((arg) => quoteWindowsArg(arg)).join(' '),
          ],
          windowsVerbatimArguments: true,
        }
      : {
          file: resolution.file,
          args: finalArgs,
          windowsVerbatimArguments: resolution.windowsVerbatimArguments,
        };
  }

  private executeCommand(
    resolution: TemporalClientResolution & {
      file: string;
      args: string[];
      cwd: string;
      windowsVerbatimArguments?: boolean;
    },
    commandArgs: string[],
  ): string {
    const spawnSpec = this.buildSpawnSpec(resolution, commandArgs);
    const result = spawnSync(spawnSpec.file, spawnSpec.args, {
      cwd: resolution.cwd,
      encoding: 'utf-8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: spawnSpec.windowsVerbatimArguments,
    });

    if (result.error) {
      throw new Error(`TimeTrace command failed to start: ${result.error.message}`);
    }
    if (result.status !== 0) {
      const stderr = result.stderr?.trim() || result.stdout?.trim() || 'Unknown TimeTrace failure.';
      throw new Error(stderr);
    }

    return result.stdout?.trim() ?? '';
  }

  private executeJson<T>(
    resolution: TemporalClientResolution & {
      file: string;
      args: string[];
      cwd: string;
      windowsVerbatimArguments?: boolean;
    },
    commandArgs: string[],
  ): T {
    const raw = this.executeCommand(resolution, commandArgs);
    if (!raw) {
      throw new Error('TimeTrace returned no output.');
    }

    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`TimeTrace returned invalid JSON: ${message}`);
    }
  }
}
