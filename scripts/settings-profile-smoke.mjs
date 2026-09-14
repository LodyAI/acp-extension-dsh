import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import {
  DEEPSEEK_HARNESS_PROFILE_NAME,
  createDeepSeekHarnessProfileFiles,
} from '../dist/profile.js';

// Supply a preinstalled exact profile closure; this test never installs packages
// or sends a model request. See README.md for preparation outside the test.
const runtimeRoot = process.env.DSH_TEST_RUNTIME_ROOT;
assert.ok(runtimeRoot, 'Set DSH_TEST_RUNTIME_ROOT to the installed Harness node_modules directory');
const runtimeRequire = createRequire(join(runtimeRoot, '.settings-profile-test.cjs'));
const extensionRoot = fileURLToPath(new URL('../', import.meta.url));

// Resolve the launcher through the preinstalled runtime closure.
const dshBin = join(dirname(runtimeRequire.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js');

const cases = [
  {
    name: 'settings catalog is available to the first ACP request',
    settings:
      '# preserved comment\nllm-deepseek:\n  models:\n    - id: synthetic-settings-model\n      name: Synthetic settings model\n',
    expectedModel: 'synthetic-settings-model',
  },
  { name: 'absent settings retain defaults', expectedModel: 'deepseek-flash' },
  { name: 'invalid YAML fails startup', settings: 'llm-deepseek: [\n', invalid: true },
  {
    name: 'non-mapping settings document fails startup',
    settings: '- invalid-settings-document\n',
    invalid: true,
  },
];

for (const fixture of cases) {
  await test(fixture.name, { timeout: 60_000 }, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-settings-test-'));
    let child;
    let exited;
    t.after(async () => {
      try {
        child?.kill();
        await exited;
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
    const settingsPath = join(root, 'settings.yaml');
    if (fixture.settings !== undefined) await writeFile(settingsPath, fixture.settings);
    await mkdir(join(root, 'sessions'), { recursive: true });

    const profileDir = join(root, 'profiles', DEEPSEEK_HARNESS_PROFILE_NAME);
    await mkdir(profileDir, { recursive: true });
    const files = createDeepSeekHarnessProfileFiles({
      adapterPath: join(extensionRoot, 'dist/index.js'),
      presetRoot: join(extensionRoot, 'presets'),
    });
    await writeFile(join(profileDir, 'package.json'), files.packageJson);
    await writeFile(join(profileDir, 'cordis.yml'), files.cordisYml);
    await writeFile(join(profileDir, 'cordis.patch.yml'), files.cordisPatchYml);
    await writeFile(join(profileDir, 'pnpm-workspace.yaml'), files.pnpmWorkspaceYaml);

    child = spawn(process.execPath, [dshBin, '--profile', DEEPSEEK_HARNESS_PROFILE_NAME], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        USERPROFILE: root,
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        DSH_HOME: root,
        ACP_EXTENSION_DSH_SESSION_ROOT: join(root, 'sessions'),
        ACP_EXTENSION_DSH_QUERY_PATH: join(root, 'sessions/query.db'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: t.signal,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    exited = once(child, 'exit');
    const connection = new ClientSideConnection(
      () => ({
        sessionUpdate: async () => {},
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
      }),
      ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))
    );
    try {
      const initialized = connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      if (fixture.invalid) {
        await assert.rejects(initialized);
        const [code] = await exited;
        assert.notEqual(code, 0);
        assert.match(stderr, /settings|YAML/iu);
      } else {
        await initialized;
        const session = await connection.newSession({ cwd: root, mcpServers: [] });
        const model = session.configOptions.find((option) => option.id === 'model');
        const ids = model.options.map((option) => option.value);
        assert.ok(ids.includes(fixture.expectedModel), JSON.stringify(ids));
        if (fixture.settings) {
          // The settings document replaces the Harness catalog, so the shipped
          // defaults disappear. The profile-configured model stays visible on
          // purpose: the catalog is advisory, so an unlisted configured route
          // must remain selectable.
          assert.ok(!ids.includes('deepseek-v4-pro'), JSON.stringify(ids));
          assert.ok(ids.includes('deepseek-flash'), JSON.stringify(ids));
        }
      }
      if (fixture.settings !== undefined) {
        assert.equal(await readFile(settingsPath, 'utf8'), fixture.settings);
      } else {
        await assert.rejects(readFile(settingsPath), { code: 'ENOENT' });
      }
    } catch (error) {
      t.diagnostic(stderr);
      throw error;
    }
  });
}
