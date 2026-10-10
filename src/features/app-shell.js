import { initializeSettings, saveSettings } from './settings.js';
import { ensureDefaultFiles, createDefaultProjectState } from './state.js';
import { createProjectCatalog, countFiles } from './catalog.js';
import { buildPreviewHtml } from './preview.js';
import { runGlobalSearch } from './search.js';
import { buildFileTree } from './file-tree.js';
import { saveProjectRecord, listProjectRecords, loadProjectRecord } from './project-persistence.js';
import { getModelForPath, disposeMonacoModels, disposeModelsUnderPath } from './editor.js';

export class AppShell {
  constructor() {
    this.state = createDefaultProjectState();
    ensureDefaultFiles(this.state.fileSystem);
    this.state.settings = initializeSettings();
    this.state.projectCatalog = createProjectCatalog(this.state.fileSystem);
    this.state.fileCount = countFiles(this.state.fileSystem);
    this.state.lastPreviewUrl = null;
    this.monacoModels = new Map();
  }

  updateProjectCatalog() {
    this.state.projectCatalog = createProjectCatalog(this.state.fileSystem);
    this.state.fileCount = countFiles(this.state.fileSystem);
  }

  saveSettings() {
    saveSettings(this.state.settings);
  }

  runGlobalSearch(query) {
    return runGlobalSearch(query, this.state.fileSystem);
  }

  renderFileTree(container, options = {}) {
    const root = buildFileTree(this.state.fileSystem);
    container.innerHTML = '';

    const defaults = {
      expandedFolders: this.state.expandedFolders,
      currentFile: this.state.currentFile,
      selectedFolder: this.state.selectedFolder,
      onToggleFolder: (path) => {
        if (this.state.expandedFolders.has(path)) this.state.expandedFolders.delete(path);
        else this.state.expandedFolders.add(path);
        this.state.selectedFolder = path;
        this.renderFileTree(container, options);
      },
      onOpenFile: (path) => {
        this.state.currentFile = path;
        if (typeof options.onOpenFile === 'function') options.onOpenFile(path);
      }
    };

    buildFileTree(this.state.fileSystem);
    const renderOptions = { ...defaults, ...options };
    const node = buildFileTree(this.state.fileSystem);
    const { renderTreeNode } = await import('./file-tree.js');
    renderTreeNode(node, container, 0, renderOptions);
  }

  buildPreviewHtml(htmlContent) {
    return buildPreviewHtml(htmlContent, this.state.fileSystem);
  }

  saveProjectRecord(projectName) {
    return saveProjectRecord(projectName, this.state.fileSystem, { put: (record) => record, getAll: () => [] });
  }

  listProjects() {
    return listProjectRecords({ getAll: () => [] });
  }

  getMonacoModel(path, contentFactory) {
    return getModelForPath(this.monacoModels, path, contentFactory);
  }

  disposeMonacoModels() {
    disposeMonacoModels(this.monacoModels);
  }

  disposeModelsUnderPath(path) {
    disposeModelsUnderPath(this.monacoModels, path);
  }
}

export default AppShell;
