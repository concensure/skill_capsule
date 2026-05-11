import * as fs from 'fs';
import * as path from 'path';
import SkillCapsuleRuntime, { SkillCapsuleRuntimeError } from './runtime';
import { DiagnosticCheck, DoctorResult, HookRegistry, SkillCapsuleConfig } from './types';

export interface RuntimeValidationResult {
  ok: true;
  configPath: string;
  projectRoot: string;
  warnings: string[];
}

export function validateRuntimeEnvironment(configPath: string): RuntimeValidationResult {
  const resolvedConfigPath = path.resolve(configPath);
  if (!fs.existsSync(resolvedConfigPath)) {
    throw new SkillCapsuleRuntimeError(
      'CONFIG_NOT_FOUND',
      `Skill Capsule config not found: ${resolvedConfigPath}`,
      false,
      { configPath: resolvedConfigPath },
    );
  }

  let config: SkillCapsuleConfig;
  try {
    config = JSON.parse(fs.readFileSync(resolvedConfigPath, 'utf-8')) as SkillCapsuleConfig;
  } catch (error) {
    throw new SkillCapsuleRuntimeError(
      'CONFIG_INVALID_JSON',
      `Skill Capsule config is not valid JSON: ${resolvedConfigPath}`,
      false,
      { configPath: resolvedConfigPath, cause: error instanceof Error ? error.message : String(error) },
    );
  }

  const projectRoot = path.dirname(path.dirname(resolvedConfigPath));
  const warnings: string[] = [];
  const requiredPaths = [
    path.resolve(projectRoot, config.atom_dir ?? '.skillcapsule/atoms'),
    path.resolve(projectRoot, config.capsule_dir ?? '.skillcapsule/capsules'),
    path.resolve(projectRoot, config.hook_dir ?? '.skillcapsule/hooks'),
  ];
  for (const requiredPath of requiredPaths) {
    if (!fs.existsSync(requiredPath)) {
      throw new SkillCapsuleRuntimeError(
        'CONFIG_REQUIRED_PATH_MISSING',
        `Required Skill Capsule path is missing: ${requiredPath}`,
        false,
        { configPath: resolvedConfigPath, requiredPath },
      );
    }
  }

  const hookRegistryPath = path.join(
    path.resolve(projectRoot, config.hook_dir ?? '.skillcapsule/hooks'),
    'hooks.registry.json',
  );
  if (!fs.existsSync(hookRegistryPath)) {
    throw new SkillCapsuleRuntimeError(
      'HOOK_REGISTRY_MISSING',
      `Hook registry not found: ${hookRegistryPath}`,
      false,
      { configPath: resolvedConfigPath, hookRegistryPath },
    );
  }
  validateHookRegistry(projectRoot, hookRegistryPath, resolvedConfigPath);

  if (!config.context_budget || config.context_budget.default <= 0 || config.context_budget.max <= 0) {
    throw new SkillCapsuleRuntimeError(
      'CONFIG_INVALID_BUDGET',
      'Skill Capsule context budget must define positive default and max values.',
      false,
      { configPath: resolvedConfigPath },
    );
  }
  if (config.context_budget.default > config.context_budget.max) {
    throw new SkillCapsuleRuntimeError(
      'CONFIG_INVALID_BUDGET_RANGE',
      'Skill Capsule context budget default cannot exceed max.',
      false,
      { configPath: resolvedConfigPath },
    );
  }

  if (config.artifact_retention?.enabled) {
    const maxTotal = config.artifact_retention.max_total ?? 0;
    if (maxTotal <= 0) {
      throw new SkillCapsuleRuntimeError(
        'CONFIG_INVALID_RETENTION',
        'Artifact retention max_total must be positive when retention is enabled.',
        false,
        { configPath: resolvedConfigPath },
      );
    }
  }

  if (config.security?.hook_policy?.enforce_command_allowlist) {
    const prefixes = config.security.hook_policy.allowed_prefixes;
    for (const permission of ['read_only', 'read_write', 'restricted_exec'] as const) {
      if (!prefixes?.[permission] || prefixes[permission]!.length === 0) {
        throw new SkillCapsuleRuntimeError(
          'CONFIG_INVALID_HOOK_POLICY',
          `Hook allowlist is missing prefixes for permission: ${permission}`,
          false,
          { configPath: resolvedConfigPath, permission },
        );
      }
    }
  }

  if (config.security?.hook_runner?.enforce && config.security.hook_runner.mode === 'container') {
    if (!config.security.container_image) {
      throw new SkillCapsuleRuntimeError(
        'CONFIG_CONTAINER_IMAGE_MISSING',
        'Container hook runner enforcement requires security.container_image to be configured.',
        false,
        { configPath: resolvedConfigPath },
      );
    }

    const runnerExecutable = config.security.hook_runner.executable ?? 'docker';
    if (!isExecutableAvailable(runnerExecutable, projectRoot)) {
      throw new SkillCapsuleRuntimeError(
        'CONTAINER_RUNNER_MISSING',
        `Container hook runner executable is unavailable: ${runnerExecutable}`,
        false,
        { configPath: resolvedConfigPath, executable: runnerExecutable },
      );
    }
  }

  if (config.security?.sandbox_mode && config.security.sandbox_mode !== 'container') {
    warnings.push(`sandbox_mode is '${config.security.sandbox_mode}', expected 'container' for deployment.`);
  }

  return {
    ok: true,
    configPath: resolvedConfigPath,
    projectRoot,
    warnings,
  };
}

export function createValidatedRuntime(configPath: string): SkillCapsuleRuntime {
  validateRuntimeEnvironment(configPath);
  return new SkillCapsuleRuntime(configPath);
}

export function collectRuntimeDiagnostics(configPath: string): DoctorResult {
  const resolvedConfigPath = path.resolve(configPath);
  const checks: DiagnosticCheck[] = [];

  try {
    const validation = validateRuntimeEnvironment(resolvedConfigPath);
    checks.push({
      name: 'config.validation',
      status: 'PASS',
      detail: 'Configuration and hook registry validation passed.',
    });

    for (const warning of validation.warnings) {
      checks.push({
        name: 'config.warning',
        status: 'WARN',
        detail: warning,
      });
    }

    const runtime = new SkillCapsuleRuntime(resolvedConfigPath);
    const writableTargets = [
      runtime.compiledDir,
      runtime.outcomesDir,
      runtime.logsDir,
    ];
    for (const target of writableTargets) {
      try {
        fs.mkdirSync(target, { recursive: true });
        const probePath = path.join(target, `.doctor-${process.pid}-${Date.now()}.tmp`);
        fs.writeFileSync(probePath, 'ok');
        fs.unlinkSync(probePath);
        checks.push({
          name: 'filesystem.writable',
          status: 'PASS',
          detail: `Writable: ${target}`,
        });
      } catch (error) {
        checks.push({
          name: 'filesystem.writable',
          status: 'FAIL',
          detail: `Not writable: ${target} (${error instanceof Error ? error.message : String(error)})`,
        });
      }
    }

    checks.push({
      name: 'runtime.registry',
      status: 'PASS',
      detail: `capsules=${runtime.listCapsules().length} atoms=${runtime.listAtoms().length} hooks=${runtime.listHooks().length}`,
    });

    const runner = runtime.config.security?.hook_runner;
    checks.push({
      name: 'runtime.hook_runner',
      status: runner?.enforce ? 'PASS' : 'WARN',
      detail: runner?.enforce
        ? `Enforced ${runner.mode ?? 'process'} runner via ${runner.executable ?? 'docker'}.`
        : `Hook runner enforcement is disabled; mode=${runner?.mode ?? 'process'}.`,
    });

    const containerImage = runtime.config.security?.container_image;
    if (containerImage) {
      checks.push({
        name: 'runtime.container_image_tag',
        status: /:latest$/i.test(containerImage) ? 'WARN' : 'PASS',
        detail: /:latest$/i.test(containerImage)
          ? `Container image uses a mutable tag: ${containerImage}`
          : `Container image is explicitly versioned: ${containerImage}`,
      });
    }

    return {
      ok: checks.every((check) => check.status !== 'FAIL'),
      configPath: validation.configPath,
      projectRoot: validation.projectRoot,
      checks,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      name: 'config.validation',
      status: 'FAIL',
      detail: message,
    });
    return {
      ok: false,
      configPath: resolvedConfigPath,
      checks,
    };
  }
}

function validateHookRegistry(projectRoot: string, hookRegistryPath: string, configPath: string): void {
  let registry: HookRegistry;
  try {
    registry = JSON.parse(fs.readFileSync(hookRegistryPath, 'utf-8')) as HookRegistry;
  } catch (error) {
    throw new SkillCapsuleRuntimeError(
      'HOOK_REGISTRY_INVALID_JSON',
      `Hook registry is not valid JSON: ${hookRegistryPath}`,
      false,
      { configPath, hookRegistryPath, cause: error instanceof Error ? error.message : String(error) },
    );
  }

  const hooks = registry.hooks ?? [];
  const ids = new Set<string>();
  for (const hook of hooks) {
    if (!hook.id) {
      throw new SkillCapsuleRuntimeError(
        'HOOK_REGISTRY_INVALID_ENTRY',
        'Hook registry contains an entry without an id.',
        false,
        { configPath, hookRegistryPath },
      );
    }
    if (ids.has(hook.id)) {
      throw new SkillCapsuleRuntimeError(
        'HOOK_REGISTRY_DUPLICATE_ID',
        `Hook registry contains a duplicate id: ${hook.id}`,
        false,
        { configPath, hookRegistryPath, hookId: hook.id },
      );
    }
    ids.add(hook.id);
  }

  for (const hook of hooks) {
    for (const dependency of hook.depends_on ?? []) {
      if (!ids.has(dependency)) {
        throw new SkillCapsuleRuntimeError(
          'HOOK_REGISTRY_UNKNOWN_DEPENDENCY',
          `Hook ${hook.id} depends on an unknown hook: ${dependency}`,
          false,
          { configPath, hookRegistryPath, hookId: hook.id, dependency },
        );
      }
    }

    const command = String(hook.command ?? '').trim();
    if (!command) {
      throw new SkillCapsuleRuntimeError(
        'HOOK_REGISTRY_EMPTY_COMMAND',
        `Hook ${hook.id} has an empty command.`,
        false,
        { configPath, hookRegistryPath, hookId: hook.id },
      );
    }

    const tokens = tokenizeCommand(command);
    const executable = tokens[0];
    if (!executable) {
      throw new SkillCapsuleRuntimeError(
        'HOOK_REGISTRY_EMPTY_COMMAND',
        `Hook ${hook.id} has an empty command.`,
        false,
        { configPath, hookRegistryPath, hookId: hook.id },
      );
    }

    if (!isExecutableAvailable(executable, projectRoot)) {
      throw new SkillCapsuleRuntimeError(
        'HOOK_EXECUTABLE_MISSING',
        `Hook ${hook.id} requires an unavailable executable: ${executable}`,
        false,
        { configPath, hookRegistryPath, hookId: hook.id, executable },
      );
    }

    if (executable === 'node') {
      const scriptPath = tokens[1];
      if (!scriptPath) {
        throw new SkillCapsuleRuntimeError(
          'HOOK_SCRIPT_MISSING',
          `Hook ${hook.id} does not declare a node script path.`,
          false,
          { configPath, hookRegistryPath, hookId: hook.id },
        );
      }
      const resolvedScriptPath = path.resolve(projectRoot, scriptPath);
      if (!fs.existsSync(resolvedScriptPath)) {
        throw new SkillCapsuleRuntimeError(
          'HOOK_SCRIPT_NOT_FOUND',
          `Hook ${hook.id} references a missing script: ${resolvedScriptPath}`,
          false,
          { configPath, hookRegistryPath, hookId: hook.id, scriptPath: resolvedScriptPath },
        );
      }
    }
  }
}

function tokenizeCommand(command: string): string[] {
  return command.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1);
    }
    return token;
  }) ?? [];
}

function isExecutableAvailable(executable: string, projectRoot: string): boolean {
  if (executable.includes(path.sep) || executable.includes('/')) {
    return fs.existsSync(path.resolve(projectRoot, executable));
  }

  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const pathExts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .filter(Boolean)
      : [''];

  for (const entry of pathEntries) {
    const base = path.join(entry, executable);
    for (const ext of pathExts) {
      const candidate = process.platform === 'win32' ? `${base}${ext}` : base;
      if (fs.existsSync(candidate)) {
        return true;
      }
    }
  }

  return false;
}
