import { config } from './config.js';
import { loadJSON, saveJSON } from './core/storage.js';
import { applyTheme } from './ui/theme.js';

export function bootstrapApp() {
  const savedTheme = loadJSON(config.settingsKey, { theme: 'dark' })?.theme || 'dark';
  applyTheme(savedTheme);

  console.info(`[${config.appName}] bootstrap complete.`);
  return { config, savedTheme };
}

export default bootstrapApp;
