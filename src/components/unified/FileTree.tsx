import React, { useState, useRef, useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import { FileOps } from '../../services/FileOperations';
import {
  File, Folder, FolderOpen, Trash2, Plus, ChevronRight, ChevronDown,
  Upload, Search, X, FileCode, FileText, FileJson, FileCog, Download
} from 'lucide-react';

interface FolderNode {
  name: string;
  path: string;
  children: Map<string, FolderNode>;
  files: { name: string; path: string; language: string }[];
}

function buildTree(files: { path: string; language: string }[]): FolderNode {
  const root: FolderNode = { name: '', path: '', children: new Map(), files: [] };

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];
      if (!current.children.has(folderName)) {
        current.children.set(folderName, {
          name: folderName,
          path: parts.slice(0, i + 1).join('/'),
          children: new Map(),
          files: [],
        });
      }
      current = current.children.get(folderName)!;
    }

    current.files.push({
      name: parts[parts.length - 1],
      path: file.path,
      language: file.language,
    });
  }

  return root;
}

// Get file icon based on language/extension
function getFileIcon(language: string, size = 14) {
  switch (language) {
    case 'javascript':
    case 'typescript':
    case 'python':
    case 'java':
    case 'go':
    case 'rust':
    case 'cpp':
    case 'c':
      return <FileCode size={size} className={`file-icon file-icon-${language}`} />;
    case 'json':
      return <FileJson size={size} className="file-icon file-icon-json" />;
    case 'yaml':
    case 'toml':
      return <FileCog size={size} className="file-icon file-icon-config" />;
    case 'markdown':
      return <FileText size={size} className="file-icon file-icon-md" />;
    default:
      return <File size={size} className="file-icon" />;
  }
}

function FolderItem({ node, depth, searchQuery }: { node: FolderNode; depth: number; searchQuery: string }) {
  const [expanded, setExpanded] = useState(true);

  // Filter files based on search
  const filteredFiles = searchQuery
    ? node.files.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : node.files;

  // Check if any children match search
  const hasMatchingChildren = searchQuery
    ? Array.from(node.children.values()).some((child) =>
        child.files.some((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        child.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : true;

  // Auto-expand if searching and has matches
  const shouldShow = !searchQuery || filteredFiles.length > 0 || hasMatchingChildren ||
    node.name.toLowerCase().includes(searchQuery.toLowerCase());

  if (!shouldShow) return null;

  return (
    <div>
      <div
        className="file-tree-item folder"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="file-tree-chevron">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        {expanded ? <FolderOpen size={14} className="folder-icon open" /> : <Folder size={14} className="folder-icon" />}
        <span className="file-tree-name">{node.name}</span>
      </div>
      {expanded && (
        <>
          {Array.from(node.children.values()).map((child) => (
            <FolderItem key={child.path} node={child} depth={depth + 1} searchQuery={searchQuery} />
          ))}
          {filteredFiles.map((f) => (
            <FileItem key={f.path} file={f} depth={depth + 1} searchQuery={searchQuery} />
          ))}
        </>
      )}
    </div>
  );
}

function FileItem({ file, depth, searchQuery }: { file: { name: string; path: string; language: string }; depth: number; searchQuery: string }) {
  const activeFilePath = useAppStore((s) => s.activeFilePath);
  const files = useAppStore((s) => s.files);
  const isActive = activeFilePath === file.path;

  // Highlight search match
  const highlightMatch = (text: string) => {
    if (!searchQuery) return text;
    const idx = text.toLowerCase().indexOf(searchQuery.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="file-tree-highlight">{text.slice(idx, idx + searchQuery.length)}</mark>
        {text.slice(idx + searchQuery.length)}
      </>
    );
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const fileData = files.find((f) => f.path === file.path);
    if (!fileData) return;

    const blob = new Blob([fileData.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`file-tree-item file ${isActive ? 'active' : ''}`}
      style={{ paddingLeft: `${depth * 14 + 24}px` }}
      onClick={() => FileOps.open(file.path)}
    >
      {getFileIcon(file.language)}
      <span className="file-tree-name">{highlightMatch(file.name)}</span>
      <div className="file-tree-actions">
        <button
          className="file-tree-action-btn"
          onClick={handleDownload}
          title="Download file"
        >
          <Download size={11} />
        </button>
        <button
          className="file-tree-action-btn file-tree-delete"
          onClick={(e) => {
            e.stopPropagation();
            FileOps.delete(file.path);
          }}
          title="Delete file"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

export function FileTree() {
  const files = useAppStore((s) => s.files);
  const [newFileName, setNewFileName] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tree = useMemo(() => buildTree(files), [files]);

  const handleCreate = () => {
    if (newFileName.trim()) {
      FileOps.create(newFileName.trim());
      setNewFileName('');
      setShowInput(false);
    }
  };

  // Handle file upload from system
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles) return;

    Array.from(uploadedFiles).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result as string;
        const path = file.name;
        const existing = files.find((f) => f.path === path);
        if (existing) {
          FileOps.update(path, content);
        } else {
          FileOps.create(path, content);
        }
      };
      reader.readAsText(file);
    });

    e.target.value = '';
  };

  // Filter root-level files based on search
  const filteredRootFiles = searchQuery
    ? tree.files.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : tree.files;

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span>EXPLORER</span>
        <div className="file-tree-header-actions">
          <button
            className={`file-tree-header-btn ${showSearch ? 'active' : ''}`}
            onClick={() => { setShowSearch(!showSearch); setSearchQuery(''); }}
            title="Search files"
          >
            <Search size={13} />
          </button>
          <button
            className="file-tree-header-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Upload files"
          >
            <Upload size={13} />
          </button>
          <button
            className={`file-tree-header-btn ${showInput ? 'active' : ''}`}
            onClick={() => setShowInput(!showInput)}
            title="New file"
          >
            <Plus size={13} />
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileUpload}
          accept=".py,.ts,.tsx,.js,.jsx,.html,.css,.json,.md,.txt,.go,.rs,.java,.c,.cpp,.h,.sql,.sh,.yaml,.yml,.toml,.xml,.csv"
        />
      </div>

      {/* Search input */}
      {showSearch && (
        <div className="file-tree-search">
          <Search size={12} className="file-tree-search-icon" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            autoFocus
          />
          {searchQuery && (
            <button className="file-tree-search-clear" onClick={() => setSearchQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* New file input */}
      {showInput && (
        <div className="file-tree-new-input">
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setShowInput(false); setNewFileName(''); }
            }}
            placeholder="filename.ext"
            autoFocus
          />
        </div>
      )}

      <div className="file-tree-list">
        {files.length === 0 && (
          <div className="file-tree-empty">
            <File size={24} strokeWidth={1} />
            <p>No files yet</p>
            <span>Click + to create or upload a file</span>
          </div>
        )}
        {Array.from(tree.children.values()).map((child) => (
          <FolderItem key={child.path} node={child} depth={0} searchQuery={searchQuery} />
        ))}
        {filteredRootFiles.map((f) => (
          <FileItem key={f.path} file={f} depth={0} searchQuery={searchQuery} />
        ))}
      </div>

      {/* File count footer */}
      {files.length > 0 && (
        <div className="file-tree-footer">
          {files.length} file{files.length !== 1 ? 's' : ''}
          {searchQuery && ` (${filteredRootFiles.length + Array.from(tree.children.values()).reduce((acc, c) => acc + c.files.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase())).length, 0)} match${filteredRootFiles.length !== 1 ? 'es' : ''})`}
        </div>
      )}
    </div>
  );
}
