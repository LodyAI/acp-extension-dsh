import { describe, expect, it } from 'vitest';

import {
  ACP_EXTENSION_DSH_QUERY_PATH_ENV,
  ACP_EXTENSION_DSH_SESSION_ROOT_ENV,
  DEEPSEEK_HARNESS_NPX_PACKAGES,
  createDeepSeekHarnessCordisConfig,
} from './profile.js';

describe('DeepSeek Harness profile', () => {
  it('pins the ACP entry first and composes the control dependencies', () => {
    expect(DEEPSEEK_HARNESS_NPX_PACKAGES[0]).toBe('@deepseek-ai/dsh-acp-demo');
    expect(DEEPSEEK_HARNESS_NPX_PACKAGES).toContain('@deepseek-ai/dsh-llm-deepseek');
    expect(DEEPSEEK_HARNESS_NPX_PACKAGES).toContain('@deepseek-ai/dsh-permission-presets');
  });

  it('generates a credential-free Cordis profile around the supplied adapter', () => {
    const config = createDeepSeekHarnessCordisConfig('/opt/acp-extension-dsh.js');

    for (const packageName of DEEPSEEK_HARNESS_NPX_PACKAGES.slice(1)) {
      expect(config).toContain(`name: '${packageName}'`);
    }
    expect(config).toContain(`process.env.${ACP_EXTENSION_DSH_SESSION_ROOT_ENV}`);
    expect(config).toContain(`process.env.${ACP_EXTENSION_DSH_QUERY_PATH_ENV}`);
    expect(config).toContain('name: "/opt/acp-extension-dsh.js"');
    expect(config).not.toMatch(/api[_-]?key/iu);
  });
});
