import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import {
  Pause, Play, Trash2, Copy, Filter, Terminal,
  CheckCircle2, XCircle, AlertTriangle, Activity, Wifi,
} from 'lucide-react';
import { formatTimestamp } from '../../utils/helpers';
import './TerminalDrawer.css';

export function TerminalDrawer() {
  const events = useAppStore((s) => s.events);
  const clearEvents = useAppStore((s) => s.clearEvents);
  const [paused, setPaused] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = events.filter((e) => !typeFilter || e.type === typeFilter);
  const displayEvents = paused ? filtered : filtered;

  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events, paused]);

  const getIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle2 size={12} />;
      case 'error': return <XCircle size={12} />;
      case 'warning': return <AlertTriangle size={12} />;
      case 'mesh': return <Wifi size={12} />;
      default: return <Activity size={12} />;
    }
  };

  const handleCopy = () => {
    const text = displayEvents.map((e) => `[${formatTimestamp(e.timestamp)}] [${e.type}] ${e.message}`).join('\n');
    navigator.clipboard.writeText(text);
  };

  return (
    <div className={`terminal-drawer ${expanded ? 'expanded' : ''}`}>
      <div className="terminal-header">
        <div className="terminal-title">
          <Terminal size={14} />
          <span>Event Stream</span>
          <span className="terminal-count">{events.length}</span>
        </div>
        <div className="terminal-controls">
          <div className="terminal-filters">
            {['info', 'success', 'warning', 'error', 'mesh'].map((t) => (
              <button
                key={t}
                className={`terminal-filter-btn ${typeFilter === t ? 'active' : ''}`}
                onClick={() => setTypeFilter(typeFilter === t ? null : t)}
                title={t}
              >
                {getIcon(t)}
              </button>
            ))}
          </div>
          <div className="terminal-divider" />
          <button className="terminal-control-btn" onClick={() => setPaused(!paused)} title={paused ? 'Resume' : 'Pause'}>
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
          <button className="terminal-control-btn" onClick={handleCopy} title="Copy">
            <Copy size={13} />
          </button>
          <button className="terminal-control-btn" onClick={clearEvents} title="Clear">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="terminal-body" ref={scrollRef}>
        {displayEvents.length === 0 && (
          <div className="terminal-empty">No events to display</div>
        )}
        {displayEvents.map((event) => (
          <div key={event.id} className={`terminal-line ${event.type}`}>
            <span className="terminal-time mono">{formatTimestamp(event.timestamp)}</span>
            <span className={`terminal-type-icon ${event.type}`}>{getIcon(event.type)}</span>
            <span className="terminal-msg">{event.message}</span>
            {event.nodeId && (
              <span className="terminal-node mono">{event.nodeId.slice(0, 10)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
