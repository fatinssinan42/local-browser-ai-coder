// ============================================
// FileOperations — Virtual File System Actions
// ============================================
// Provides create, delete, rename, and read operations
// on the in-memory VirtualFile store. Used by CommandInterpreter.

import { useAppStore } from '../stores/appStore';
import { getMeshOrchestrator } from './MeshOrchestrator';
import type { VirtualFile } from '../types';

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescriptreact',
  js: 'javascript', jsx: 'javascriptreact',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go',
  java: 'java', kt: 'kotlin', cs: 'csharp', cpp: 'cpp',
  c: 'c', h: 'c', hpp: 'cpp',
  html: 'html', css: 'css', scss: 'scss', less: 'less',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  md: 'markdown', txt: 'plaintext', xml: 'xml', svg: 'xml',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  sql: 'sql', graphql: 'graphql',
  dockerfile: 'dockerfile', makefile: 'makefile',
};

const BOILERPLATE: Record<string, (name: string) => string> = {
  python: (name) => `# ${name}\n\ndef main():\n    pass\n\nif __name__ == "__main__":\n    main()\n`,
  typescript: (name) => `// ${name}\n\nexport function main() {\n  \n}\n`,
  javascript: (name) => `// ${name}\n\nfunction main() {\n  \n}\n\nmodule.exports = { main };\n`,
  typescriptreact: (name) => `import React from 'react';\n\nexport function ${toPascalCase(name)}() {\n  return (\n    <div>\n      <h1>${toPascalCase(name)}</h1>\n    </div>\n  );\n}\n`,
  javascriptreact: (name) => `import React from 'react';\n\nexport function ${toPascalCase(name)}() {\n  return (\n    <div>\n      <h1>${toPascalCase(name)}</h1>\n    </div>\n  );\n}\n`,
  html: () => `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Document</title>\n</head>\n<body>\n  \n</body>\n</html>\n`,
  css: () => `/* Styles */\n\n`,
  json: () => `{\n  \n}\n`,
  rust: (name) => `// ${name}\n\nfn main() {\n    println!("Hello, world!");\n}\n`,
  go: (name) => `package main\n\nimport "fmt"\n\n// ${name}\nfunc main() {\n\tfmt.Println("Hello, world!")\n}\n`,
  java: (name) => `public class ${toPascalCase(name)} {\n    public static void main(String[] args) {\n        \n    }\n}\n`,
  cpp: (name) => `// ${name}\n#include <iostream>\n\nint main() {\n    std::cout << "Hello, world!" << std::endl;\n    return 0;\n}\n`,
  c: (name) => `/* ${name} */\n#include <stdio.h>\n\nint main() {\n    printf("Hello, world!\\n");\n    return 0;\n}\n`,
  shell: () => `#!/bin/bash\n\n`,
  sql: () => `-- Query\n\nSELECT 1;\n`,
  markdown: (name) => `# ${name}\n\n`,
};

function toPascalCase(name: string): string {
  const base = name.replace(/\.[^.]+$/, ''); // strip extension
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s/g, '');
}

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const filename = path.split('/').pop()?.toLowerCase() || '';
  if (filename === 'dockerfile') return 'dockerfile';
  if (filename === 'makefile') return 'makefile';
  return LANGUAGE_MAP[ext] || 'plaintext';
}

function getBoilerplate(language: string, name: string): string {
  const gen = BOILERPLATE[language];
  return gen ? gen(name) : '';
}

export interface FileOpResult {
  success: boolean;
  message: string;
  file?: VirtualFile;
}

export const FileOps = {
  create(path: string, content?: string): FileOpResult {
    const store = useAppStore.getState();
    const existing = store.files.find((f) => f.path === path);
    if (existing) {
      return { success: false, message: `File already exists: ${path}` };
    }

    const language = detectLanguage(path);
    const fileName = path.split('/').pop() || path;
    const fileContent = content ?? getBoilerplate(language, fileName);

    const file: VirtualFile = {
      path,
      content: fileContent,
      language,
      lastModified: Date.now(),
      version: 1,
    };

    store.addFile(file);
    store.openTab(path);

    try {
      getMeshOrchestrator().p2p.broadcast({
        type: 'file-sync',
        payload: { action: 'create', file },
      });
    } catch { /* orchestrator not ready */ }

    return { success: true, message: `Created ${path}`, file };
  },

  delete(path: string): FileOpResult {
    const store = useAppStore.getState();
    const existing = store.files.find((f) => f.path === path);
    if (!existing) {
      return { success: false, message: `File not found: ${path}` };
    }

    store.closeTab(path);
    store.removeFile(path);

    try {
      getMeshOrchestrator().p2p.broadcast({
        type: 'file-sync',
        payload: { action: 'delete', path },
      });
    } catch { /* orchestrator not ready */ }

    return { success: true, message: `Deleted ${path}` };
  },

  rename(oldPath: string, newPath: string): FileOpResult {
    const store = useAppStore.getState();
    const existing = store.files.find((f) => f.path === oldPath);
    if (!existing) {
      return { success: false, message: `File not found: ${oldPath}` };
    }
    if (store.files.find((f) => f.path === newPath)) {
      return { success: false, message: `File already exists: ${newPath}` };
    }

    const language = detectLanguage(newPath);
    const newFile: VirtualFile = {
      ...existing,
      path: newPath,
      language,
      lastModified: Date.now(),
      version: existing.version + 1,
    };

    store.closeTab(oldPath);
    store.removeFile(oldPath);
    store.addFile(newFile);
    store.openTab(newPath);

    return { success: true, message: `Renamed ${oldPath} → ${newPath}`, file: newFile };
  },

  open(path: string): FileOpResult {
    const store = useAppStore.getState();
    const existing = store.files.find((f) => f.path === path);
    if (!existing) {
      return { success: false, message: `File not found: ${path}` };
    }

    store.openTab(path);
    return { success: true, message: `Opened ${path}`, file: existing };
  },

  read(path: string): FileOpResult {
    const store = useAppStore.getState();
    const existing = store.files.find((f) => f.path === path);
    if (!existing) {
      return { success: false, message: `File not found: ${path}` };
    }

    return { success: true, message: existing.content, file: existing };
  },

  list(): { files: VirtualFile[]; message: string } {
    const store = useAppStore.getState();
    const files = store.files;
    if (files.length === 0) {
      return { files: [], message: 'No files in workspace. Use "create <filename>" to create one.' };
    }
    const listing = files.map((f) => `  ${f.path} (${f.language})`).join('\n');
    return { files, message: `${files.length} file(s):\n${listing}` };
  },

  update(path: string, content: string): FileOpResult {
    const store = useAppStore.getState();
    const existing = store.files.find((f) => f.path === path);
    if (!existing) {
      return { success: false, message: `File not found: ${path}` };
    }

    // Save previous version for undo before overwriting
    store.saveFileUndo(path, existing.content);

    const now = Date.now();
    const newVersion = existing.version + 1;
    store.updateFile(path, {
      content,
      lastModified: now,
      version: newVersion,
    });

    // Open the tab and focus the file so user sees the change immediately
    store.openTab(path);

    try {
      getMeshOrchestrator().p2p.broadcast({
        type: 'file-sync',
        payload: {
          action: 'update',
          file: { ...existing, content, lastModified: now, version: newVersion },
        },
      });
    } catch { /* orchestrator not ready */ }

    const updated = useAppStore.getState().files.find((f) => f.path === path)!;
    return { success: true, message: `Updated ${path}`, file: updated };
  },

  detectLanguage,
};
