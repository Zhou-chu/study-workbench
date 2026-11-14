import { mergeConfig } from 'vitest/config';
import base from './vitest.config';
import { coverageConfig } from '../scripts/coverage-config';
export default mergeConfig(base, coverageConfig('legacy-web'));
