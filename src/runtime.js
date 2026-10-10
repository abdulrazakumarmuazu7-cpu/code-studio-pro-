import { initializeSettings, saveSettings } from '../features/settings.js';
import { createDefaultProjectState, ensureDefaultFiles } from '../features/state.js';
import { createProjectCatalog, countFiles } from '../features/catalog.js';
import { buildPreviewHtml } from '../features/preview.js';
import { runGlobalSearch } from '../features/search.js';
import { getModelForPath, disposeMonacoModels, disposeModelsUnderPath } from '../features/editor.js';
import { buildFileTree } from '../features/file-tree.js';
import { saveProjectRecord, listProjectRecords } from '../features/project-persistence.js';

export function createAppRuntime() {
  const state = createDefaultProjectState();
  const projectState = { ...state };

  const fileSystem = projectState.fileSystem;
  ensureDefaultFiles(fileSystem);

  projectState.settings = initializeSettings();
  projectState.projectCatalog = createProjectCatalog(fileSystem);
  projectState.fileCount = countFiles(fileSystem);

  return {
    state: projectState,
    helpers: {
      saveSettings,
      initializeSettings,
      createProjectCatalog,
      countFiles,
      buildPreviewHtml,
      runGlobalSearch,
      getModelForPath,
      disposeMonacoModels,
      disposeModelsUnderPath,
      buildFileTree,
      saveProjectRecord,
      listProjectRecords
    }
  };
}

export default createAppRuntime;
