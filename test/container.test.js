const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const SkillCapsuleRuntime = require(path.join(repoRoot, 'dist', 'runtime.js')).default;

function makeTempProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcap-docker-test-'));
  fs.cpSync(path.join(repoRoot, '.skillcapsule'), path.join(tempRoot, '.skillcapsule'), {
    recursive: true,
  });
  fs.writeFileSync(path.join(tempRoot, 'README.md'), '# temp project\n');
  execFileSync('git', ['init'], { cwd: tempRoot, stdio: 'ignore' });
  return {
    tempRoot,
    configPath: path.join(tempRoot, '.skillcapsule', 'skillcapsule.config.json'),
  };
}

const runDockerTests = process.env.SKILLCAP_RUN_DOCKER_TESTS === '1';

(runDockerTests ? test : test.skip)(
  'container runner executes prepare through a real Docker image',
  async () => {
    const imageTag = process.env.SKILLCAP_TEST_IMAGE ?? 'skillcapsule/hook-runner:test';
    execFileSync(
      'docker',
      ['build', '-f', 'Dockerfile.hook-runner', '-t', imageTag, '.'],
      { cwd: repoRoot, stdio: 'ignore' },
    );

    const { configPath } = makeTempProject();
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.security.hook_runner = {
      mode: 'container',
      enforce: true,
      executable: 'docker',
      workspace_mount_path: '/workspace',
      network_mode: 'none',
    };
    config.security.container_image = imageTag;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const runtime = new SkillCapsuleRuntime(configPath);
    const result = await runtime.prepare('github.upload.safety', {
      description: 'Upload this project to GitHub',
    });

    assert.equal(result.receipt.status, 'READY');
    assert.equal(result.hookResults.before_render?.[0].status, 'PASS');
    assert.equal(result.hookResults.before_action?.[0].status, 'PASS');
  },
);
