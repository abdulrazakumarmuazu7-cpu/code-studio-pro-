# Frontend structure and refactor scaffold

This repository now includes a lightweight modular foundation for the front-end so the giant `app.js` can be split gradually without breaking the existing app.

## Structure

src/
├── app.js
├── config.js
├── api/
│   └── client.js
├── core/
│   ├── editor.js
│   ├── files.js
│   └── storage.js
├── features/
│   ├── git.js
│   ├── mobile-builder.js
│   └── terminal.js
├── ui/
│   ├── menu.js
│   ├── modals.js
│   └── theme.js
└── README.md

## Purpose

- keep config and runtime constants in one place
- isolate the file system and storage helpers
- simplify future refactors of Monaco, Git, and mobile builder logic
- avoid rewriting the app in one shot

## Recommended next step

Move the features from the single `app.js` file incrementally into the modules above, starting with:
1. storage and settings
2. file-tree helpers
3. theme logic
4. terminal and mobile exporter helpers
5. cloud sync APIs
