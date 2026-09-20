import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const { packageEnvironment } = createRequire(resolve('package.json'))('./scripts/package.cjs') as {
  packageEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
};
it('removes missing GitHub signing secrets instead of treating them as certificate paths', () => {
  const environment = { CSC_LINK: '', CSC_KEY_PASSWORD: '', APPLE_ID: ' ', CSC_IDENTITY_AUTO_DISCOVERY: 'false', PATH: '/bin' };
  expect(packageEnvironment(environment)).toEqual({ CSC_IDENTITY_AUTO_DISCOVERY: 'false', PATH: '/bin' });
  expect(environment.CSC_LINK).toBe('');
});
it('preserves explicitly supplied certificates and passwords', () => {
  expect(packageEnvironment({ CSC_LINK: '/tmp/certificate.p12', CSC_KEY_PASSWORD: ' password ', APPLE_TEAM_ID: 'TEAM' })).toEqual({
    CSC_LINK: '/tmp/certificate.p12', CSC_KEY_PASSWORD: ' password ', APPLE_TEAM_ID: 'TEAM'
  });
});
