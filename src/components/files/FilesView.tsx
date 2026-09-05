import React, { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { getMeshOrchestrator } from '../../services/MeshOrchestrator';
import {
  FileText, Download, Eye, Server, Clock, Hash, FolderOpen,
  Plus, X, Share2,
} from 'lucide-react';
import { formatRelativeTime } from '../../utils/helpers';
import './FilesView.css';

export function FilesView() {
  const files = useAppStore((s) => s.files);
  const nodes = useAppStore((s) => s.nodes);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const openTab = useAppStore((s) => s.openTab);
  const addFile = useAppStore((s) => s.addFile);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');

  const handleDownload = (file: typeof files[0]) => {
    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.path.split('/').pop() || 'file.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePreview = (path: string) => {
    openTab(path);
    setActiveView('ide');
  };

  const handleCreateFile = () => {
    if (!newFileName.trim()) return;

    try {
      const orchestrator = getMeshOrchestrator();
      const ext = newFileName.split('.').pop() || 'txt';
      const lang = getLanguageFromExt(ext);

      orchestrator.p2p.syncFile({
        path: newFileName,
        content: newFileContent || getDefaultContent(ext),
        language: lang,
      });

      setShowCreateModal(false);
      setNewFileName('');
      setNewFileContent('');
    } catch (err) {
      console.error('Failed to create file:', err);
    }
  };

  const getLanguageFromExt = (ext: string): string => {
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      json: 'json',
      html: 'html',
      css: 'css',
      md: 'markdown',
    };
    return langMap[ext] || 'plaintext';
  };

  const getDefaultContent = (ext: string): string => {
    const templates: Record<string, string> = {
      ts: '// TypeScript file\n',
      tsx: 'import React from "react";\n\nexport function Component() {\n  return <div>Hello</div>;\n}\n',
      js: '// JavaScript file\n',
      py: '# Python file\n',
      json: '{\n  \n}\n',
      html: '<!DOCTYPE html>\n<html>\n<head>\n  <title></title>\n</head>\n<body>\n  \n</body>\n</html>\n',
      css: '/* CSS */\n',
    };
    return templates[ext] || '// New file\n';
  };

  return (
    <div className="files-view">
      <div className="files-header">
        <h2 className="view-title">Files & Artifacts</h2>
        <button className="create-file-btn" onClick={() => setShowCreateModal(true)}>
          <Plus size={14} /> Create File
        </button>
      </div>

      {files.length === 0 ? (
        <div className="files-empty">
          <FolderOpen size={48} strokeWidth={1} />
          <p>No files generated yet</p>
          <span>Create a file or run a task to generate artifacts</span>
        </div>
      ) : (
        <div className="files-grid">
          {files.map((file) => {
            const fileName = file.path.split('/').pop() || file.path;
            const folder = file.path.split('/').slice(0, -1).join('/');
            const producer = file.producedBy
              ? nodes.find((n) => n.id === file.producedBy)?.name
              : null;

            return (
              <div key={file.path} className="file-card">
                <div className="file-card-header">
                  <FileText size={16} />
                  <div className="file-card-name-group">
                    <span className="file-card-name">{fileName}</span>
                    {folder && <span className="file-card-folder">{folder}</span>}
                  </div>
                  <span className="file-lang-badge">{file.language}</span>
                </div>

                <div className="file-card-preview mono">
                  {file.content.slice(0, 200)}
                  {file.content.length > 200 && '...'}
                </div>

                <div className="file-card-meta">
                  <span><Clock size={10} /> {formatRelativeTime(file.lastModified)}</span>
                  <span><Hash size={10} /> v{file.version}</span>
                  {producer && (
                    <span><Server size={10} /> {producer}</span>
                  )}
                </div>

                <div className="file-card-actions">
                  <button className="file-action-btn" onClick={() => handlePreview(file.path)}>
                    <Eye size={12} /> Open
                  </button>
                  <button className="file-action-btn" onClick={() => handleDownload(file)}>
                    <Download size={12} /> Download
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create File Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New File</h3>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-field">
                <label>File Name</label>
                <input
                  type="text"
                  value={newFileName}
                  onChange={e => setNewFileName(e.target.value)}
                  placeholder="e.g., utils.ts, app.js, styles.css"
                />
              </div>
              <div className="form-field">
                <label>Initial Content (optional)</label>
                <textarea
                  value={newFileContent}
                  onChange={e => setNewFileContent(e.target.value)}
                  placeholder="Enter initial code..."
                  rows={8}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleCreateFile}>
                <Plus size={14} /> Create & Sync
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
