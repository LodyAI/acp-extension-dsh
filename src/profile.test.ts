import { describe, expect, it } from 'vitest';

import {
  DEEPSEEK_HARNESS_CORDIS_PACKAGE_VERSIONS,
  DEEPSEEK_HARNESS_NPX_PACKAGES,
  DEEPSEEK_HARNESS_PI_AI_VERSION,
  DEEPSEEK_HARNESS_SCHEMASTERY_VERSION,
  DEEPSEEK_HARNESS_PROFILE_BUNDLES,
  DEEPSEEK_HARNESS_PROFILE_NAME,
  DEEPSEEK_HARNESS_VERSION,
  createDeepSeekHarnessNpxSpecifiers,
  toAdapterModuleSpecifier,
} from './profile.js';
describe('DeepSeek Harness profile', () => {
  it('pins the launcher, base bundle, and same-release package closure', () => {
    expect(DEEPSEEK_HARNESS_VERSION).toBe('0.2.0-rc.2');
    expect(DEEPSEEK_HARNESS_PROFILE_NAME).toBe('lody-acp');
    expect(DEEPSEEK_HARNESS_PROFILE_BUNDLES).toEqual(['@deepseek-ai/dsh-base']);
    expect(new Set(DEEPSEEK_HARNESS_NPX_PACKAGES).size).toBe(DEEPSEEK_HARNESS_NPX_PACKAGES.length);
    expect(DEEPSEEK_HARNESS_NPX_PACKAGES[0]).toBe('@deepseek-ai/dsh');
    expect(DEEPSEEK_HARNESS_NPX_PACKAGES).toEqual(
      expect.arrayContaining([
        '@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-agent-preset-registry',
        '@deepseek-ai/dsh-mcp-client',
        '@deepseek-ai/dsh-llm-pi-ai',
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

    expect(specifiers).toHaveLength(DEEPSEEK_HARNESS_NPX_PACKAGES.length + 2);
    expect(specifiers).toEqual(
      expect.arrayContaining([
        '@deepseek-ai/cordis@4.0.4',
        '@deepseek-ai/cordis-plugin-group@1.0.4',
        '@deepseek-ai/cordis-plugin-include@1.0.9',
        '@deepseek-ai/cordis-plugin-loader@1.0.5',
        '@deepseek-ai/cordis-plugin-timer@1.1.6',
      ])
    );
    // No Cordis package publishes a `DEEPSEEK_HARNESS_VERSION` release, so a
    // specifier built from it fails the cold install with ETARGET.
    for (const name of Object.keys(DEEPSEEK_HARNESS_CORDIS_PACKAGE_VERSIONS)) {
      expect(DEEPSEEK_HARNESS_NPX_PACKAGES).toContain(name);
      expect(specifiers).not.toContain(`${name}@${DEEPSEEK_HARNESS_VERSION}`);
    }
    expect(specifiers).toContain(`@earendil-works/pi-ai@${DEEPSEEK_HARNESS_PI_AI_VERSION}`);
    expect(specifiers).toContain(
      `@deepseek-ai/schemastery@${DEEPSEEK_HARNESS_SCHEMASTERY_VERSION}`
    );
    for (const specifier of specifiers.slice(0, DEEPSEEK_HARNESS_NPX_PACKAGES.length)) {
      const separator = specifier.lastIndexOf('@');
      const name = specifier.slice(0, separator);
      const version = specifier.slice(separator + 1);
      expect(DEEPSEEK_HARNESS_NPX_PACKAGES).toContain(name);
      expect(version).toBe(
        DEEPSEEK_HARNESS_CORDIS_PACKAGE_VERSIONS[name] ?? DEEPSEEK_HARNESS_VERSION
      );
    }
  });

  it('renders a Windows adapter path as a file URL module specifier', () => {
    // A raw `C:\...` path parses as the `c:` URL scheme and fails the ESM
    // loader on Windows; the override pins that conversion from any CI OS.
    expect(toAdapterModuleSpecifier('C:\\Program Files\\Lody\\deepseek-acp.js', true)).toBe(
      'file:///C:/Program%20Files/Lody/deepseek-acp.js'
    );
  });

  it('leaves an already-file adapter specifier untouched', () => {
    expect(toAdapterModuleSpecifier('file:///opt/acp-extension-dsh.js', true)).toBe(
      'file:///opt/acp-extension-dsh.js'
    );
  });
});
