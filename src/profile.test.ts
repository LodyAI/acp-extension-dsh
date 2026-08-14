import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { DEEPSEEK_HARNESS_NPX_PACKAGES, createDeepSeekHarnessCordisConfig } from './profile.js';

describe('DeepSeek Harness profile', () => {
  it('pins the explicit ACP host and Agent preset package closure', () => {
    expect(DEEPSEEK_HARNESS_NPX_PACKAGES[0]).toBe('@deepseek-ai/dsh-acp-demo');
    expect(DEEPSEEK_HARNESS_NPX_PACKAGES).toEqual(
      expect.arrayContaining([
        '@deepseek-ai/dsh-agent-presets',
        '@deepseek-ai/dsh-agent-tool-presentation',
        '@deepseek-ai/dsh-tool-cordis',
        '@deepseek-ai/dsh-tool-bash-persistent',
      ])
    );
    expect(DEEPSEEK_HARNESS_NPX_PACKAGES).not.toContain('@deepseek-ai/dsh');
  });

  it('generates a credential-free host composition around the adapter and preset root', () => {
    const config = createDeepSeekHarnessCordisConfig(
      '/opt/acp-extension-dsh.js',
      '/opt/deepseek-agent-presets'
    );

    expect(config).toContain("name: '@deepseek-ai/dsh-agent-presets'");
    expect(config).toContain('default: standard');
    expect(config).toContain('path: "/opt/deepseek-agent-presets"');
    expect(config).toContain("name: '@deepseek-ai/dsh-code-runtime-worker-thread'");
    expect(config).toContain('name: "/opt/acp-extension-dsh.js"');
    expect(config).not.toMatch(/api[_-]?key:\s+[^D\n]/iu);
  });

  it('installs every plugin referenced by the host and shipped Agent presets', async () => {
    const sources = [
      createDeepSeekHarnessCordisConfig('/opt/acp-extension-dsh.js', '/opt/presets'),
      ...(await Promise.all(
        ['standard', 'code', 'minimal', 'cordis'].map((presetId) =>
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
