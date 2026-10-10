// ============================================
// CODE STUDIO PRO - Main Application
// PWA + Android/iOS Native Support
// ============================================

class CodeStudio {
    constructor() {
        this.editor = null;
        this.monacoModels = new Map(); // path -> monaco.ITextModel (VS Code-style, one model per file)
        this.currentFile = null;
        this.openFiles = [];
        this.fileSystem = new Map();
        this.terminalHistory = [];
        this.isDarkTheme = true;
        this.projectName = 'untitled-project';
        this.clipboard = null;
        this.contextTarget = null;
        this.selectedFolder = '';
        this.expandedFolders = new Set();
        this.deferredPrompt = null;
        this.api = new CodeStudioAPI();
        this.accountMode = 'login';
        this.isNativeApp = false;
        this.platform = 'web';
        this.settings = {
            theme: 'dark',
            fontSize: 14,
            wordWrap: 'on',
            autoSave: 'afterDelay',
            gitAuthorName: '',
            gitAuthorEmail: '',
            gitCorsProxy: 'https://cors.isomorphic-git.org',
            gitToken: ''
        };
        
        // Real git state (isomorphic-git + LightningFS), lazily initialized
        // the first time a git action is used.
        this.gitFsReady = false;
        this.gitFs = null;
        this.gitPfs = null;
        this.gitDir = '/repo';
        this.gitRemoteUrl = '';
        this.gitCurrentBranch = 'main';
        
        this.init();
    }
    
    // ============================================
    // INITIALIZATION
    // ============================================
    async init() {
        if (window.__cspInitialized) return; // prevent double-boot (loader conflicts, container injections)
        window.__cspInitialized = true;
        // Detect platform
        this.detectPlatform();
        
        // Load settings
        this.loadSettings();
        this.applyThemeFromSettings();
        
        // Register Service Worker (PWA)
        await this.registerServiceWorker();
        
        // Setup PWA install prompt
        this.setupPWAInstall();
        
        // Setup offline detection
        this.setupOfflineDetection();
        
        // Load Monaco Editor
        await this.loadMonaco();
        
        // Initialize file system
        this.initFileSystem();
        
        // Setup event listeners
        this.setupEvents();
        
        // Hide loading, show welcome
        this.hideLoading();
        
        // Load recent projects
        this.loadRecentProjects();
    }
    
    detectPlatform() {
        // Check if running as Capacitor/Cordova native app
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            this.isNativeApp = true;
            this.platform = window.Capacitor.getPlatform(); // 'ios', 'android', 'web'
            console.log('[App] Running as native app on:', this.platform);
        } else if (window.cordova) {
            this.isNativeApp = true;
            this.platform = window.device ? window.device.platform.toLowerCase() : 'native';
            console.log('[App] Running as Cordova app on:', this.platform);
        } else {
            console.log('[App] Running as web/PWA');
        }
        
        // Apply platform-specific styles
        if (this.isNativeApp) {
            document.body.classList.add('native-app');
            if (this.platform === 'ios') {
                document.body.classList.add('ios');
            } else if (this.platform === 'android') {
                document.body.classList.add('android');
            }
        }
    }
    
    applyThemeFromSettings() {
        let theme = this.settings.theme;
        if (theme === 'system') {
            theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
        }
        this.isDarkTheme = theme !== 'light';
        document.documentElement.setAttribute('data-theme', this.isDarkTheme ? 'dark' : 'light');
        const icon = document.getElementById('themeIcon');
        if (icon) icon.className = this.isDarkTheme ? 'fas fa-moon' : 'fas fa-sun';
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('sw.js');
                this.swRegistration = registration;
                console.log('[SW] Registered:', registration.scope);
                
                // Listen for updates
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            this.showToast('Update available! Refresh to update.', 'info');
                        }
                    });
                });
                
                // Check for existing controller
                if (registration.active) {
                    console.log('[SW] Active controller found');
                }
            } catch (error) {
                console.error('[SW] Registration failed:', error);
            }
        }
    }
    
    setupPWAInstall() {
        window.addEventListener('beforeinstallprompt', (e) => {
            // Prevent the mini-infobar from appearing on mobile
            e.preventDefault();
            // Store the event for later use
            this.deferredPrompt = e;
            // Show install banner
            this.showPWAInstallBanner();
        });
        
        window.addEventListener('appinstalled', () => {
            this.deferredPrompt = null;
            this.hidePWAInstallBanner();
            this.showToast('Code Studio Pro installed!', 'success');
            console.log('[PWA] App was installed');
        });
    }
    
    setupOfflineDetection() {
        const offlineIndicator = document.getElementById('offlineIndicator');
        
        window.addEventListener('online', () => {
            offlineIndicator.classList.remove('active');
            this.showToast('Back online!', 'success');
            // Trigger background sync
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.ready.then((reg) => {
                    if ('sync' in reg) {
                        reg.sync.register('sync-projects').catch(() => {});
                    }
                });
            }
        });
        
        window.addEventListener('offline', () => {
            offlineIndicator.classList.add('active');
            this.showToast('You are offline. Working in local mode.', 'warning');
        });
        
        // Check initial state
        if (!navigator.onLine) {
            offlineIndicator.classList.add('active');
        }
    }
    
    async loadMonaco() {
        // Singleton: the loader + editor boot must run exactly once, even if the
        // host page/container re-executes scripts ("Can only have one anonymous
        // define call per script file" is caused by a second loader.js execution).
        if (this._monacoPromise) return this._monacoPromise;
        if (window.monaco && window.monaco.editor) return Promise.resolve(); // restored from bfcache
        this._monacoPromise = new Promise((resolve) => {
            const boot = () => {
                try {
                    require.config({ 
                        paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' }
                    });

                    require([
                        'vs/editor/editor.main',
                        'vs/language/typescript/monaco.contribution',   // FULL TS/JS IntelliSense (same engine family as VS Code)
                        'vs/language/html/monaco.contribution',         // HTML tags/attrs validation + completion
                        'vs/language/css/monaco.contribution',          // CSS completion + validation
                        'vs/language/json/monaco.contribution'          // JSON validation + schema IntelliSense
                    ], () => {
                this.editor = monaco.editor.create(document.getElementById('monaco-editor'), {
                    value: this.getWelcomeContent(),
                    language: 'javascript',
                    theme: this.settings.theme === 'light' ? 'vs' : 'vs-dark',
                    fontSize: this.settings.fontSize,
                    fontFamily: 'Fira Code, SF Mono, Monaco, monospace',
                    minimap: { enabled: window.innerWidth >= 768 },
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    roundedSelection: false,
                    padding: { top: 16 },
                    lineNumbers: 'on',
                    renderLineHighlight: 'all',
                    selectOnLineNumbers: true,
                    matchBrackets: 'always',
                    tabSize: 2,
                    insertSpaces: true,
                    wordWrap: this.settings.wordWrap,
                    folding: true,
                    foldingStrategy: 'indentation',
                    showFoldingControls: 'always',
                    bracketPairColorization: { enabled: true },
                    guides: {
                        bracketPairs: true,
                        indentation: true
                    },
                    quickSuggestions: true,
                    suggestOnTriggerCharacters: true,
                    acceptSuggestionOnEnter: 'on',
                    formatOnPaste: true,
                    formatOnType: true,
                    autoIndent: 'full',
                    dragAndDrop: true,
                    links: true,
                    mouseWheelZoom: true,
                    multiCursorModifier: 'altCmd',
                    renderWhitespace: 'selection',
                    smoothScrolling: true,
                    cursorBlinking: 'smooth',
                    cursorSmoothCaretAnimation: 'on'
                });
                
                // Real VS Code-style diagnostics for the Problems panel
                try {
                    monaco.languages.typescript?.javascriptDefaults?.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
                } catch {}

                // Update cursor position
                this.editor.onDidChangeCursorPosition((e) => {
                    document.getElementById('cursorPosition').textContent = 
                        `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
                });
                
                // Auto-save on change + refresh Problems (debounced)
                this.editor.onDidChangeModelContent(() => {
                    clearTimeout(this._probT);
                    this._probT = setTimeout(() => this.updateProblems(), 400);
                    if (this.currentFile) {
                        this.markFileAsModified(this.currentFile);
                        if (this.settings.autoSave === 'afterDelay') {
                            this.debouncedSave();
                        }
                    }
                });
                
                // Focus change auto-save
                window.addEventListener('blur', () => {
                    if (this.settings.autoSave === 'onFocusChange' && this.currentFile) {
                        this.saveFile();
                    }
                });
                
                    resolve();
                    }, () => { this.monacoBootError(); resolve(); });
                } catch (e) { this.monacoBootError(); resolve(); }
            };
            if (typeof window.require === 'function') boot();
            else {
                // loader.js not present yet (offline first visit / blocked CDN): wait, then fail visibly
                const t0 = Date.now();
                const wait = setInterval(() => {
                    if (typeof window.require === 'function') { clearInterval(wait); boot(); }
                    else if (Date.now() - t0 > 15000) { clearInterval(wait); this.monacoBootError(); resolve(); }
                }, 200);
            }
        });
        return this._monacoPromise;
    }

    // Visible, recoverable failure instead of silent/uncaught errors
    monacoBootError() {
        if (this.editor) return;
        const el = document.getElementById('monaco-editor');
        if (el) el.innerHTML = `
            <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:32px;text-align:center;color:var(--text-secondary);">
                <i class="fas fa-plug-circle-xmark" style="font-size:34px;color:var(--error);"></i>
                <div style="font-weight:700;color:var(--text-primary);">Editor failed to load</div>
                <div style="font-size:12px;max-width:380px;">The Monaco editor could not start. This usually means the first visit happened while offline — connect to the internet once so the editor can cache itself, then reload.</div>
                <button class="btn btn-primary" onclick="location.reload()"><i class="fas fa-rotate"></i> Reload</button>
            </div>`;
        this.showToast('Editor failed to load — connect once to the internet and reload.', 'error');
    }
    
    getWelcomeContent() {
        return `// Welcome to Code Studio Pro! 🚀
// ============================================
// A VS Code-style editor that runs in your browser
// 
// Core features:
// ✅ Monaco Editor (the same editor engine as VS Code)
// ✅ FULL IntelliSense: TypeScript, JavaScript, HTML, CSS, JSON
//    (hover types, go-to-definition across files, rename, signature help)
// ✅ Keyword + snippet completions: Python, Java, C, C++, PHP, Go, Rust, Ruby, SQL, Shell
// ✅ Command Palette — Ctrl+Shift+P or F1
// ✅ Quick Open files — Ctrl+P
// ✅ Search in all files — Ctrl+Shift+F
// ✅ Problems panel — live diagnostics (like VS Code)
// ✅ Integrated Terminal — Ctrl+\` (ls, mkdir, cat, echo > f, cd, rm...)
// ✅ Live Preview — Ctrl+Shift+V
// ✅ Tabs: Ctrl+W closes, Ctrl+B toggles sidebar
// ✅ Go to Line — Ctrl+G   ·   Find — Ctrl+F   ·   Replace — Ctrl+H
// ✅ Format — Ctrl+K   ·   Comment — Ctrl+/
// ✅ Offline support (PWA)  ·  Git  ·  Mobile Builder
// 
// Start coding below, or press Ctrl+Shift+P to explore every command:
`;
    }
    
    initFileSystem() {
        const defaultFiles = {
            'index.html': {
                type: 'file',
                content: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My App</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="container">
        <h1>🚀 Welcome to Code Studio!</h1>
        <p>Start building your amazing project here.</p>
        <button id="btn">Click Me</button>
        <div id="output"></div>
    </div>
    <script src="app.js"><\/script>
</body>
</html>`,
                language: 'html'
            },
            'style.css': {
                type: 'file',
                content: `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
}

.container {
    background: white;
    padding: 40px;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    text-align: center;
    max-width: 420px;
    width: 100%;
    animation: fadeIn 0.6s ease;
}

h1 {
    color: #333;
    margin-bottom: 12px;
    font-size: 28px;
    font-weight: 800;
}

p {
    color: #666;
    margin-bottom: 24px;
    line-height: 1.6;
    font-size: 15px;
}

button {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    padding: 14px 36px;
    border-radius: 30px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
}

button:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(102, 126, 234, 0.5);
}

button:active {
    transform: translateY(0);
}

#output {
    margin-top: 20px;
    padding: 16px;
    background: #f8f9fa;
    border-radius: 12px;
    font-size: 14px;
    color: #333;
    display: none;
}

#output.show {
    display: block;
    animation: slideUp 0.3s ease;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}

@keyframes slideUp {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}`,
                language: 'css'
            },
            'app.js': {
                type: 'file',
                content: `// Your JavaScript code here
console.log('🚀 Code Studio Pro - App started!');

const btn = document.getElementById('btn');
const output = document.getElementById('output');

btn.addEventListener('click', () => {
    output.innerHTML = \`
        <strong>✅ Success!</strong><br>
        <span style="color: #666;">Your app is working perfectly.</span><br>
        <span style="font-size: 12px; color: #999; margin-top: 8px; display: block;">
            Built with Code Studio Pro
        </span>
    \`;
    output.classList.add('show');
    
    console.log('Button clicked! App is running.');
});

// Example: Fetch API
async function fetchData(url) {
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Fetch error:', error);
        return null;
    }
}

// Example: Local Storage
function saveToStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function getFromStorage(key) {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : null;
}`,
                language: 'javascript'
            },
            'README.md': {
                type: 'file',
                content: `# My Project

Welcome to your new project built with **Code Studio Pro**!

## 🚀 Getting Started

1. Edit files in the explorer panel on the left
2. Click **Run** (▶️) to see live preview
3. Use **Mobile Builder** to build Android/iOS apps

## ✨ Features

- ✅ Monaco Editor with IntelliSense
- ✅ Live Preview with auto-refresh
- ✅ Built-in Terminal
- ✅ Mobile App Builder (APK/AAB)
- ✅ Offline Support (PWA)
- ✅ Git Integration
- ✅ Auto-save

## 📱 Build Mobile App

1. Click the **Mobile** button
2. Select your target platform (Android/iOS)
3. Choose device frame
4. Click **Build APK** or **Build AAB**

## 🛠️ Tech Stack

- HTML5
- CSS3
- JavaScript (ES6+)
- Capacitor (for mobile builds)

---
Built with ❤️ using Code Studio Pro`,
                language: 'markdown'
            }
        };
        
        Object.entries(defaultFiles).forEach(([name, data]) => {
            this.fileSystem.set(name, { ...data, modified: false });
        });
        
        this.renderFileTree();
    }
    
    setupEvents() {
        // Context menu
        document.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.file-item')) {
                e.preventDefault();
                this.contextTarget = e.target.closest('.file-item').dataset.path;
                this.showContextMenu(e.clientX, e.clientY);
            }
        });
        
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu')) {
                document.getElementById('contextMenu').style.display = 'none';
            }
            const dd = document.getElementById('menuDropdown');
            if (dd && !dd.contains(e.target)) dd.remove();
        });
        
        // Keyboard shortcuts — aligned with real VS Code
        document.addEventListener('keydown', (e) => {
            // don't hijack typing in form fields (except Monaco's own hidden input)
            if (e.target && ['INPUT','TEXTAREA'].includes(e.target.tagName) && !e.target.closest('#monaco-editor')) return;
            const mod = e.ctrlKey || e.metaKey;
            if (!mod) {
                if (e.key === 'F1') { e.preventDefault(); this.showPalette('cmd'); }
                return;
            }
            const k = e.key.toLowerCase();
            if (e.shiftKey) {
                switch (k) {
                    case 'p': e.preventDefault(); this.showPalette('cmd'); return;       // Command Palette
                    case 'e': e.preventDefault(); this.toggleExplorerFocus(); return;    // Focus sidebar
                    case 'f': e.preventDefault(); this.showSearchView(); return;         // Search in files
                    case 'g': e.preventDefault(); this.showGit(); return;                // Source control
                    case 'v': e.preventDefault(); this.togglePreview(); return;          // Preview
                    case 'z': return; // let Monaco handle Ctrl+Shift+Z (redo)
                }
            }
            switch (k) {
                case '`': e.preventDefault(); this.toggleBottomPanel(); break;           // Terminal
                case 'p': e.preventDefault(); this.showPalette('files'); break;          // Quick Open
                case 'b': e.preventDefault(); this.collapseExplorer(); break;            // Sidebar
                case 'g': e.preventDefault(); this.goToLine(); break;                    // Go to line
                case 'w': e.preventDefault(); if (this.currentFile) this.closeTab(this.currentFile); break;
                case 's': e.preventDefault(); this.saveFile(); break;
                case 'n': e.preventDefault(); this.newFile(); break;
                case 'o': e.preventDefault(); this.openProject(); break;
                case 'f': e.preventDefault(); this.editor.getAction('actions.find').run(); break;
                case 'h': e.preventDefault(); this.findAndReplace(); break;
                case '/': e.preventDefault(); this.toggleComment(); break;
                case 'k': e.preventDefault(); this.formatCode(); break;
            }
        });
        
        // Detect virtual keyboard open/close (mobile) and free up screen space
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => {
                const open = window.visualViewport.height < window.innerHeight * 0.65;
                document.body.classList.toggle('keyboard-open', open);
            });
        }

        // Handle visibility change (auto-save)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.settings.autoSave !== 'off') {
                this.saveFile();
            }
        });
        
        // Don't lose in-progress edits on refresh/close
        window.addEventListener('beforeunload', () => {
            if (this.currentFile && this.editor) {
                const current = this.fileSystem.get(this.currentFile);
                if (current) current.content = this.editor.getValue();
            }
            this.saveProjectToDB();
        });
    }
    
    // ============================================
    // LOADING & UI
    // ============================================
    hideLoading() {
        const loadingScreen = document.getElementById('loadingScreen');
        const progressBar = document.getElementById('loadingProgress');
        
        // Simulate loading progress
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 30;
            if (progress >= 100) {
                progress = 100;
                clearInterval(interval);
                setTimeout(() => {
                    loadingScreen.classList.add('hidden');
                    document.getElementById('welcomeScreen').classList.add('active');
                }, 300);
            }
            progressBar.style.width = progress + '%';
        }, 200);
    }
    
    // ============================================
    // FILE SYSTEM
    // ============================================
    renderFileTree() {
        const tree = document.getElementById('fileTree');
        tree.innerHTML = '';
        const root = this.buildFileTree();
        this.renderTreeNode(root, tree, 0);
    }
    
    // Groups the flat fileSystem Map (keys are full paths like "src/utils/x.js")
    // into a real nested tree so folders can contain files and other folders.
    buildFileTree() {
        const root = { type: 'folder', name: '', path: '', children: new Map() };
        
        const ensureFolder = (path) => {
            if (!path) return root;
            const parts = path.split('/');
            let node = root;
            let cur = '';
            for (const part of parts) {
                cur = cur ? `${cur}/${part}` : part;
                if (!node.children.has(part)) {
                    node.children.set(part, { type: 'folder', name: part, path: cur, children: new Map() });
                }
                node = node.children.get(part);
            }
            return node;
        };
        
        // Explicit folders first (so empty folders still show up)
        this.fileSystem.forEach((data, path) => {
            if (data.type === 'folder') ensureFolder(path);
        });
        
        // Files create any missing intermediate folders implicitly
        this.fileSystem.forEach((data, path) => {
            if (data.type !== 'file') return;
            const parts = path.split('/');
            const fileName = parts.pop();
            const parentNode = ensureFolder(parts.join('/'));
            parentNode.children.set(fileName, { type: 'file', name: fileName, path, data });
        });
        
        return root;
    }
    
    renderTreeNode(node, container, depth) {
        const folders = [];
        const files = [];
        node.children.forEach(child => (child.type === 'folder' ? folders : files).push(child));
        folders.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => a.name.localeCompare(b.name));
        
        folders.forEach(folder => {
            const expanded = this.expandedFolders.has(folder.path);
            const item = document.createElement('div');
            item.className = `file-item folder ${folder.path === this.selectedFolder ? 'active' : ''}`;
            item.dataset.path = folder.path;
            item.style.paddingLeft = `${8 + depth * 16}px`;
            item.innerHTML = `
                <span class="file-icon">
                    <i class="fas fa-chevron-${expanded ? 'down' : 'right'}" style="font-size: 9px; width: 10px; display: inline-block;"></i>
                    <i class="fas fa-folder${expanded ? '-open' : ''}" style="color: #dcb67a;"></i>
                </span>
                <span class="file-name">${this.escapeHtml(folder.name)}</span>
            `;
            item.onclick = (e) => {
                e.stopPropagation();
                this.toggleFolder(folder.path);
            };
            container.appendChild(item);
            
            if (expanded) {
                this.renderTreeNode(folder, container, depth + 1);
            }
        });
        
        files.forEach(file => {
            const item = document.createElement('div');
            item.className = `file-item ${file.path === this.currentFile ? 'active' : ''}`;
            item.dataset.path = file.path;
            item.style.paddingLeft = `${8 + (depth + 1) * 16}px`;
            
            const icon = this.getFileIcon(file.name);
            
            item.innerHTML = `
                <span class="file-icon">${icon}</span>
                <span class="file-name">${this.escapeHtml(file.name)}</span>
                ${file.data.modified ? '<span class="file-modified"></span>' : ''}
            `;
            
            item.onclick = () => {
                this.openFile(file.path);
                // explorer is a fixed overlay on phones — hide it once a file is picked
                if (window.innerWidth <= 768 && !document.getElementById('explorerPanel').classList.contains('collapsed')) {
                    document.getElementById('explorerPanel').classList.add('collapsed');
                }
            };
            item.ondblclick = () => this.openFile(file.path);
            
            container.appendChild(item);
        });
    }
    
    // Expands/collapses a folder in the Explorer and marks it as the target
    // for "New File" / "New Folder" (toolbar buttons create inside it).
    toggleFolder(path) {
        if (this.expandedFolders.has(path)) {
            this.expandedFolders.delete(path);
        } else {
            this.expandedFolders.add(path);
        }
        this.selectedFolder = path;
        this.renderFileTree();
    }
    
    // Walks up from a context-menu target (file or folder) to find the
    // folder path that "New File Here" / "New Folder Here" should use.
    getContextFolder() {
        if (!this.contextTarget) return this.selectedFolder;
        const target = this.fileSystem.get(this.contextTarget);
        if (target && target.type === 'folder') return this.contextTarget;
        const parts = this.contextTarget.split('/');
        parts.pop();
        return parts.join('/');
    }
    
    getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const icons = {
            html: '<i class="fab fa-html5" style="color: #e34c26;"></i>',
            htm: '<i class="fab fa-html5" style="color: #e34c26;"></i>',
            css: '<i class="fab fa-css3-alt" style="color: #264de4;"></i>',
            scss: '<i class="fab fa-sass" style="color: #cc6699;"></i>',
            sass: '<i class="fab fa-sass" style="color: #cc6699;"></i>',
            less: '<i class="fab fa-less" style="color: #1d365d;"></i>',
            js: '<i class="fab fa-js" style="color: #f7df1e;"></i>',
            jsx: '<i class="fab fa-react" style="color: #61dafb;"></i>',
            ts: '<i class="fab fa-js" style="color: #3178c6;"></i>',
            tsx: '<i class="fab fa-react" style="color: #61dafb;"></i>',
            json: '<i class="fas fa-cog" style="color: #d4d4d4;"></i>',
            md: '<i class="fas fa-book" style="color: #fff;"></i>',
            py: '<i class="fab fa-python" style="color: #3776ab;"></i>',
            java: '<i class="fab fa-java" style="color: #007396;"></i>',
            php: '<i class="fab fa-php" style="color: #777bb4;"></i>',
            rb: '<i class="fas fa-gem" style="color: #cc342d;"></i>',
            go: '<i class="fab fa-golang" style="color: #00add8;"></i>',
            rs: '<i class="fab fa-rust" style="color: #dea584;"></i>',
            vue: '<i class="fab fa-vuejs" style="color: #4fc08d;"></i>',
            angular: '<i class="fab fa-angular" style="color: #dd0031;"></i>',
            png: '<i class="fas fa-image" style="color: #4ec9b0;"></i>',
            jpg: '<i class="fas fa-image" style="color: #4ec9b0;"></i>',
            jpeg: '<i class="fas fa-image" style="color: #4ec9b0;"></i>',
            gif: '<i class="fas fa-image" style="color: #4ec9b0;"></i>',
            svg: '<i class="fas fa-image" style="color: #4ec9b0;"></i>',
            ico: '<i class="fas fa-image" style="color: #4ec9b0;"></i>',
            xml: '<i class="fas fa-code" style="color: #ff6600;"></i>',
            sql: '<i class="fas fa-database" style="color: #f29111;"></i>',
            yaml: '<i class="fas fa-file-code" style="color: #cb171e;"></i>',
            yml: '<i class="fas fa-file-code" style="color: #cb171e;"></i>',
            dockerfile: '<i class="fab fa-docker" style="color: #2496ed;"></i>',
            gitignore: '<i class="fab fa-git-alt" style="color: #f05032;"></i>'
        };
        return icons[ext] || '<i class="fas fa-file" style="color: var(--text-secondary);"></i>';
    }
    
    getLanguage(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const langs = {
            html: 'html', htm: 'html',
            css: 'css', scss: 'scss', sass: 'sass', less: 'less',
            js: 'javascript', jsx: 'javascript',
            ts: 'typescript', tsx: 'typescript',
            json: 'json',
            md: 'markdown',
            py: 'python',
            java: 'java',
            php: 'php',
            rb: 'ruby',
            go: 'go',
            rs: 'rust',
            vue: 'html',
            xml: 'xml',
            sql: 'sql',
            yaml: 'yaml', yml: 'yaml',
            dockerfile: 'dockerfile',
            sh: 'shell', bash: 'shell', zsh: 'shell'
        };
        return langs[ext] || 'plaintext';
    }
    
    openFile(filename) {
        const file = this.fileSystem.get(filename);
        if (!file || file.type === 'folder') return;
        
        // Save current file before switching
        if (this.currentFile) {
            const current = this.fileSystem.get(this.currentFile);
            if (current) {
                current.content = this.editor.getValue();
            }
        }
        
        this.currentFile = filename;
        
        // New files/folders created via the toolbar default to this file's folder,
        // and every ancestor folder is expanded so the open file is visible
        const parts = filename.split('/');
        parts.pop();
        this.selectedFolder = parts.join('/');
        let cur = '';
        for (const part of parts) {
            cur = cur ? `${cur}/${part}` : part;
            this.expandedFolders.add(cur);
        }
        
        if (!this.openFiles.includes(filename)) {
            this.openFiles.push(filename);
        }
        
        this.editor.setModel(this.getModelFor(filename)); // VS Code-style: one model per file -> cross-file IntelliSense
        
        this.renderTabs();
        this.renderFileTree();
        document.getElementById('fileLanguage').textContent = this.getLanguage(filename).toUpperCase();
    }
    
    renderTabs() {
        const tabsBar = document.getElementById('tabsBar');
        tabsBar.innerHTML = '';
        
        this.openFiles.forEach(filename => {
            const file = this.fileSystem.get(filename);
            const baseName = filename.split('/').pop();
            const tab = document.createElement('div');
            tab.className = `tab ${filename === this.currentFile ? 'active' : ''} ${file?.modified ? 'tab-unsaved' : ''}`;
            tab.title = filename;
            tab.innerHTML = `
                <span class="tab-icon">${this.getFileIcon(baseName)}</span>
                <span class="tab-name">${this.escapeHtml(baseName)}</span>
                <span class="tab-close" onclick="event.stopPropagation(); app.closeTab('${filename}')">
                    <i class="fas fa-times"></i>
                </span>
            `;
            tab.onclick = () => this.openFile(filename);
            tabsBar.appendChild(tab);
        });
    }
    
    closeTab(filename) {
        // persist the latest edits of the tab being closed into the file system
        const closing = this.fileSystem.get(filename);
        if (closing && this.currentFile === filename && this.editor) closing.content = this.editor.getValue();
        const index = this.openFiles.indexOf(filename);
        this.openFiles = this.openFiles.filter(f => f !== filename);
        const model = this.monacoModels.get(filename);
        this.monacoModels.delete(filename);

        if (this.currentFile === filename) {
            if (this.openFiles.length > 0) {
                this.openFile(this.openFiles[Math.min(index, this.openFiles.length - 1)]);
            } else {
                this.currentFile = null;
                this.editor.setModel(this.getWelcomeModel());
                document.getElementById('fileLanguage').textContent = 'Plain Text';
            }
        }
        model?.dispose();
        this.renderTabs();
    }
    
    highlightFileInTree(filename) {
        document.querySelectorAll('.file-item').forEach(item => {
            item.classList.toggle('active', item.dataset.path === filename);
        });
    }
    
    markFileAsModified(filename) {
        const file = this.fileSystem.get(filename);
        if (file && !file.modified) {
            file.modified = true;
            this.renderTabs();
            this.renderFileTree();
        }
    }
    
    saveFile() {
        if (!this.currentFile) return;
        
        const file = this.fileSystem.get(this.currentFile);
        if (file) {
            file.content = this.editor.getValue();
            file.modified = false;
            this.renderTabs();
            this.renderFileTree();
            this.showToast('File saved', 'success');
            
            // Save this file, and persist the whole project so nothing is lost on reload
            this.saveToIndexedDB(this.currentFile, file.content);
            this.saveProjectToDB();
            
            // Keep live preview in sync with real, saved code
            if (document.getElementById('previewPanel')?.classList.contains('open')) {
                this.runCode();
            }
        }
    }
    
    debouncedSave() {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => this.saveFile(), 1000);
    }
    
    // ============================================
    // INDEXEDDB STORAGE
    // ============================================
    async saveToIndexedDB(path, content) {
        try {
            const db = await this.openDB();
            await this.idbRequest(db, 'files', 'readwrite', (store) =>
                store.put({ path, content, timestamp: Date.now() })
            );
        } catch (err) {
            console.error('IndexedDB save error:', err);
        }
    }
    
    async loadFromIndexedDB(path) {
        try {
            const db = await this.openDB();
            return await this.idbRequest(db, 'files', 'readonly', (store) => store.get(path));
        } catch (err) {
            console.error('IndexedDB load error:', err);
            return null;
        }
    }
    
    openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('code-studio-db', 2);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('files')) {
                    db.createObjectStore('files', { keyPath: 'path' });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
                if (db.objectStoreNames.contains('projects')) {
                    db.deleteObjectStore('projects');
                }
                db.createObjectStore('projects', { keyPath: 'id' });
            };
        });
    }
    
    // Wrap a single IDBRequest in a real Promise so callers can safely await it
    idbRequest(db, storeName, mode, action) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const req = action(store);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    
    // ============================================
    // REAL PROJECT PERSISTENCE (IndexedDB)
    // ============================================
    async saveProjectToDB() {
        try {
            const db = await this.openDB();
            const files = {};
            this.fileSystem.forEach((data, name) => {
                files[name] = data;
            });
            await this.idbRequest(db, 'projects', 'readwrite', (store) =>
                store.put({
                    id: this.projectName,
                    name: this.projectName,
                    files,
                    timestamp: Date.now()
                })
            );
            localStorage.setItem('code-studio-last-project', this.projectName);
        } catch (err) {
            console.error('Project save error:', err);
        }
    }
    
    async loadProjectFromDB(name) {
        try {
            const db = await this.openDB();
            return await this.idbRequest(db, 'projects', 'readonly', (store) => store.get(name));
        } catch (err) {
            console.error('Project load error:', err);
            return null;
        }
    }
    
    async listProjectsFromDB() {
        try {
            const db = await this.openDB();
            const all = await this.idbRequest(db, 'projects', 'readonly', (store) => store.getAll());
            return (all || []).sort((a, b) => b.timestamp - a.timestamp);
        } catch (err) {
            console.error('List projects error:', err);
            return [];
        }
    }
    
    async deleteProjectFromDB(name) {
        try {
            const db = await this.openDB();
            await this.idbRequest(db, 'projects', 'readwrite', (store) => store.delete(name));
        } catch (err) {
            console.error('Delete project error:', err);
        }
    }
    
    async loadProjectByName(name) {
        const record = await this.loadProjectFromDB(name);
        if (!record) {
            this.showToast('Project not found', 'error');
            return;
        }
        this.projectName = record.name;
        this.disposeAllModels();
        this.fileSystem = new Map(Object.entries(record.files));
        this.openFiles = [];
        this.currentFile = null;
        localStorage.setItem('code-studio-last-project', record.name);
        
        document.getElementById('welcomeScreen').classList.remove('active');
        document.getElementById('appContainer').style.display = 'flex';
        
        this.renderFileTree();
        const names = Array.from(this.fileSystem.keys());
        const first = this.fileSystem.has('index.html') ? 'index.html' : names.find(n => this.fileSystem.get(n).type === 'file');
        if (first) this.openFile(first);
        this.showToast(`Opened "${record.name}"`, 'success');
    }
    
    formatRelativeTime(timestamp) {
        const diffMs = Date.now() - timestamp;
        const mins = Math.floor(diffMs / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
        const days = Math.floor(hours / 24);
        if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
        return new Date(timestamp).toLocaleDateString();
    }
    
    // ============================================
    // FILE CREATION
    // ============================================
    newFile() {
        document.getElementById('newFileName').value = '';
        document.getElementById('fileTemplate').value = '';
        document.getElementById('newFileLocationHint').textContent =
            `Creating in: /${this.selectedFolder || ''} — type a path with "/" to place it elsewhere`;
        document.getElementById('newFileModal').classList.add('active');
        setTimeout(() => document.getElementById('newFileName').focus(), 100);
    }
    
    createNewFile() {
        const rawName = document.getElementById('newFileName').value.trim();
        const template = document.getElementById('fileTemplate').value;
        
        if (!rawName) return;
        
        // A typed path with "/" is used as-is; otherwise it's placed inside
        // whichever folder is currently selected (or the root).
        const name = rawName.includes('/')
            ? rawName.replace(/^\/+/, '')
            : (this.selectedFolder ? `${this.selectedFolder}/${rawName}` : rawName);
        
        if (this.fileSystem.has(name)) {
            this.showToast('File already exists!', 'error');
            return;
        }
        
        let content = '';
        switch(template) {
            case 'html':
                content = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
</head>
<body>
    
</body>
</html>`;
                break;
            case 'css':
                content = `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Inter', sans-serif;
}`;
                break;
            case 'js':
                content = `// JavaScript module

function init() {
    console.log('Initialized!');
}

init();`;
                break;
            case 'react':
                content = `import React from 'react';

function App() {
    return (
        <div className="app">
            <h1>Hello React!</h1>
        </div>
    );
}

export default App;`;
                break;
            case 'vue':
                content = `<template>
    <div class="app">
        <h1>{{ message }}</h1>
    </div>
</template>

<script>
export default {
    data() {
        return {
            message: 'Hello Vue!'
        }
    }
}
<\/script>

<style scoped>
.app {
    text-align: center;
}
</style>`;
                break;
        }
        
        this.fileSystem.set(name, {
            type: 'file',
            content: content,
            language: this.getLanguage(name),
            modified: false
        });
        
        // Auto-expand every ancestor folder so the new file is visible
        const ancestorParts = name.split('/');
        let cur = '';
        for (let i = 0; i < ancestorParts.length - 1; i++) {
            cur = cur ? `${cur}/${ancestorParts[i]}` : ancestorParts[i];
            this.expandedFolders.add(cur);
        }
        
        this.renderFileTree();
        this.openFile(name);
        this.closeModal('newFileModal');
        this.showToast(`Created ${name}`, 'success');
        this.saveProjectToDB();
    }
    
    newFolder() {
        document.getElementById('newFolderName').value = '';
        document.getElementById('newFolderLocationHint').textContent =
            `Creating in: /${this.selectedFolder || ''} — type a path with "/" to nest it deeper`;
        document.getElementById('newFolderModal').classList.add('active');
        setTimeout(() => document.getElementById('newFolderName').focus(), 100);
    }
    
    createNewFolder() {
        const rawName = document.getElementById('newFolderName').value.trim();
        if (!rawName) return;
        
        const name = rawName.includes('/')
            ? rawName.replace(/^\/+/, '')
            : (this.selectedFolder ? `${this.selectedFolder}/${rawName}` : rawName);
        
        if (this.fileSystem.has(name)) {
            this.showToast('Already exists!', 'error');
            return;
        }
        
        this.fileSystem.set(name, {
            type: 'folder',
            content: null,
            modified: false
        });
        
        const ancestorParts = name.split('/');
        let cur = '';
        for (let i = 0; i < ancestorParts.length - 1; i++) {
            cur = cur ? `${cur}/${ancestorParts[i]}` : ancestorParts[i];
            this.expandedFolders.add(cur);
        }
        this.expandedFolders.add(name);
        this.selectedFolder = name;
        
        this.renderFileTree();
        this.closeModal('newFolderModal');
        this.showToast(`Created folder ${name}`, 'success');
        this.saveProjectToDB();
    }
    
    // ============================================
    // PREVIEW
    // ============================================
    togglePreview() {
        const panel = document.getElementById('previewPanel');
        panel.classList.toggle('open');
        if (panel.classList.contains('open')) {
            this.runCode();
        }
    }
    
    runCode() {
        // Find an entry HTML file: prefer index.html, else the first .html file
        const names = Array.from(this.fileSystem.keys());
        const htmlName = this.fileSystem.has('index.html')
            ? 'index.html'
            : names.find(n => this.fileSystem.get(n).type === 'file' && /\.html?$/i.test(n));
        
        if (!htmlName) {
            this.showToast('No HTML file found!', 'error');
            return;
        }
        
        // Sync the file currently open in the editor before building the preview,
        // so unsaved-but-typed changes still show up live.
        if (this.currentFile) {
            const current = this.fileSystem.get(this.currentFile);
            if (current && this.editor) current.content = this.editor.getValue();
        }
        
        let html = this.fileSystem.get(htmlName).content;
        
        const resolveLocal = (path) => {
            const clean = path.replace(/^\.?\//, '');
            return this.fileSystem.get(clean) || this.fileSystem.get(path);
        };
        
        // Inline every local <link rel="stylesheet" href="*.css">
        html = html.replace(/<link[^>]*href=["']([^"':]+\.css)["'][^>]*>/gi, (match, href) => {
            const cssFile = resolveLocal(href);
            return cssFile ? `<style>\n${cssFile.content}\n</style>` : match;
        });
        
        // Inline every local <script src="*.js"></script> (order preserved)
        html = html.replace(/<script[^>]*src=["']([^"':]+\.js)["'][^>]*><\/script>/gi, (match, src) => {
            const jsFile = resolveLocal(src);
            return jsFile ? `<script>\n${jsFile.content}\n<\/script>` : match;
        });
        
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        
        // Free the previous preview blob so memory doesn't grow on every keystroke
        if (this.lastPreviewUrl) {
            URL.revokeObjectURL(this.lastPreviewUrl);
        }
        this.lastPreviewUrl = url;
        
        const frame = document.getElementById('previewFrame');
        if (frame) frame.src = url;
        
        const mobileFrame = document.getElementById('mobilePreview');
        const mobilePanel = document.getElementById('mobilePanel');
        if (mobileFrame && mobilePanel && mobilePanel.classList.contains('open')) {
            mobileFrame.src = url;
        }
        
        this.showToast('Preview updated', 'info');
    }
    
    refreshPreview() {
        this.runCode();
    }
    
    openInNewTab() {
        const frame = document.getElementById('previewFrame');
        window.open(frame.src, '_blank');
    }
    
    toggleDeviceMode() {
        this.showToast('Device mode toggle (demo)', 'info');
    }
    
    // ============================================
    // MOBILE BUILDER
    // ============================================
    toggleMobilePanel() {
        document.getElementById('mobilePanel').classList.toggle('open');
        if (document.getElementById('mobilePanel').classList.contains('open')) {
            this.runCode();
        }
    }
    
    selectPlatform(platform, element) {
        document.querySelectorAll('.device-option').forEach(el => el.classList.remove('active'));
        element.classList.add('active');
        
        const apkBtn = document.getElementById('buildApkBtn');
        const aabBtn = document.getElementById('buildAabBtn');
        
        if (platform === 'ios') {
            apkBtn.innerHTML = '<i class="fas fa-hammer"></i> Build IPA';
            aabBtn.style.display = 'none';
        } else {
            apkBtn.innerHTML = '<i class="fas fa-hammer"></i> Build APK';
            aabBtn.style.display = 'flex';
        }
    }
    
    changeDevice() {
        const device = document.getElementById('deviceSelect').value;
        const frame = document.getElementById('deviceFrame');
        
        const sizes = {
            iphone14: { width: '260px', height: '540px' },
            iphoneSE: { width: '220px', height: '400px' },
            pixel7: { width: '250px', height: '520px' },
            samsungS23: { width: '255px', height: '530px' },
            ipad: { width: '340px', height: '450px' }
        };
        
        const size = sizes[device];
        if (size) {
            frame.style.width = size.width;
            frame.style.height = size.height;
        }
    }
    
    async buildAPK() {
        const progress = document.getElementById('buildProgress');
        const fill = document.getElementById('progressFill');
        const text = document.getElementById('progressText');
        const btn = document.getElementById('buildApkBtn');
        
        btn.disabled = true;
        progress.classList.add('active');
        
        const steps = [
            { pct: 15, msg: 'Packaging your project files...' },
            { pct: 40, msg: 'Writing package.json...' },
            { pct: 65, msg: 'Writing capacitor.config.json...' },
            { pct: 90, msg: 'Zipping build-ready source...' },
            { pct: 100, msg: 'Source package ready!' }
        ];
        
        for (const step of steps) {
            await this.delay(500);
            fill.style.width = step.pct + '%';
            text.textContent = step.msg;
        }
        
        await this.createDownloadableBuild('apk');
        
        progress.classList.remove('active');
        fill.style.width = '0%';
        btn.disabled = false;
        
        this.showToast('Downloaded a real, buildable Capacitor project — see the README inside for how to compile the actual APK.', 'success');
    }
    
    async buildAAB() {
        const progress = document.getElementById('buildProgress');
        const fill = document.getElementById('progressFill');
        const text = document.getElementById('progressText');
        const btn = document.getElementById('buildAabBtn');
        
        btn.disabled = true;
        progress.classList.add('active');
        
        const steps = [
            { pct: 15, msg: 'Packaging your project files...' },
            { pct: 40, msg: 'Writing package.json...' },
            { pct: 65, msg: 'Writing capacitor.config.json...' },
            { pct: 90, msg: 'Zipping build-ready source...' },
            { pct: 100, msg: 'Source package ready!' }
        ];
        
        for (const step of steps) {
            await this.delay(500);
            fill.style.width = step.pct + '%';
            text.textContent = step.msg;
        }
        
        await this.createDownloadableBuild('aab');
        
        progress.classList.remove('active');
        fill.style.width = '0%';
        btn.disabled = false;
        
        this.showToast('Downloaded a real, buildable Capacitor project — see the README inside for how to compile the actual AAB.', 'success');
    }
    
    // Builds a real, buildable Capacitor project (source files, not a compiled
    // binary — an actual APK/AAB requires the Android SDK + Gradle, which can't
    // run inside a browser). The zip can be built with `npm install && npm run
    // build:android` (or build:aab / build:ios) on a real machine.
    async createDownloadableBuild(type) {
        if (typeof JSZip === 'undefined') {
            this.showToast('ZIP support failed to load. Check your connection.', 'error');
            return;
        }
        
        const zip = new JSZip();
        const safeName = (this.projectName || 'my-app').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-app';
        const appId = `com.codestudio.${safeName.replace(/-/g, '')}`;
        
        // 1. www/ — the actual project files the user wrote
        const wwwFolder = zip.folder('www');
        this.fileSystem.forEach((data, name) => {
            if (data.type === 'file') {
                wwwFolder.file(name, data.content);
            }
        });
        
        // 2. package.json — scripts to sync + build with Capacitor
        zip.file('package.json', JSON.stringify({
            name: safeName,
            version: '1.0.0',
            description: `${this.projectName} — built with Code Studio Pro`,
            scripts: {
                sync: 'npx cap sync',
                'build:android': 'npx cap sync android && cd android && ./gradlew assembleDebug',
                'build:android-release': 'npx cap sync android && cd android && ./gradlew assembleRelease',
                'build:aab': 'npx cap sync android && cd android && ./gradlew bundleRelease',
                'build:ios': "npx cap sync ios && cd ios/App && xcodebuild -scheme App -destination 'platform=iOS Simulator,name=iPhone 14'",
                'open:android': 'npx cap open android',
                'open:ios': 'npx cap open ios'
            },
            dependencies: {
                '@capacitor/core': '^5.0.0',
                '@capacitor/android': '^5.0.0',
                '@capacitor/ios': '^5.0.0'
            },
            devDependencies: {
                '@capacitor/cli': '^5.0.0'
            }
        }, null, 2));
        
        // 3. capacitor.config.json — points Capacitor at the www/ folder above
        zip.file('capacitor.config.json', JSON.stringify({
            appId,
            appName: this.projectName || 'My App',
            webDir: 'www',
            bundledWebRuntime: false,
            server: { androidScheme: 'https' }
        }, null, 2));
        
        // 4. README with exact next steps, since no binary is produced here
        zip.file('README.md', `# ${this.projectName}

This is a real, buildable Capacitor project generated from your Code Studio Pro
project. It contains your actual source files — it is **not** a compiled
${type.toUpperCase()}. Building a real ${type.toUpperCase()} needs the Android
SDK and Gradle, which can't run inside a browser.

## To build a real ${type.toUpperCase()}

1. Install Node.js, then in this folder run:
   \`\`\`
   npm install
   npx cap add android
   npm run build:${type === 'aab' ? 'aab' : 'android'}
   \`\`\`
2. Install [Android Studio](https://developer.android.com/studio) if you don't
   have the Android SDK / Gradle already.
3. The output ${type.toUpperCase()} will be under \`android/app/build/outputs/\`.

For iOS, use \`npx cap add ios\` and \`npm run build:ios\` on a Mac with Xcode.
`);
        
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeName}-capacitor-src.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    exportProject() {
        const exportData = {
            name: this.projectName,
            version: '1.0.0',
            created: new Date().toISOString(),
            files: {}
        };
        
        this.fileSystem.forEach((data, name) => {
            if (data.type === 'file') {
                exportData.files[name] = data.content;
            }
        });
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.projectName}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showToast('Project exported!', 'success');
    }
    
    importProject() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.zip,.txt';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            if (file.name.toLowerCase().endsWith('.zip')) {
                await this.importProjectFromZip(file);
                return;
            }
            
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    if (data.files) {
                        this.fileSystem.clear();
                        this.openFiles = [];
                        this.currentFile = null;
                        
                        Object.entries(data.files).forEach(([name, content]) => {
                            this.fileSystem.set(name, {
                                type: 'file',
                                content: content,
                                language: this.getLanguage(name),
                                modified: false
                            });
                        });
                        
                        this.projectName = data.name || 'imported-project';
                        this.renderFileTree();
                        
                        document.getElementById('welcomeScreen').classList.remove('active');
                        document.getElementById('appContainer').style.display = 'flex';
                        
                        const first = this.fileSystem.has('index.html') ? 'index.html' : Array.from(this.fileSystem.keys())[0];
                        if (first) this.openFile(first);
                        
                        await this.saveProjectToDB();
                        this.showToast('Project imported!', 'success');
                    }
                } catch (err) {
                    this.showToast('Invalid project file', 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }
    
    async importProjectFromZip(file) {
        if (typeof JSZip === 'undefined') {
            this.showToast('ZIP support failed to load. Check your connection.', 'error');
            return;
        }
        try {
            const zip = await JSZip.loadAsync(file);
            this.fileSystem.clear();
            this.openFiles = [];
            this.currentFile = null;
            
            const entries = Object.values(zip.files).filter(f => !f.dir);
            const textExt = /\.(html?|css|scss|sass|less|js|jsx|ts|tsx|json|md|py|java|php|rb|go|rs|vue|xml|sql|yaml|yml|txt|gitignore)$/i;
            
            for (const entry of entries) {
                // If everything lives under one top-level folder, drop that folder
                // so paths match how this editor stores files (flat, relative names)
                const parts = entry.name.split('/');
                const name = parts.length > 1 ? parts.slice(1).join('/') : entry.name;
                if (!name) continue;
                
                if (textExt.test(name)) {
                    const content = await entry.async('string');
                    this.fileSystem.set(name, {
                        type: 'file',
                        content,
                        language: this.getLanguage(name),
                        modified: false
                    });
                }
                // Binary assets (images, fonts) are skipped: this editor's virtual
                // file system stores text content only.
            }
            
            this.projectName = file.name.replace(/\.zip$/i, '') || 'imported-project';
            this.renderFileTree();
            
            document.getElementById('welcomeScreen').classList.remove('active');
            document.getElementById('appContainer').style.display = 'flex';
            
            const first = this.fileSystem.has('index.html') ? 'index.html' : Array.from(this.fileSystem.keys())[0];
            if (first) this.openFile(first);
            
            await this.saveProjectToDB();
            this.showToast(`Imported ${this.fileSystem.size} file(s) from ZIP`, 'success');
        } catch (err) {
            console.error('ZIP import error:', err);
            this.showToast('Failed to read ZIP file', 'error');
        }
    }
    
    // ============================================
    // TERMINAL
    // ============================================
    handleTerminal(e) {
        if (e.key !== 'Enter') return;
        
        const input = e.target;
        const command = input.value.trim();
        
        if (!command) return;
        
        this.terminalHistory.push(command);
        
        const panel = document.getElementById('terminalPanel');
        
        // Add command line
        const cmdLine = document.createElement('div');
        cmdLine.className = 'terminal-line';
        cmdLine.innerHTML = `<span class="terminal-prompt">➜</span><span>${command}</span>`;
        panel.insertBefore(cmdLine, panel.lastElementChild);
        
        // Process command
        const response = this.processCommand(command);
        
        if (response) {
            const respLine = document.createElement('div');
            respLine.className = 'terminal-line';
            respLine.innerHTML = `<span style="width: 20px;"></span><span class="terminal-output ${response.type || ''}">${response.text}</span>`;
            panel.insertBefore(respLine, panel.lastElementChild);
        }
        
        input.value = '';
        panel.scrollTop = panel.scrollHeight;
    }
    
    processCommand(command) {
        const parts = command.split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);
        this.terminalCwd = this.terminalCwd || '';
        // resolve a path argument against the terminal's virtual working directory
        const resolve = (p) => {
            const raw = String(p || '').replace(/^\.?\//, '');
            const segs = (this.terminalCwd ? this.terminalCwd.split('/') : []).concat(raw ? raw.split('/') : []);
            const out = [];
            for (const s of segs) { if (!s || s === '.') continue; if (s === '..') { out.pop(); continue; } out.push(s); }
            return out.join('/');
        };
        const isFolder = (p) => { const d = this.fileSystem.get(p); return !!d && d.type === 'folder'; };
        const ensureFolders = (p) => {
            const segs = p.split('/'); let cur = '';
            for (let i = 0; i < segs.length - 1; i++) {
                cur = cur ? `${cur}/${segs[i]}` : segs[i];
                if (!this.fileSystem.has(cur)) this.fileSystem.set(cur, { type: 'folder', content: null, modified: false });
            }
        };
        const listChildren = (p) => {
            const prefix = p ? p + '/' : '';
            const names = new Set();
            this.fileSystem.forEach((d, path) => {
                if (p && (path === p || !path.startsWith(prefix))) return;
                if (!p && path.includes('/')) { names.add(path.split('/')[0]); return; }
                const rest = p ? path.slice(prefix.length) : path;
                names.add(rest.split('/')[0]);
            });
            return [...names].sort();
        };

        switch (cmd) {
            case 'help':
                return { text: `Available commands (they operate on your project files):
  ls [dir]              List files/folders      pwd         Show current folder
  cd <dir>              Change folder           cat <file>  Show file content
  mkdir <dir>           Create folder           touch <f>   Create empty file
  rm <file|dir>         Delete (recursive)      open <f>    Open file in editor
  echo <text> [> file]  Print or write to file  date        Show date/time
  history               Command history         clear       Clear terminal
  build                 Rebuild the live preview
  export                Export project JSON
  whoami / version      Info` };
            case 'pwd': return { text: '/' + this.terminalCwd };
            case 'cd': {
                const t = resolve(args[0] || '');
                if (t === '' || isFolder(t)) { this.terminalCwd = t; return { text: '/' + t, type: 'success' }; }
                return { text: `cd: no such folder: ${args[0]}`, type: 'error' };
            }
            case 'ls': {
                const t = resolve(args[0] || '');
                if (t !== '' && !isFolder(t)) return { text: `ls: not a folder: ${args[0]}`, type: 'error' };
                return { text: listChildren(t).join('  ') || '(empty)' };
            }
            case 'mkdir': {
                if (!args[0]) return { text: 'Usage: mkdir <folder>', type: 'error' };
                const t = resolve(args[0]);
                ensureFolders(t + '/x'); this.fileSystem.set(t, { type: 'folder', content: null, modified: false });
                this.renderFileTree(); this.saveProjectToDB();
                return { text: `created /${t}`, type: 'success' };
            }
            case 'touch': {
                if (!args[0]) return { text: 'Usage: touch <file>', type: 'error' };
                const t = resolve(args[0]);
                ensureFolders(t);
                if (!this.fileSystem.has(t)) this.fileSystem.set(t, { type: 'file', content: '', language: this.getLanguage(t), modified: false });
                this.renderFileTree(); this.saveProjectToDB();
                return { text: `created /${t}`, type: 'success' };
            }
            case 'rm': {
                if (!args[0]) return { text: 'Usage: rm <file|folder>', type: 'error' };
                const t = resolve(args[0]);
                const target = this.fileSystem.get(t);
                if (!target) return { text: `rm: not found: ${args[0]}`, type: 'error' };
                if (target.type === 'folder') {
                    const prefix = t + '/'; const doomed = [];
                    this.fileSystem.forEach((d, p) => { if (p.startsWith(prefix)) doomed.push(p); });
                    doomed.forEach(p => { this.fileSystem.delete(p); this.closeTab(p); });
                }
                this.fileSystem.delete(t); this.closeTab(t);
                this.renderFileTree(); this.saveProjectToDB();
                return { text: `removed /${t}`, type: 'success' };
            }
            case 'cat': {
                if (!args[0]) return { text: 'Usage: cat <file>', type: 'error' };
                const f = this.fileSystem.get(resolve(args[0]));
                if (!f || f.type !== 'file') return { text: `cat: no such file: ${args[0]}`, type: 'error' };
                return { text: f.content.substring(0, 1500) };
            }
            case 'open': {
                if (!args[0]) return { text: 'Usage: open <file>', type: 'error' };
                const t = resolve(args[0]);
                if (!this.fileSystem.has(t)) return { text: `open: no such file: ${args[0]}`, type: 'error' };
                this.openFile(t); return { text: `opened /${t}`, type: 'success' };
            }
            case 'echo': {
                const gt = args.indexOf('>');
                const append = args.indexOf('>>');
                const idx = append !== -1 ? append : gt;
                if (idx !== -1) {
                    const text = args.slice(0, idx).join(' ');
                    const t = resolve(args[idx + 1]);
                    if (!t) return { text: 'Usage: echo <text> > <file>', type: 'error' };
                    ensureFolders(t);
                    const old = this.fileSystem.get(t)?.content || '';
                    this.fileSystem.set(t, { type: 'file', content: append !== -1 ? old + (old ? '\n' : '') + text : text, language: this.getLanguage(t), modified: true });
                    this.renderFileTree(); this.saveProjectToDB();
                    return { text: `wrote /${t}`, type: 'success' };
                }
                return { text: args.join(' ') };
            }
            case 'history': return { text: this.terminalHistory.slice(-20).map((c, i) => `${i + 1}  ${c}`).join('\n') };
            case 'date': return { text: new Date().toString() };
            case 'clear':
                document.getElementById('terminalPanel').innerHTML = `
                    <div class="terminal-line">
                        <span class="terminal-prompt">➜</span>
                        <div class="terminal-input-wrapper">
                            <input type="text" class="terminal-input" id="terminalInput" placeholder="Type a command..." onkeydown="app.handleTerminal(event)" autocomplete="off" spellcheck="false">
                        </div>
                    </div>`;
                document.getElementById('terminalInput').focus();
                return null;
            case 'build':
                this.runCode();
                return { text: 'Preview rebuilt.', type: 'success' };
            case 'export':
                this.exportProject();
                return { text: 'Project export started (JSON download).', type: 'success' };
            case 'npm':
                if (args[0] === 'start') { this.runCode(); return { text: 'Preview refreshed (this terminal runs against your in-browser project, not a Node process)', type: 'success' }; }
                return { text: `No Node.js runtime in the browser sandbox — 'npm ${args.join(' ')}' cannot run here. Export the project and run npm in a real shell.`, type: 'warning' };
            case 'deploy':
                return { text: 'No hosting connected. Export the project (File → Export) and deploy the static files to Netlify / Vercel / GitHub Pages. See docs/DEPLOYMENT.md.', type: 'warning' };
            case 'whoami': return { text: this.api?.user ? this.api.user.email : 'local-user (no server account)' };
            case 'version': return { text: 'Code Studio Pro v2.0.0' };
            default:
                return { text: `Command not found: ${cmd}. Type 'help' for available commands.`, type: 'error' };
        }
    }
    
    // ============================================
    // UI HELPERS
    // ============================================
    switchSidebar(view, el) {
        document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('active'));
        if (el) el.classList.add('active');
        const searchView = document.getElementById('searchView');
        const tree = document.getElementById('fileTree');
        if (view === 'search') this.showSearchView();
        else if (searchView) { searchView.style.display = 'none'; if (tree) tree.style.display = ''; }
        if (view === 'git') this.showGit();
    }
    
    switchPanel(panel, el) {
        document.querySelectorAll('.panel-tab').forEach(tab => tab.classList.remove('active'));
        if (el) el.classList.add('active');
        
        const content = document.getElementById('panelContent');
        
        switch(panel) {
            case 'terminal':
                content.innerHTML = `
                    <div id="terminalPanel" class="terminal">
                        <div class="terminal-line">
                            <span class="terminal-prompt">➜</span>
                            <div class="terminal-input-wrapper">
                                <input type="text" class="terminal-input" id="terminalInput" placeholder="Type a command..." onkeydown="app.handleTerminal(event)" autocomplete="off" spellcheck="false">
                            </div>
                        </div>
                    </div>
                `;
                break;
            case 'problems':
                content.innerHTML = '<div id="problemsList" style="padding: 8px 12px; font-family: inherit;"></div>';
                this.updateProblems();
                break;
            case 'output':
                content.innerHTML = '<div style="padding: 16px; color: var(--text-secondary);">Build output will appear here...</div>';
                break;
            case 'debug':
                content.innerHTML = '<div style="padding: 16px; color: var(--text-secondary);">Debug console ready...</div>';
                break;
        }
    }
    
    toggleBottomPanel() {
        document.getElementById('bottomPanel').classList.toggle('collapsed');
        const icon = document.getElementById('panelToggleIcon');
        icon.className = document.getElementById('bottomPanel').classList.contains('collapsed') 
            ? 'fas fa-chevron-up' 
            : 'fas fa-chevron-down';
    }
    
    toggleTheme() {
        this.isDarkTheme = !this.isDarkTheme;
        const theme = this.isDarkTheme ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        document.getElementById('themeIcon').className = this.isDarkTheme ? 'fas fa-moon' : 'fas fa-sun';
        
        if (this.editor) {
            monaco.editor.setTheme(this.isDarkTheme ? 'vs-dark' : 'vs');
        }
        
        this.settings.theme = theme;
        this.saveSettings();
    }
    
    collapseExplorer() {
        document.getElementById('explorerPanel').classList.toggle('collapsed');
    }
    
    // ============================================
    // PWA FUNCTIONS
    // ============================================
    showPWAInstallBanner() {
        const dismissed = parseInt(localStorage.getItem('pwa-install-dismissed') || '0', 10);
        if (dismissed && Date.now() - dismissed < 7 * 24 * 3600 * 1000) return;
        if (this.deferredPrompt && !this.isNativeApp) {
            document.getElementById('pwaInstallBanner').classList.add('active');
        }
    }
    
    hidePWAInstallBanner() {
        document.getElementById('pwaInstallBanner').classList.remove('active');
    }
    
    dismissPWAInstall() {
        this.hidePWAInstallBanner();
        // Remember dismissal
        localStorage.setItem('pwa-install-dismissed', Date.now().toString());
    }
    
    async installPWA() {
        if (!this.deferredPrompt) return;
        
        this.deferredPrompt.prompt();
        
        const { outcome } = await this.deferredPrompt.userChoice;
        
        if (outcome === 'accepted') {
            this.showToast('Installing Code Studio Pro...', 'success');
        }
        
        this.deferredPrompt = null;
        this.hidePWAInstallBanner();
    }
    
    // ============================================
    // SETTINGS
    // ============================================
    loadSettings() {
        try {
            const saved = localStorage.getItem('code-studio-settings');
            if (saved) {
                this.settings = { ...this.settings, ...JSON.parse(saved) };
            }
        } catch (err) {
            console.error('Failed to load settings:', err);
        }
    }
    
    saveSettings() {
        try {
            localStorage.setItem('code-studio-settings', JSON.stringify(this.settings));
        } catch (err) {
            console.error('Failed to save settings:', err);
        }
    }
    
    showSettings() {
        document.getElementById('settingsTheme').value = this.settings.theme;
        document.getElementById('settingsFontSize').value = this.settings.fontSize;
        document.getElementById('settingsWordWrap').value = this.settings.wordWrap;
        document.getElementById('settingsAutoSave').value = this.settings.autoSave;
        document.getElementById('settingsModal').classList.add('active');
    }
    
    applySettings() {
        this.settings.theme = document.getElementById('settingsTheme').value;
        this.settings.fontSize = parseInt(document.getElementById('settingsFontSize').value);
        this.settings.wordWrap = document.getElementById('settingsWordWrap').value;
        this.settings.autoSave = document.getElementById('settingsAutoSave').value;
        
        // Apply immediately
        if (this.editor) {
            this.editor.updateOptions({
                fontSize: this.settings.fontSize,
                wordWrap: this.settings.wordWrap
            });
        }
    }
    
    // ============================================
    // PROJECT MANAGEMENT
    // ============================================
    async newProject() {
        const input = prompt('Project name:', 'new-project');
        if (input === null) return; // user cancelled
        const projectName = input.trim() || 'untitled-project';
        
        const existing = await this.loadProjectFromDB(projectName);
        if (existing && !confirm(`A project named "${projectName}" already exists. Overwrite it with a fresh template?`)) {
            return;
        }
        
        this.projectName = projectName;
        this.disposeAllModels();
        this.fileSystem.clear();
        this.openFiles = [];
        this.currentFile = null;
        this.initFileSystem();
        await this.saveProjectToDB();
        
        document.getElementById('welcomeScreen').classList.remove('active');
        document.getElementById('appContainer').style.display = 'flex';
        
        this.openFile('index.html');
        this.showToast(`Project "${projectName}" created!`, 'success');
        this.loadRecentProjects();
    }
    
    async openProject() {
        // Generic "Open Project" button: let the user pick a project by name,
        // or fall back to importing a project file from disk.
        const projects = await this.listProjectsFromDB();
        if (projects.length === 0) {
            this.showToast('No saved projects yet. Importing a file instead...', 'info');
            this.importProject();
            return;
        }
        const names = projects.map(p => p.name).join(', ');
        const choice = prompt(`Type a project name to open (or leave blank to import a file):\n\nSaved projects: ${names}`);
        if (choice === null) return;
        if (!choice.trim()) {
            this.importProject();
            return;
        }
        await this.loadProjectByName(choice.trim());
    }
    
    cloneRepo() {
        const url = prompt('Enter repository URL to clone (e.g. https://github.com/user/repo.git):');
        if (!url || !url.trim()) return;
        this.gitCloneRepo(url.trim());
    }
    
    async loadRecentProjects() {
        const projects = await this.listProjectsFromDB();
        const container = document.getElementById('recentProjectsList');
        if (!container) return;
        container.innerHTML = '';
        
        if (projects.length === 0) {
            container.innerHTML = `<div style="padding: 16px; color: var(--text-secondary); font-size: 13px;">No saved projects yet. Click "New Project" to start — your work is saved automatically as you edit.</div>`;
            return;
        }
        
        projects.forEach(proj => {
            const fileCount = proj.files ? Object.keys(proj.files).length : 0;
            const div = document.createElement('div');
            div.className = 'recent-project';
            div.innerHTML = `
                <div class="recent-project-info">
                    <div class="recent-project-icon"><i class="fas fa-folder"></i></div>
                    <div>
                        <div class="recent-project-name">${proj.name}</div>
                        <div class="recent-project-date">${this.formatRelativeTime(proj.timestamp)} · ${fileCount} file${fileCount === 1 ? '' : 's'}</div>
                    </div>
                </div>
                <i class="fas fa-chevron-right recent-project-arrow"></i>
            `;
            div.onclick = () => this.loadProjectByName(proj.name);
            container.appendChild(div);
        });
    }
    
    // ============================================
    // EDITOR FEATURES
    // ============================================
    formatCode() {
        this.editor.getAction('editor.action.formatDocument').run();
        this.showToast('Code formatted!', 'success');
    }
    
    findAndReplace() {
        this.editor.getAction('editor.action.startFindReplaceAction').run();
    }
    
    toggleComment() {
        this.editor.getAction('editor.action.commentLine').run();
    }
    


    // ============================================
    // LANGUAGE SERVICES — one model per file (VS Code architecture)
    // ============================================
    getModelFor(path) {
        let m = this.monacoModels.get(path);
        if (!m || m.isDisposed()) {
            const content = this.fileSystem.get(path)?.content ?? '';
            m = monaco.editor.createModel(content, this.getLanguage(path), monaco.Uri.parse('inmemory://project/' + path));
            this.monacoModels.set(path, m);
        }
        return m;
    }

    getWelcomeModel() {
        if (!this._welcomeModel || this._welcomeModel.isDisposed())
            this._welcomeModel = monaco.editor.createModel(this.getWelcomeContent(), 'javascript', monaco.Uri.parse('inmemory://welcome'));
        return this._welcomeModel;
    }

    disposeModelsUnder(path) {
        const prefix = path + '/';
        for (const [p, m] of [...this.monacoModels]) {
            if (p === path || p.startsWith(prefix)) { this.monacoModels.delete(p); m.dispose(); }
        }
    }

    disposeAllModels() {
        for (const m of this.monacoModels.values()) m.dispose();
        this.monacoModels.clear();
    }

    // Keyword + snippet completions for languages Monaco ships without a full service.
    // Honest level: this is NOT a language server — for full Python/Java/etc. IntelliSense,
    // deploy an LSP server (see docs/PRODUCTION_READINESS_REPORT.md); until then this
    // provides genuinely useful completions offline.
    registerBasicLanguageProviders() {
        const S = (label, insert) => [label, insert];
        const KW = {
            python: { k: ['def','class','import','from','return','if','elif','else','for','while','try','except','finally','with','as','lambda','pass','break','continue','yield','raise','global','nonlocal','assert','del','in','is','not','and','or','None','True','False','self','async','await'],
                s: [S('def','def ${1:name}(${2:args}):\n    ${0}'), S('class','class ${1:Name}:\n    def __init__(self):\n        ${0}'), S('ifmain',"if __name__ == '__main__':\n    ${0}"), S('for','for ${1:item} in ${2:items}:\n    ${0}'), S('try','try:\n    ${0}\nexcept ${1:Exception} as e:\n    pass')] },
            java: { k: ['public','private','protected','static','void','class','interface','extends','implements','import','package','new','return','if','else','for','while','do','switch','case','break','continue','try','catch','finally','throw','throws','this','super','null','true','false','final','abstract','int','long','double','float','boolean','char','String'],
                s: [S('main','public static void main(String[] args) {\n    ${0}\n}'), S('class','public class ${1:Name} {\n    ${0}\n}'), S('sysout','System.out.println(${0});')] },
            cpp: { k: ['#include','using','namespace','std','int','void','return','if','else','for','while','class','struct','public','private','protected','virtual','override','new','delete','try','catch','throw','const','auto','true','false','nullptr','template','typename'],
                s: [S('main','int main(int argc, char** argv) {\n    ${0}\n    return 0;\n}'), S('class','class ${1:Name} {\npublic:\n    ${0}\n};'), S('cout','std::cout << ${0} << std::endl;')] },
            c: { k: ['int','char','float','double','void','return','if','else','for','while','struct','typedef','static','const','unsigned','sizeof','break','continue','switch','case','default','do','enum','extern','union','include','define'],
                s: [S('main','int main(void) {\n    ${0}\n    return 0;\n}'), S('inc','#include <${1:stdio.h}>')] },
            php: { k: ['function','class','public','private','protected','static','return','if','else','foreach','as','while','try','catch','finally','throw','new','extends','implements','use','namespace','require','include','require_once','include_once','echo','null','true','false','global'],
                s: [S('php','<?php\n${0}\n?>'), S('func','function ${1:name}(${2:$arg}) {\n    ${0}\n}')] },
            go: { k: ['package','import','func','return','if','else','for','range','go','chan','select','defer','struct','interface','type','var','const','make','new','nil','true','false','string','int','error'],
                s: [S('func','func ${1:name}(${2}) ${3:error} {\n    ${0}\n}'), S('main','func main() {\n    ${0}\n}')] },
            rust: { k: ['fn','let','mut','if','else','match','for','while','loop','return','struct','enum','impl','trait','use','mod','pub','crate','self','super','async','await','move','ref','true','false','None','Some','Ok','Err','String','i32','u32','usize','bool'],
                s: [S('fn','fn ${1:name}(${2}) ${3}{\n    ${0}\n}'), S('main','fn main() {\n    ${0}\n}'), S('match','match ${1:expr} {\n    ${2:pattern} => ${0},\n    _ => {},\n}')] },
            ruby: { k: ['def','end','class','module','if','else','elsif','unless','while','until','for','do','each','return','puts','require','attr_accessor','attr_reader','attr_writer','initialize','self','nil','true','false','begin','rescue','ensure','raise','yield'],
                s: [S('def','def ${1:name}\n    ${0}\nend'), S('class','class ${1:Name}\n    def initialize\n        ${0}\n    end\nend')] },
            sql: { k: ['SELECT','FROM','WHERE','INSERT','INTO','VALUES','UPDATE','SET','DELETE','JOIN','LEFT','RIGHT','INNER','OUTER','ON','GROUP','BY','ORDER','HAVING','LIMIT','OFFSET','CREATE','TABLE','DROP','ALTER','ADD','PRIMARY','KEY','FOREIGN','REFERENCES','UNIQUE','NOT','NULL','DEFAULT','COUNT','SUM','AVG','MIN','MAX','AS','AND','OR','LIKE','IN','BETWEEN','IS','DISTINCT','UNION'],
                s: [S('sel','SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:condition};')] },
            sh: { k: ['if','then','else','elif','fi','for','in','do','done','while','case','esac','echo','export','cd','ls','pwd','cat','mkdir','rm','cp','mv','chmod','chown','sudo','source','return','exit','function','local','read','printf'],
                s: [S('if','if [ ${1:condition} ]; then\n    ${0}\nfi'), S('for','for ${1:item} in ${2:list}; do\n    ${0}\ndone')] }
        };
        for (const [lang, def] of Object.entries(KW)) {
            monaco.languages.registerCompletionItemProvider(lang, {
                triggerCharacters: ['.'],
                provideCompletionItems: (model, position) => {
                    const word = model.getWordUntilPosition(position);
                    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
                    return { suggestions: [
                        ...def.k.map(kw => ({ label: kw, kind: monaco.languages.CompletionItemKind.Keyword, insertText: kw, range, detail: lang + ' keyword' })),
                        ...def.s.map(([label, insert]) => ({ label, kind: monaco.languages.CompletionItemKind.Snippet, insertText: insert, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range, detail: lang + ' snippet' }))
                    ] };
                }
            });
        }
    }

    // ============================================
    // COMMAND PALETTE / QUICK OPEN (Ctrl+Shift+P / Ctrl+P)
    // ============================================
    getCommands() {
        const cmds = [
            { label: 'File: New File', hint: 'file', run: () => this.newFile() },
            { label: 'File: New Folder', hint: 'file', run: () => this.newFolder() },
            { label: 'File: Save', hint: 'file', run: () => this.saveFile() },
            { label: 'File: Close Editor', hint: 'file', run: () => this.currentFile && this.closeTab(this.currentFile) },
            { label: 'File: Open Project', hint: 'file', run: () => this.openProject() },
            { label: 'File: Export Project', hint: 'file', run: () => this.exportProject() },
            { label: 'File: Import Project', hint: 'file', run: () => this.importProject() },
            { label: 'Edit: Undo', hint: 'edit', run: () => this.editor?.trigger('palette', 'undo') },
            { label: 'Edit: Redo', hint: 'edit', run: () => this.editor?.trigger('palette', 'redo') },
            { label: 'Edit: Find', hint: 'edit', run: () => this.editor?.getAction('actions.find').run() },
            { label: 'Edit: Replace', hint: 'edit', run: () => this.findAndReplace() },
            { label: 'Edit: Format Document', hint: 'edit', run: () => this.formatCode() },
            { label: 'Edit: Toggle Comment', hint: 'edit', run: () => this.toggleComment() },
            { label: 'Go to Line...', hint: 'go', run: () => this.goToLine() },
            { label: 'View: Toggle Sidebar', hint: 'view', run: () => this.collapseExplorer() },
            { label: 'View: Toggle Preview', hint: 'view', run: () => this.togglePreview() },
            { label: 'View: Toggle Terminal', hint: 'view', run: () => this.toggleBottomPanel() },
            { label: 'View: Toggle Word Wrap', hint: 'view', run: () => {
                this.settings.wordWrap = this.settings.wordWrap === 'off' ? 'on' : 'off';
                this.editor?.updateOptions({ wordWrap: this.settings.wordWrap });
                this.saveSettings();
            } },
            { label: 'View: Toggle Theme', hint: 'view', run: () => this.toggleTheme() },
            { label: 'Run: Run Preview', hint: 'run', run: () => this.runCode() },
            { label: 'Run: Open Preview in New Tab', hint: 'run', run: () => this.openInNewTab() },
            { label: 'Mobile: Open Builder', hint: 'mobile', run: () => this.toggleMobilePanel() },
            { label: 'Git: Open Source Control', hint: 'git', run: () => this.showGit() },
            { label: 'Account: Login / Logout', hint: 'account', run: () => this.showAccount() }
        ];
        if (this.api?.user) cmds.push({ label: 'Sync: Push Current Project to Server', hint: 'sync', run: () => this.syncNow() });
        return cmds;
    }

    fuzzy(query, text) {
        // subsequence match with a small consecutive-run bonus, like VS Code's scorer
        const q = query.toLowerCase(); const t = text.toLowerCase();
        let qi = 0, score = 0, run = 0;
        for (let ti = 0; ti < t.length && qi < q.length; ti++) {
            if (t[ti] === q[qi]) { qi++; run++; score += run; } else run = 0;
        }
        return qi === q.length ? score : -1;
    }

    showPalette(mode = 'files') {
        document.getElementById('paletteOverlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'paletteOverlay';
        overlay.className = 'palette-overlay';
        overlay.innerHTML = `
            <input type="text" class="palette-input" id="paletteInput"
                placeholder="${mode === 'cmd' ? 'Type the name of a command to run...' : 'Search files by name (type > for commands)...'}"
                autocomplete="off" spellcheck="false">
            <div class="palette-list" id="paletteList"></div>`;
        document.body.appendChild(overlay);
        const input = overlay.querySelector('#paletteInput');
        const list = overlay.querySelector('#paletteList');
        let items = [], selected = 0;

        const close = () => { overlay.remove(); document.removeEventListener('click', outside, true); };
        const outside = (e) => { if (!overlay.contains(e.target)) close(); };
        setTimeout(() => document.addEventListener('click', outside, true), 0);

        const refresh = () => {
            const raw = input.value;
            const effMode = raw.startsWith('>') ? 'cmd' : mode;
            const q = raw.startsWith('>') ? raw.slice(1) : raw;
            if (effMode === 'cmd') {
                items = this.getCommands()
                    .map(c => ({ ...c, score: q.trim() ? this.fuzzy(q.trim(), c.label) : 1 }))
                    .filter(c => c.score >= 0).sort((a, b) => b.score - a.score).slice(0, 12);
            } else {
                const files = [];
                this.fileSystem.forEach((d, p) => { if (d.type === 'file') files.push(p); });
                items = files.map(f => ({ label: f, hint: 'file', run: () => this.openFile(f), score: q.trim() ? this.fuzzy(q.trim(), f) : (this.openFiles.includes(f) ? 2 : 1) }))
                    .filter(f => f.score >= 0).sort((a, b) => b.score - a.score).slice(0, 12);
            }
            selected = 0;
            list.innerHTML = items.length ? items.map((it, i) =>
                `<div class="palette-item ${i === selected ? 'active' : ''}" data-i="${i}">
                    <span>${this.escapeHtml(it.label)}</span><span class="p-hint">${this.escapeHtml(it.hint || '')}</span>
                </div>`).join('') : '<div class="palette-item" style="color:var(--text-secondary);">No matching results</div>';
            list.querySelectorAll('.palette-item[data-i]').forEach(el => {
                el.onclick = () => { const it = items[+el.dataset.i]; close(); it.run(); };
                el.onmousemove = () => { selected = +el.dataset.i; highlight(); };
            });
        };
        const highlight = () => list.querySelectorAll('.palette-item[data-i]').forEach(el =>
            el.classList.toggle('active', +el.dataset.i === selected));

        input.addEventListener('input', refresh);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(selected + 1, items.length - 1); highlight(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(selected - 1, 0); highlight(); }
            else if (e.key === 'Enter') { e.preventDefault(); const it = items[selected]; if (it) { close(); it.run(); } }
        });
        refresh();
        input.focus();
    }

    goToLine() {
        const n = parseInt(prompt('Go to line:') || '', 10);
        if (!Number.isFinite(n) || n < 1 || !this.editor) return;
        const line = Math.min(n, this.editor.getModel()?.getLineCount() || 1);
        this.editor.revealLineInCenter(line);
        this.editor.setPosition({ lineNumber: line, column: 1 });
        this.editor.focus();
    }

    toggleExplorerFocus() {
        const ex = document.getElementById('explorerPanel');
        if (ex.classList.contains('collapsed')) this.collapseExplorer(); // reopen
    }

    // ============================================
    // PROBLEMS — real diagnostics from Monaco
    // ============================================
    updateProblems() {
        const badge = document.getElementById('problemsBadge');
        const listEl = document.getElementById('problemsList');
        if (!this.editor || typeof monaco === 'undefined') return;
        const flat = [];
        for (const entry of monaco.editor.getModelMarkers({})) {
            const path = decodeURIComponent(entry.resource.path || '').replace(/^\//, '');
            for (const m of entry.markers) flat.push({ path, ...m });
        }
        if (badge) badge.textContent = flat.length;
        if (!listEl) return;
        if (!flat.length) {
            listEl.innerHTML = '<div style="padding:8px;color:var(--success);"><i class="fas fa-check-circle"></i> No problems detected across the workspace</div>';
            return;
        }
        listEl.innerHTML = flat.map((f, i) => `
            <div class="problem-item" data-i="${i}" style="padding:5px 6px;cursor:pointer;border-radius:4px;display:flex;gap:8px;align-items:baseline;">
                <i class="fas ${f.severity === 8 ? 'fa-times-circle' : 'fa-exclamation-triangle'}" style="color:${f.severity === 8 ? 'var(--error)' : 'var(--warning)'}"></i>
                <span style="flex:1;">${this.escapeHtml(f.path)} — ${this.escapeHtml(f.message)}</span>
                <span style="color:var(--text-secondary);white-space:nowrap;">Ln ${f.startLineNumber}, Col ${f.startColumn}</span>
            </div>`).join('');
        listEl.querySelectorAll('.problem-item').forEach((el, i) => {
            el.onclick = () => {
                const f = flat[i];
                this.openFile(f.path);
                this.editor.revealPositionInCenter({ lineNumber: f.startLineNumber, column: f.startColumn });
                this.editor.setPosition({ lineNumber: f.startLineNumber, column: f.startColumn });
                this.editor.focus();
            };
            el.onmouseover = () => el.style.background = 'var(--bg-hover)';
            el.onmouseout = () => el.style.background = '';
        });
    }

    // ============================================
    // SEARCH IN FILES (Ctrl+Shift+F)
    // ============================================
    showSearchView() {
        const searchView = document.getElementById('searchView');
        const tree = document.getElementById('fileTree');
        if (searchView) searchView.style.display = 'flex';
        if (tree) tree.style.display = 'none';
        setTimeout(() => document.getElementById('globalSearchInput')?.focus(), 50);
    }

    runGlobalSearch(query) {
        const box = document.getElementById('searchResults');
        if (!box) return;
        const q = (query || '').trim();
        if (q.length < 2) {
            box.innerHTML = '<div style="color:var(--text-secondary);padding:4px 6px;">Type at least 2 characters to search across all files</div>';
            return;
        }
        const lower = q.toLowerCase();
        const results = [];
        this.fileSystem.forEach((data, path) => {
            if (data.type !== 'file' || typeof data.content !== 'string') return;
            data.content.split('\n').forEach((line, i) => {
                if (line.toLowerCase().includes(lower))
                    results.push({ path, line: i + 1, text: line.trim().slice(0, 90) });
            });
        });
        box.innerHTML = results.length === 0
            ? '<div style="color:var(--text-secondary);padding:4px 6px;">No results</div>'
            : results.slice(0, 200).map((r, i) => `
                <div class="search-result" data-i="${i}">
                    <div style="color:var(--accent);">${this.escapeHtml(r.path)}:${r.line}</div>
                    <div style="color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this.escapeHtml(r.text)}</div>
                </div>`).join('')
              + (results.length > 200 ? `<div style="padding:4px 6px;color:var(--text-secondary);">+${results.length - 200} more results</div>` : '');
        box.querySelectorAll('.search-result').forEach((el, i) => {
            el.onclick = () => {
                const r = results[i];
                this.openFile(r.path);
                this.editor.revealLineInCenter(r.line);
                this.editor.setPosition({ lineNumber: r.line, column: 1 });
                this.editor.focus();
            };
        });
    }

    // ============================================
    // CONTEXT MENU
    // ============================================
    showContextMenu(x, y) {
        const menu = document.getElementById('contextMenu');
        const maxX = window.innerWidth - 220;
        const maxY = window.innerHeight - 250;
        
        menu.style.left = Math.min(x, maxX) + 'px';
        menu.style.top = Math.min(y, maxY) + 'px';
        menu.style.display = 'block';
    }
    
    ctxNewFile() {
        this.selectedFolder = this.getContextFolder();
        this.newFile();
        document.getElementById('contextMenu').style.display = 'none';
    }
    
    ctxNewFolder() {
        this.selectedFolder = this.getContextFolder();
        this.newFolder();
        document.getElementById('contextMenu').style.display = 'none';
    }
    
    ctxRename() {
        document.getElementById('contextMenu').style.display = 'none';
        const target = this.fileSystem.get(this.contextTarget);
        if (!target) return;
        
        const oldBaseName = this.contextTarget.split('/').pop();
        const newBaseName = prompt('New name:', oldBaseName);
        if (!newBaseName || newBaseName === oldBaseName) return;
        this.disposeModelsUnder(this.contextTarget);
        
        const parts = this.contextTarget.split('/');
        parts[parts.length - 1] = newBaseName;
        const newPath = parts.join('/');
        
        if (this.fileSystem.has(newPath)) {
            this.showToast('A file/folder with that name already exists!', 'error');
            return;
        }
        
        if (target.type === 'folder') {
            // Renaming a folder means renaming every file/folder path under it too
            const oldPrefix = this.contextTarget + '/';
            const newPrefix = newPath + '/';
            const toRename = [];
            this.fileSystem.forEach((data, path) => {
                if (path === this.contextTarget || path.startsWith(oldPrefix)) toRename.push(path);
            });
            toRename.forEach(path => {
                const data = this.fileSystem.get(path);
                const renamedPath = path === this.contextTarget ? newPath : newPrefix + path.slice(oldPrefix.length);
                this.fileSystem.delete(path);
                this.fileSystem.set(renamedPath, data);
                
                const openIdx = this.openFiles.indexOf(path);
                if (openIdx !== -1) this.openFiles[openIdx] = renamedPath;
                if (this.currentFile === path) this.currentFile = renamedPath;
            });
            if (this.expandedFolders.has(this.contextTarget)) {
                this.expandedFolders.delete(this.contextTarget);
                this.expandedFolders.add(newPath);
            }
            if (this.selectedFolder === this.contextTarget) this.selectedFolder = newPath;
        } else {
            this.fileSystem.delete(this.contextTarget);
            this.fileSystem.set(newPath, target);
            
            const openIdx = this.openFiles.indexOf(this.contextTarget);
            if (openIdx !== -1) this.openFiles[openIdx] = newPath;
            if (this.currentFile === this.contextTarget) this.currentFile = newPath;
        }
        
        if (this.currentFile && this.editor) this.editor.setModel(this.getModelFor(this.currentFile));
        this.renderTabs();
        this.renderFileTree();
        this.showToast('Renamed!', 'success');
        this.saveProjectToDB();
    }
    
    ctxDelete() {
        document.getElementById('contextMenu').style.display = 'none';
        if (!confirm(`Delete ${this.contextTarget}?`)) return;
        this.disposeModelsUnder(this.contextTarget);
        
        const target = this.fileSystem.get(this.contextTarget);
        if (target && target.type === 'folder') {
            const prefix = this.contextTarget + '/';
            const toDelete = [];
            this.fileSystem.forEach((data, path) => {
                if (path === this.contextTarget || path.startsWith(prefix)) toDelete.push(path);
            });
            toDelete.forEach(path => {
                this.fileSystem.delete(path);
                this.closeTab(path);
            });
            this.expandedFolders.delete(this.contextTarget);
            if (this.selectedFolder === this.contextTarget || this.selectedFolder.startsWith(prefix)) {
                this.selectedFolder = '';
            }
        } else {
            this.fileSystem.delete(this.contextTarget);
            this.closeTab(this.contextTarget);
        }
        
        this.renderFileTree();
        this.showToast('Deleted!', 'success');
        this.saveProjectToDB();
    }
    
    ctxCopy() {
        this.clipboard = this.contextTarget;
        document.getElementById('contextMenu').style.display = 'none';
        this.showToast('Copied to clipboard', 'info');
    }
    
    ctxPaste() {
        document.getElementById('contextMenu').style.display = 'none';
        if (!this.clipboard) return;
        
        const clip = this.fileSystem.get(this.clipboard);
        if (!clip) return;
        
        const targetFolder = this.getContextFolder();
        
        if (clip.type === 'folder') {
            const oldPrefix = this.clipboard + '/';
            const baseName = this.clipboard.split('/').pop() + '_copy';
            const newBase = targetFolder ? `${targetFolder}/${baseName}` : baseName;
            
            if (this.fileSystem.has(newBase)) {
                this.showToast('A folder with that name already exists here!', 'error');
                return;
            }
            
            const descendants = [];
            this.fileSystem.forEach((data, path) => {
                if (path.startsWith(oldPrefix)) descendants.push([path, data]);
            });
            
            this.fileSystem.set(newBase, { type: 'folder', content: null, modified: false });
            descendants.forEach(([path, data]) => {
                this.fileSystem.set(newBase + '/' + path.slice(oldPrefix.length), { ...data });
            });
            this.expandedFolders.add(newBase);
        } else {
            const baseName = this.clipboard.split('/').pop();
            const ext = baseName.includes('.') ? '.' + baseName.split('.').pop() : '';
            const base = ext ? baseName.slice(0, -ext.length) : baseName;
            const newName = targetFolder ? `${targetFolder}/${base}_copy${ext}` : `${base}_copy${ext}`;
            this.fileSystem.set(newName, { ...clip, modified: false });
        }
        
        this.renderFileTree();
        this.showToast('Pasted!', 'success');
        this.saveProjectToDB();
    }
    
    // ============================================
    // MENU ACTIONS
    // ============================================
    showMenu(menu, el) {
        const existing = document.getElementById('menuDropdown');
        if (existing) existing.remove();
        const run = (fn) => () => { document.getElementById('menuDropdown')?.remove(); fn(); };
        const ed = () => this.editor;
        const items = {
            file: [
                { label: 'New File', icon: 'fa-file-medical', sc: 'Ctrl+N', action: run(() => this.newFile()) },
                { label: 'New Folder', icon: 'fa-folder-plus', action: run(() => this.newFolder()) },
                { sep: true },
                { label: 'Open Project', icon: 'fa-folder-open', sc: 'Ctrl+O', action: run(() => this.openProject()) },
                { label: 'Save', icon: 'fa-save', sc: 'Ctrl+S', action: run(() => this.saveFile()) },
                { sep: true },
                { label: 'Export Project', icon: 'fa-download', action: run(() => this.exportProject()) },
                { label: 'Import Project', icon: 'fa-upload', action: run(() => this.importProject()) }
            ],
            edit: [
                { label: 'Undo', icon: 'fa-undo', sc: 'Ctrl+Z', action: run(() => ed()?.trigger('menu', 'undo')) },
                { label: 'Redo', icon: 'fa-redo', sc: 'Ctrl+Y', action: run(() => ed()?.trigger('menu', 'redo')) },
                { sep: true },
                { label: 'Find', sc: 'Ctrl+F', action: run(() => ed()?.getAction('actions.find').run()) },
                { label: 'Replace', sc: 'Ctrl+H', action: run(() => this.findAndReplace()) },
                { sep: true },
                { label: 'Format Document', sc: 'Ctrl+K', action: run(() => this.formatCode()) },
                { label: 'Toggle Comment', sc: 'Ctrl+/', action: run(() => this.toggleComment()) }
            ],
            view: [
                { label: 'Toggle Explorer', action: run(() => this.collapseExplorer()) },
                { label: 'Toggle Preview', sc: 'Ctrl+B', action: run(() => this.togglePreview()) },
                { label: 'Toggle Terminal', action: run(() => this.toggleBottomPanel()) },
                { label: 'Toggle Word Wrap', action: run(() => {
                    this.settings.wordWrap = this.settings.wordWrap === 'off' ? 'on' : 'off';
                    ed()?.updateOptions({ wordWrap: this.settings.wordWrap });
                    this.saveSettings();
                }) },
                { sep: true },
                { label: 'Toggle Theme', icon: 'fa-moon', action: run(() => this.toggleTheme()) }
            ],
            run: [
                { label: 'Run Preview', icon: 'fa-play', sc: 'Ctrl+P', action: run(() => this.runCode()) },
                { label: 'Open in New Tab', icon: 'fa-external-link-alt', action: run(() => this.openInNewTab()) },
                { sep: true },
                { label: 'Mobile Builder', icon: 'fa-mobile-alt', action: run(() => this.toggleMobilePanel()) },
                { label: 'Export Buildable Project', icon: 'fa-hammer', action: run(() => { this.toggleMobilePanel(); }) }
            ],
            tools: [
                { label: 'Mobile Builder', icon: 'fa-mobile-alt', action: run(() => this.toggleMobilePanel()) },
                { label: 'Source Control (Git)', icon: 'fa-code-branch', action: run(() => this.showGit()) },
                { sep: true },
                { label: 'Settings', icon: 'fa-cog', action: run(() => this.showSettings()) }
            ]
        }[menu] || [];
        const dd = document.createElement('div');
        dd.className = 'context-menu';
        dd.id = 'menuDropdown';
        dd.style.display = 'block';
        items.forEach(it => {
            if (it.sep) { const s = document.createElement('div'); s.className = 'context-menu-divider'; dd.appendChild(s); return; }
            const d = document.createElement('div');
            d.className = 'context-menu-item';
            d.innerHTML = `${it.icon ? `<i class="fas ${it.icon}"></i>` : '<span style="width:16px;display:inline-block"></span>'}${this.escapeHtml(it.label)}${it.sc ? `<span class="context-menu-shortcut">${it.sc}</span>` : ''}`;
            d.onclick = it.action;
            dd.appendChild(d);
        });
        document.body.appendChild(dd);
        const rect = (el || document.body).getBoundingClientRect();
        dd.style.left = Math.max(4, rect.left) + 'px';
        dd.style.top = (rect.bottom + 4) + 'px';
    }
    
    showAccount() {
        if (this.api.user) {
            const u = this.api.user;
            this.showToast(`Logged in as ${u.email} (${u.role})`, 'success');
            if (confirm(`Logged in as ${u.email}.\n\nOK = log out`)) {
                this.api.logout().then(() => this.showToast('Logged out', 'info'))
                    .catch(() => this.api.clear());
            }
            return;
        }
        this.accountTab('login');
        document.getElementById('accountModal').classList.add('active');
        setTimeout(() => document.getElementById('accEmail').focus(), 100);
    }

    accountTab(mode) {
        this.accountMode = mode;
        document.getElementById('tabLogin').className = 'btn btn-sm ' + (mode === 'login' ? 'btn-primary' : 'btn-secondary');
        document.getElementById('tabRegister').className = 'btn btn-sm ' + (mode === 'register' ? 'btn-primary' : 'btn-secondary');
        document.getElementById('accSubmitBtn').textContent = mode === 'login' ? 'Log in' : 'Create account';
        document.getElementById('accVerifyGroup').style.display = 'none';
        this.accStatus('');
    }

    accStatus(msg, isErr) {
        const el = document.getElementById('accStatus');
        el.textContent = msg;
        el.style.color = isErr ? 'var(--error)' : 'var(--success)';
    }

    async accountSubmit() {
        const email = document.getElementById('accEmail').value.trim();
        const password = document.getElementById('accPassword').value;
        if (!email || !password) return this.accStatus('Email and password are required.', true);
        this.accStatus('Contacting server…');
        document.getElementById('accSubmitBtn').disabled = true;
        try {
            if (this.accountMode === 'register') {
                const d = await this.api.register(email, password);
                this.accStatus(d.message || 'Registered.');
                document.getElementById('accVerifyGroup').style.display = 'block';
                const tok = document.getElementById('accVerifyToken').value.trim();
                if (tok) {
                    await this.api.verifyEmail(tok);
                    this.accStatus('Email verified — you can log in now.');
                    this.accountTab('login');
                }
            } else {
                await this.api.login(email, password);
                this.closeModal('accountModal');
                this.showToast(`Welcome, ${this.api.user.email}`, 'success');
                this.syncNow(true);
            }
        } catch (e) {
            this.accStatus(e.message, true);
            if (e.code === 'EMAIL_NOT_VERIFIED') document.getElementById('accVerifyGroup').style.display = 'block';
        } finally {
            document.getElementById('accSubmitBtn').disabled = false;
        }
    }
    
    gitStatus() {
        this.showGit();
    }
    
    syncChanges() {
        this.showGit();
    }
    
    // ============================================
    // GIT — real git via isomorphic-git + LightningFS
    // Everything below runs actual git operations against a virtual
    // filesystem persisted in IndexedDB (not a simulation).
    // ============================================
    ensureGitLibs() {
        if (typeof window.LightningFS === 'undefined' || typeof window.git === 'undefined') {
            this.showToast('Git libraries failed to load — check your connection and reload.', 'error');
            return false;
        }
        return true;
    }
    
    async initGitFs() {
        if (this.gitFsReady) return true;
        if (!this.ensureGitLibs()) return false;
        this.gitFs = new LightningFS('code-studio-git-fs');
        this.gitPfs = this.gitFs.promises;
        try {
            await this.gitPfs.mkdir(this.gitDir);
        } catch (err) {
            if (err.code !== 'EEXIST') console.error(err);
        }
        this.gitFsReady = true;
        return true;
    }
    
    // A minimal fetch-based HTTP client matching isomorphic-git's `http` interface
    // (avoids needing an ESM import for isomorphic-git/http/web in a classic script).
    get gitHttp() {
        return {
            request: async ({ url, method = 'GET', headers = {}, body }) => {
                let bodyBuffer;
                if (body) {
                    const chunks = [];
                    for await (const chunk of body) chunks.push(chunk);
                    const total = chunks.reduce((n, c) => n + c.length, 0);
                    bodyBuffer = new Uint8Array(total);
                    let offset = 0;
                    for (const c of chunks) { bodyBuffer.set(c, offset); offset += c.length; }
                }
                const res = await fetch(url, { method, headers, body: bodyBuffer });
                const resHeaders = {};
                res.headers.forEach((v, k) => { resHeaders[k] = v; });
                const arrayBuffer = await res.arrayBuffer();
                const bodyChunk = new Uint8Array(arrayBuffer);
                return {
                    url: res.url,
                    method,
                    headers: resHeaders,
                    body: (async function* () { yield bodyChunk; })(),
                    statusCode: res.status,
                    statusMessage: res.statusText
                };
            }
        };
    }
    
    gitOnAuth() {
        return () => {
            if (!this.settings.gitToken) return {};
            return { username: this.settings.gitToken, password: 'x-oauth-basic' };
        };
    }
    
    gitAuthor() {
        return {
            name: this.settings.gitAuthorName || 'Code Studio User',
            email: this.settings.gitAuthorEmail || 'user@codestudio.local'
        };
    }
    
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
    
    // Write every file currently in the editor into the git working directory,
    // and remove anything there that the editor no longer has (so status/diff
    // reflect exactly what's open right now, including unsaved deletions).
    async gitSyncToFs() {
        const wanted = new Set();
        for (const [name, data] of this.fileSystem) {
            if (data.type !== 'file') continue;
            wanted.add(name);
            const parts = name.split('/');
            let cur = this.gitDir;
            for (let i = 0; i < parts.length - 1; i++) {
                cur += '/' + parts[i];
                try { await this.gitPfs.mkdir(cur); } catch (e) { if (e.code !== 'EEXIST') throw e; }
            }
            await this.gitPfs.writeFile(`${this.gitDir}/${name}`, data.content, 'utf8');
        }
        
        const existing = await this.gitListFiles('');
        for (const path of existing) {
            if (!wanted.has(path)) {
                try { await this.gitPfs.unlink(`${this.gitDir}/${path}`); } catch (e) {}
            }
        }
    }
    
    async gitListFiles(prefix) {
        let results = [];
        let entries;
        try {
            entries = await this.gitPfs.readdir(`${this.gitDir}/${prefix}`.replace(/\/$/, ''));
        } catch (e) {
            return results;
        }
        for (const entry of entries) {
            if (entry === '.git') continue;
            const relPath = prefix ? `${prefix}/${entry}` : entry;
            const stat = await this.gitPfs.stat(`${this.gitDir}/${relPath}`);
            if (stat.isDirectory()) {
                results = results.concat(await this.gitListFiles(relPath));
            } else {
                results.push(relPath);
            }
        }
        return results;
    }
    
    async gitWipeDir() {
        const removeAll = async (relPath) => {
            let entries = [];
            try { entries = await this.gitPfs.readdir(`${this.gitDir}/${relPath}`.replace(/\/$/, '')); } catch (e) { return; }
            for (const entry of entries) {
                const childRel = relPath ? `${relPath}/${entry}` : entry;
                const full = `${this.gitDir}/${childRel}`;
                const stat = await this.gitPfs.stat(full);
                if (stat.isDirectory()) {
                    await removeAll(childRel);
                    try { await this.gitPfs.rmdir(full); } catch (e) {}
                } else {
                    try { await this.gitPfs.unlink(full); } catch (e) {}
                }
            }
        };
        await removeAll('');
    }
    
    // Pull every file out of the git working directory back into the editor
    // (used after clone / checkout / pull, when the working directory changed).
    async gitSyncFromFs() {
        const files = await this.gitListFiles('');
        this.disposeAllModels();
        this.fileSystem.clear();
        this.openFiles = [];
        this.currentFile = null;
        for (const path of files) {
            const content = await this.gitPfs.readFile(`${this.gitDir}/${path}`, 'utf8');
            this.fileSystem.set(path, {
                type: 'file',
                content,
                language: this.getLanguage(path),
                modified: false
            });
        }
        this.renderFileTree();
        const first = this.fileSystem.has('index.html') ? 'index.html' : Array.from(this.fileSystem.keys())[0];
        if (first) this.openFile(first);
        await this.saveProjectToDB();
    }
    
    async gitHasRepo() {
        if (!(await this.initGitFs())) return false;
        try {
            await this.gitPfs.stat(`${this.gitDir}/.git`);
            return true;
        } catch (e) {
            return false;
        }
    }
    
    async showGit() {
        if (!(await this.initGitFs())) return;
        document.getElementById('gitModal').classList.add('active');
        
        const has = await this.gitHasRepo();
        document.getElementById('gitNoRepo').style.display = has ? 'none' : 'block';
        document.getElementById('gitRepoView').style.display = has ? 'block' : 'none';
        
        if (has) {
            document.getElementById('gitRemoteUrlInput').value = this.gitRemoteUrl || '';
            document.getElementById('gitToken').value = this.settings.gitToken || '';
            document.getElementById('gitAuthorName').value = this.settings.gitAuthorName || '';
            document.getElementById('gitAuthorEmail').value = this.settings.gitAuthorEmail || '';
            document.getElementById('gitCorsProxy').value = this.settings.gitCorsProxy || 'https://cors.isomorphic-git.org';
            await this.gitRefreshStatus();
        }
    }
    
    async gitInitRepo() {
        if (!(await this.initGitFs())) return;
        await this.gitSyncToFs();
        await git.init({ fs: this.gitFs, dir: this.gitDir, defaultBranch: 'main' });
        this.gitCurrentBranch = 'main';
        this.showToast('Git repository initialized', 'success');
        await this.showGit();
    }
    
    async gitCloneRepo(urlOverride) {
        const url = urlOverride || document.getElementById('gitCloneUrl')?.value.trim();
        if (!url) { this.showToast('Enter a repository URL', 'error'); return; }
        if (!(await this.initGitFs())) return;
        
        this.showToast('Cloning repository...', 'info');
        try {
            await this.gitWipeDir();
            await git.clone({
                fs: this.gitFs,
                http: this.gitHttp,
                dir: this.gitDir,
                url,
                corsProxy: this.settings.gitCorsProxy || 'https://cors.isomorphic-git.org',
                singleBranch: true,
                depth: 50,
                onAuth: this.gitOnAuth()
            });
            this.gitRemoteUrl = url;
            this.projectName = (url.split('/').pop() || 'cloned-project').replace(/\.git$/, '');
            await this.gitSyncFromFs();
            this.gitCurrentBranch = (await git.currentBranch({ fs: this.gitFs, dir: this.gitDir })) || 'main';
            
            document.getElementById('welcomeScreen').classList.remove('active');
            document.getElementById('appContainer').style.display = 'flex';
            
            this.showToast('Repository cloned!', 'success');
            await this.showGit();
        } catch (err) {
            console.error(err);
            this.showToast(`Clone failed: ${err.message}`, 'error');
        }
    }
    
    async gitRefreshStatus() {
        if (!(await this.gitHasRepo())) return;
        await this.gitSyncToFs();
        
        try {
            this.gitCurrentBranch = (await git.currentBranch({ fs: this.gitFs, dir: this.gitDir })) || 'main';
        } catch (e) {}
        
        const branches = await git.listBranches({ fs: this.gitFs, dir: this.gitDir });
        const sel = document.getElementById('gitBranchSelect');
        if (sel) {
            sel.innerHTML = branches.map(b =>
                `<option value="${b}" ${b === this.gitCurrentBranch ? 'selected' : ''}>${b}</option>`
            ).join('');
        }
        
        const matrix = await git.statusMatrix({ fs: this.gitFs, dir: this.gitDir });
        const changed = matrix.filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1));
        
        const listEl = document.getElementById('gitChangesList');
        if (listEl) {
            listEl.innerHTML = changed.length === 0
                ? '<div style="color: var(--text-secondary);">No changes — working tree clean</div>'
                : changed.map(([filepath, head, workdir]) => {
                    let label = 'modified';
                    if (head === 0 && workdir !== 0) label = 'added';
                    else if (head !== 0 && workdir === 0) label = 'deleted';
                    return `<div style="padding:3px 0;"><i class="fas fa-circle" style="font-size:6px; color: var(--accent);"></i> ${this.escapeHtml(filepath)} <span style="color: var(--text-secondary);">(${label})</span></div>`;
                }).join('');
        }
        
        const branchEl = document.getElementById('gitBranch');
        const changesEl = document.getElementById('gitChanges');
        if (branchEl) branchEl.textContent = this.gitCurrentBranch;
        if (changesEl) changesEl.textContent = `${changed.length} change${changed.length === 1 ? '' : 's'}`;
        
        try {
            const log = await git.log({ fs: this.gitFs, dir: this.gitDir, depth: 15 });
            const logEl = document.getElementById('gitLogList');
            if (logEl) {
                logEl.innerHTML = log.length === 0
                    ? '<div style="color: var(--text-secondary);">No commits yet</div>'
                    : log.map(c => `<div style="padding:3px 0;"><span style="color: var(--accent); font-family: monospace;">${c.oid.slice(0, 7)}</span> ${this.escapeHtml(c.commit.message.split('\n')[0])} <span style="color: var(--text-secondary);">— ${this.escapeHtml(c.commit.author.name)}</span></div>`).join('');
            }
        } catch (e) {}
    }
    
    async gitCommitChanges() {
        const message = document.getElementById('gitCommitMessage').value.trim();
        if (!message) { this.showToast('Enter a commit message', 'error'); return; }
        if (!(await this.gitHasRepo())) return;
        
        await this.gitSyncToFs();
        
        const matrix = await git.statusMatrix({ fs: this.gitFs, dir: this.gitDir });
        for (const [filepath, , workdir] of matrix) {
            if (workdir === 0) {
                await git.remove({ fs: this.gitFs, dir: this.gitDir, filepath });
            } else {
                await git.add({ fs: this.gitFs, dir: this.gitDir, filepath });
            }
        }
        
        try {
            const sha = await git.commit({
                fs: this.gitFs,
                dir: this.gitDir,
                message,
                author: this.gitAuthor()
            });
            document.getElementById('gitCommitMessage').value = '';
            this.showToast(`Committed ${sha.slice(0, 7)}`, 'success');
            await this.gitRefreshStatus();
        } catch (err) {
            console.error(err);
            this.showToast(`Commit failed: ${err.message}`, 'error');
        }
    }
    
    async gitPushRepo() {
        if (!(await this.gitHasRepo())) return;
        this.gitSaveRemoteSettings();
        if (!this.gitRemoteUrl) { this.showToast('Set a remote URL first', 'error'); return; }
        
        this.showToast('Pushing...', 'info');
        try {
            await git.push({
                fs: this.gitFs,
                http: this.gitHttp,
                dir: this.gitDir,
                url: this.gitRemoteUrl,
                ref: this.gitCurrentBranch,
                corsProxy: this.settings.gitCorsProxy || 'https://cors.isomorphic-git.org',
                onAuth: this.gitOnAuth()
            });
            this.showToast('Pushed successfully!', 'success');
        } catch (err) {
            console.error(err);
            this.showToast(`Push failed: ${err.message}`, 'error');
        }
    }
    
    async gitPullRepo() {
        if (!(await this.gitHasRepo())) return;
        this.gitSaveRemoteSettings();
        if (!this.gitRemoteUrl) { this.showToast('Set a remote URL first', 'error'); return; }
        
        this.showToast('Pulling...', 'info');
        try {
            await git.pull({
                fs: this.gitFs,
                http: this.gitHttp,
                dir: this.gitDir,
                url: this.gitRemoteUrl,
                ref: this.gitCurrentBranch,
                singleBranch: true,
                corsProxy: this.settings.gitCorsProxy || 'https://cors.isomorphic-git.org',
                onAuth: this.gitOnAuth(),
                author: this.gitAuthor()
            });
            await this.gitSyncFromFs();
            this.showToast('Pulled latest changes!', 'success');
            await this.gitRefreshStatus();
        } catch (err) {
            console.error(err);
            this.showToast(`Pull failed: ${err.message}`, 'error');
        }
    }
    
    async gitNewBranch() {
        const name = prompt('New branch name:');
        if (!name || !name.trim()) return;
        if (!(await this.gitHasRepo())) return;
        try {
            await git.branch({ fs: this.gitFs, dir: this.gitDir, ref: name.trim(), checkout: true });
            this.gitCurrentBranch = name.trim();
            await this.gitSyncFromFs();
            this.showToast(`Switched to new branch "${name.trim()}"`, 'success');
            await this.gitRefreshStatus();
        } catch (err) {
            console.error(err);
            this.showToast(`Branch creation failed: ${err.message}`, 'error');
        }
    }
    
    async gitSwitchBranch(name) {
        if (!name || name === this.gitCurrentBranch) return;
        try {
            await git.checkout({ fs: this.gitFs, dir: this.gitDir, ref: name });
            this.gitCurrentBranch = name;
            await this.gitSyncFromFs();
            this.showToast(`Switched to "${name}"`, 'success');
            await this.gitRefreshStatus();
        } catch (err) {
            console.error(err);
            this.showToast(`Checkout failed: ${err.message}`, 'error');
        }
    }
    
    gitSaveRemoteSettings() {
        this.gitRemoteUrl = document.getElementById('gitRemoteUrlInput')?.value.trim() || this.gitRemoteUrl;
        this.settings.gitToken = document.getElementById('gitToken')?.value || this.settings.gitToken;
        this.settings.gitAuthorName = document.getElementById('gitAuthorName')?.value || this.settings.gitAuthorName;
        this.settings.gitAuthorEmail = document.getElementById('gitAuthorEmail')?.value || this.settings.gitAuthorEmail;
        this.settings.gitCorsProxy = document.getElementById('gitCorsProxy')?.value.trim() || this.settings.gitCorsProxy;
        this.saveSettings();
    }
    
    syncToCloud() {
        if (!this.api.user) { this.showAccount(); this.showToast('Log in to sync projects to the server.', 'warning'); return; }
        this.syncNow();
    }

    // Push the current project to the API. Fails loudly and honestly — never a fake success toast.
    async syncNow(silent) {
        if (!this.api.user) return;
        try {
            const files = {};
            this.fileSystem.forEach((data, name) => { if (data.type === 'file') files[name] = { type: 'file', content: data.content }; });
            await this.api.saveProject(this.projectName, files);
            if (!silent) this.showToast(`Synced "${this.projectName}" to server.`, 'success');
        } catch (e) {
            this.showToast('Sync failed: ' + e.message, 'error');
        }
    }
    
    encodingMenu() {
        this.showToast('UTF-8 encoding', 'info');
    }
    
    lineEndingMenu() {
        this.showToast('LF line endings', 'info');
    }
    
    refreshExplorer() {
        this.renderFileTree();
        this.showToast('Explorer refreshed', 'info');
    }
    
    // ============================================
    // MODAL HELPERS
    // ============================================
    closeModal(id) {
        document.getElementById(id).classList.remove('active');
    }
    
    // ============================================
    // TOAST NOTIFICATIONS
    // ============================================
    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            success: 'fa-check-circle',
            error: 'fa-times-circle',
            info: 'fa-info-circle',
            warning: 'fa-exclamation-triangle'
        };
        
        toast.innerHTML = `<i class="fas ${icons[type]}"></i> ${message}`;
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    
    // ============================================
    // UTILITIES
    // ============================================
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Initialize app
const app = new CodeStudio();
