import React, { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { EventBus, MeshEvents } from '../../services/EventBus';
import {
  MessageSquare, Trash2, Edit3, Check, X, Plus, Clock,
  Search, Bot, User,
} from 'lucide-react';
import './ChatHistoryView.css';

export function ChatHistoryView() {
  const chatSessions = useAppStore((s) => s.chatSessions);
  const activeChatSessionId = useAppStore((s) => s.activeChatSessionId);
  const loadChatSession = useAppStore((s) => s.loadChatSession);
  const deleteChatSession = useAppStore((s) => s.deleteChatSession);
  const renameChatSession = useAppStore((s) => s.renameChatSession);
  const startNewChat = useAppStore((s) => s.startNewChat);

  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filteredSessions = chatSessions.filter((session) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      session.title.toLowerCase().includes(q) ||
      session.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  });

  const handleLoad = (sessionId: string) => {
    const session = chatSessions.find((s) => s.id === sessionId);
    if (!session) return;
    loadChatSession(sessionId);
    // Emit event so CommandTerminal can load the messages
    EventBus.emit(MeshEvents.CHAT_SESSION_LOADED, session.messages);
  };

  const handleNewChat = () => {
    startNewChat();
    // Clear terminal by emitting with empty messages
    EventBus.emit(MeshEvents.CHAT_SESSION_LOADED, []);
  };

  const startRename = (id: string, currentTitle: string) => {
    setEditingId(id);
    setEditTitle(currentTitle);
  };

  const confirmRename = () => {
    if (editingId && editTitle.trim()) {
      renameChatSession(editingId, editTitle.trim());
    }
    setEditingId(null);
    setEditTitle('');
  };

  const handleDelete = (sessionId: string) => {
    deleteChatSession(sessionId);
    setConfirmDeleteId(null);
    if (expandedId === sessionId) setExpandedId(null);
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return `Today at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    if (diffDays === 1) return `Yesterday at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="chat-history-view">
      <div className="chat-history-header">
        <div className="chat-history-title">
          <MessageSquare size={20} />
          <h2>Chat History</h2>
          <span className="chat-history-count">{chatSessions.length}</span>
        </div>
        <button className="chat-history-new-btn" onClick={handleNewChat}>
          <Plus size={14} />
          <span>New Chat</span>
        </button>
      </div>

      <div className="chat-history-search">
        <Search size={14} className="search-icon" />
        <input
          type="text"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="chat-history-search-input"
        />
        {searchQuery && (
          <button className="search-clear" onClick={() => setSearchQuery('')}>
            <X size={12} />
          </button>
        )}
      </div>

      <div className="chat-history-list">
        {filteredSessions.length === 0 && (
          <div className="chat-history-empty">
            <MessageSquare size={32} />
            {chatSessions.length === 0 ? (
              <>
                <p>No chat history yet</p>
                <p className="chat-history-empty-sub">
                  Start a conversation and it will appear here automatically.
                </p>
              </>
            ) : (
              <p>No conversations match your search</p>
            )}
          </div>
        )}

        {filteredSessions.map((session) => {
          const msgCount = session.messages.length;
          const userMsgCount = session.messages.filter((m) => m.role === 'user').length;
          const isActive = activeChatSessionId === session.id;
          const isExpanded = expandedId === session.id;
          const isEditing = editingId === session.id;
          const isConfirmingDelete = confirmDeleteId === session.id;

          return (
            <div
              key={session.id}
              className={`chat-history-item ${isActive ? 'active' : ''} ${isExpanded ? 'expanded' : ''}`}
            >
              <div className="chat-history-item-header" onClick={() => setExpandedId(isExpanded ? null : session.id)}>
                <div className="chat-history-item-info">
                  {isEditing ? (
                    <div className="chat-history-rename" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') confirmRename();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="rename-input"
                        autoFocus
                      />
                      <button className="rename-btn confirm" onClick={confirmRename}><Check size={12} /></button>
                      <button className="rename-btn cancel" onClick={() => setEditingId(null)}><X size={12} /></button>
                    </div>
                  ) : (
                    <span className="chat-history-item-title">{session.title}</span>
                  )}
                  <div className="chat-history-item-meta">
                    <Clock size={10} />
                    <span>{formatDate(session.updatedAt)}</span>
                    <span className="meta-separator">|</span>
                    <span>{userMsgCount} message{userMsgCount !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <div className="chat-history-item-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="item-action-btn load"
                    onClick={() => handleLoad(session.id)}
                    title="Open this conversation"
                  >
                    <MessageSquare size={13} />
                  </button>
                  <button
                    className="item-action-btn"
                    onClick={() => startRename(session.id, session.title)}
                    title="Rename"
                  >
                    <Edit3 size={13} />
                  </button>
                  {isConfirmingDelete ? (
                    <>
                      <button className="item-action-btn danger" onClick={() => handleDelete(session.id)} title="Confirm delete">
                        <Check size={13} />
                      </button>
                      <button className="item-action-btn" onClick={() => setConfirmDeleteId(null)} title="Cancel">
                        <X size={13} />
                      </button>
                    </>
                  ) : (
                    <button
                      className="item-action-btn danger"
                      onClick={() => setConfirmDeleteId(session.id)}
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="chat-history-preview">
                  {session.messages.slice(0, 6).map((msg) => (
                    <div key={msg.id} className={`preview-msg ${msg.role}`}>
                      <span className="preview-msg-icon">
                        {msg.role === 'user' ? <User size={10} /> : <Bot size={10} />}
                      </span>
                      <span className="preview-msg-text">
                        {msg.content.length > 120 ? msg.content.slice(0, 120) + '...' : msg.content}
                      </span>
                    </div>
                  ))}
                  {msgCount > 6 && (
                    <div className="preview-more">+{msgCount - 6} more messages</div>
                  )}
                  <button className="preview-open-btn" onClick={() => handleLoad(session.id)}>
                    Open Full Conversation
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
