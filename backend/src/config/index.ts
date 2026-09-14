import { validateEnv, type EnvConfig } from './env.js';

let appConfig: EnvConfig;

try {
  appConfig = validateEnv();
} catch (error) {
  if (process.env.NODE_ENV === 'test') {
    // In test environment, fallback to defaults if not provided
    appConfig = validateEnv({});
  } else {
    throw error;
  }
}

export const config = Object.freeze(appConfig);
export * from './env.js';
