import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  ACP_EXTENSION_DSH_PROFILE_REVISION,
  DEEPSEEK_HARNESS_CORDIS_PACKAGE_VERSIONS,
  DEEPSEEK_HARNESS_DEFAULT_SESSION_COMPRESSION,
  DEEPSEEK_HARNESS_NPX_PACKAGES,
  DEEPSEEK_HARNESS_PROFILE_BUNDLES,
  DEEPSEEK_HARNESS_PROFILE_NAME,
  DEEPSEEK_HARNESS_VERSION,
  createDeepSeekHarnessNpxSpecifiers,
  createDeepSeekHarnessProfileFiles,
} from './profile.js';
import {
  DEEPSEEK_HARNESS_DEFAULT_PERMISSION_PRESET,
  DEEPSEEK_HARNESS_PERMISSION_PRESETS,
} from './capabilities.js';

const PRESET_IDS = ['standard', 'ptc', 'minimal', 'cordis'] as const;

describe('DeepSeek Harness profile', () => {
  it('pins the launcher, base bundle, and same-release package closure', () => {
    expect(DEEPSEEK_HARNESS_VERSION).toBe('0.1.5-rc.2');
    expect(DEEPSEEK_HARNESS_PROFILE_NAME).toBe('lody-acp');
    expect(DEEPSEEK_HARNESS_PROFILE_BUNDLES).toEqual(['@deepseek-ai/dsh-base']);
    expect(new Set(DEEPSEEK_HARNESS_NPX_PACKAGES).size).toBe(DEEPSEEK_HARNESS_NPX_PACKAGES.length);
    expect(DEEPSEEK_HARNESS_NPX_PACKAGES[0]).toBe('@deepseek-ai/dsh');
    expect(DEEPSEEK_HARNESS_NPX_PACKAGES).toEqual(
      expect.arrayContaining([
        '@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-agent-presets',
        '@deepseek-ai/dsh-mcp-client',
        '@deepseek-ai/dsh-agent-tool-presentation',
        '@deepseek-ai/dsh-attachment-local',
        '@deepseek-ai/dsh-tool-str-replace-editor',
        '@deepseek-ai/dsh-session',
      ])
    );
    expect(DEEPSEEK_HARNESS_NPX_PACKAGES).not.toContain('@deepseek-ai/dsh-acp-demo');
    expect(DEEPSEEK_HARNESS_NPX_PACKAGES).not.toContain('@deepseek-ai/dsh-agent-spine-demo');
  });

  it('pins the Cordis ecosystem at its own releases instead of the Harness release', () => {
    const specifiers = createDeepSeekHarnessNpxSpecifiers();

    expect(specifiers).toHaveLength(DEEPSEEK_HARNESS_NPX_PACKAGES.length);
    expect(specifiers).toEqual(
      expect.arrayContaining([
        '@deepseek-ai/cordis@4.0.2',
        '@deepseek-ai/cordis-plugin-group@1.0.2',
        '@deepseek-ai/cordis-plugin-hmr@1.0.17',
        '@deepseek-ai/cordis-plugin-include@1.0.7',
        '@deepseek-ai/cordis-plugin-loader@1.0.3',
        '@deepseek-ai/cordis-plugin-timer@1.1.4',
      ])
    );
    // No Cordis package publishes a `DEEPSEEK_HARNESS_VERSION` release, so a
    // specifier built from it fails the cold install with ETARGET.
    for (const name of Object.keys(DEEPSEEK_HARNESS_CORDIS_PACKAGE_VERSIONS)) {
      expect(DEEPSEEK_HARNESS_NPX_PACKAGES).toContain(name);
      expect(specifiers).not.toContain(`${name}@${DEEPSEEK_HARNESS_VERSION}`);
    }
    for (const specifier of specifiers) {
      const separator = specifier.lastIndexOf('@');
      const name = specifier.slice(0, separator);
      const version = specifier.slice(separator + 1);
      expect(DEEPSEEK_HARNESS_NPX_PACKAGES).toContain(name);
      expect(version).toBe(
        DEEPSEEK_HARNESS_CORDIS_PACKAGE_VERSIONS[name] ?? DEEPSEEK_HARNESS_VERSION
      );
    }
  });

  it('generates a credential-free base profile with the Lody overlay', () => {
    const files = createDeepSeekHarnessProfileFiles({
      adapterPath: '/opt/acp-extension-dsh.js',
      presetRoot: '/opt/deepseek-agent-presets',
    });

    expect(JSON.parse(files.packageJson)).toMatchObject({
      private: true,
      dsh: {
        profile: {
          bundles: ['@deepseek-ai/dsh-base'],
          patchReload: 'startup',
        },
      },
    });
    expect(files.cordisYml).toBe('[]\n');
    expect(files.pnpmWorkspaceYaml).toContain('nodeLinker: hoisted');

    const patch = files.cordisPatchYml;
    expect(patch).toContain('- id: session-telemetry-otel\n  disabled: true');
    expect(patch).toContain('- id: session-title-llm\n  disabled: true');
    expect(patch).toContain('openAt: never');
    expect(patch).toContain('compression: zstd');
    // The permission block is rendered from the shared vocabulary, so the
    // selector labels and the enforced presets cannot drift apart.
    expect(patch).toContain(`defaultPreset: ${DEEPSEEK_HARNESS_DEFAULT_PERMISSION_PRESET}`);
    for (const preset of DEEPSEEK_HARNESS_PERMISSION_PRESETS) {
      expect(patch).toContain(
        `      ${preset.id}:\n` +
          `        sandbox: ${preset.sandbox}\n` +
          `        approval: ${preset.approval}\n` +
          `        name: ${preset.name}\n` +
          `        description: ${preset.description}`
      );
    }
    expect(patch).toContain("name: '@deepseek-ai/dsh-agent-presets'");
    expect(patch).toContain('default: standard');
    expect(patch).toContain('includeShippedRoot: false');
    expect(patch).toContain('path: "/opt/deepseek-agent-presets"');
    expect(patch).toContain('name: "/opt/acp-extension-dsh.js"');
    expect(patch).toContain('inject: [settings]');
    expect(patch).toContain('model: "deepseek-flash"');
    expect(patch).not.toMatch(/api[_-]?key:\s+[^D\n]/iu);
  });

  it('invalidates cached probes when the generated profile contract changes', () => {
    expect(ACP_EXTENSION_DSH_PROFILE_REVISION).toBe('v11');
  });

  it('defaults to upstream-compatible zstd and permits a detected legacy raw root', () => {
    expect(DEEPSEEK_HARNESS_DEFAULT_SESSION_COMPRESSION).toBe('zstd');
    expect(
      createDeepSeekHarnessProfileFiles({
        adapterPath: '/opt/adapter.js',
        presetRoot: '/opt/presets',
      }).cordisPatchYml
    ).toContain('compression: zstd');
    expect(
      createDeepSeekHarnessProfileFiles({
        adapterPath: '/opt/adapter.js',
        presetRoot: '/opt/presets',
        sessionCompression: 'none',
      }).cordisPatchYml
    ).toContain('compression: none');
  });

  it('installs every package the overlay and shipped Agent presets reference', async () => {
    const files = createDeepSeekHarnessProfileFiles({
      adapterPath: '/opt/acp-extension-dsh.js',
      presetRoot: '/opt/presets',
    });
    const sources = [
      files.cordisPatchYml,
      ...(await Promise.all(
        PRESET_IDS.map((presetId) =>
          readFile(new URL(`../presets/${presetId}/agent.cordis.yml`, import.meta.url), 'utf8')
        )
      )),
    ];
    const installed = new Set<string>(DEEPSEEK_HARNESS_NPX_PACKAGES);

    for (const source of sources) {
      for (const match of source.matchAll(/name: '(@deepseek-ai\/[^']+)'/gu)) {
        const specifier = match[1];
        if (!specifier) continue;
        const packageName = specifier.split('/').slice(0, 2).join('/');
        expect(installed, `missing npx package for ${specifier}`).toContain(packageName);
      }
    }
  });
});
