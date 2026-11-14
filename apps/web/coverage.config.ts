import { mergeConfig } from 'vitest/config';
import base from './vite.config';
import { coverageConfig } from '../../scripts/coverage-config';
export default mergeConfig(base, coverageConfig('web'));
