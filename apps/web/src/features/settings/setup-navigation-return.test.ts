import {expect, it} from 'vitest';
import {safeSetupReturn} from './SetupLink';
it.each(['https://evil.example','//evil.example','/\\evil.example','/%2f%2fevil.example','/settings/models','/login','/notebooks\n'])('rejects unsafe or irrelevant return target %s', value=>expect(safeSetupReturn(value)).toBeNull());
