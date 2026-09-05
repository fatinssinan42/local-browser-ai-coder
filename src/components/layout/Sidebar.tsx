import React from 'react';
import { useAppStore } from '../../stores/appStore';
import type { SidebarView } from '../../types';
import {
  LayoutDashboard, Server, ListTodo, Code2, Bug, Terminal,
  FolderOpen, Mic, Settings, ChevronLeft, ChevronRight, MessageSquare, History, Layers,
} from 'lucide-react';
import './Sidebar.css';

const navItems: { view: SidebarView; label: string; icon: React.ReactNode }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { view: 'nodes', label: 'Nodes', icon: <Server size={18} /> },
  { view: 'tasks', label: 'Tasks', icon: <ListTodo size={18} /> },
  { view: 'ide', label: 'Shared IDE', icon: <Code2 size={18} /> },
  { view: 'debug', label: 'Debug', icon: <Bug size={18} /> },
  { view: 'terminal', label: 'Terminal', icon: <Terminal size={18} /> },
  { view: 'files', label: 'Files', icon: <FolderOpen size={18} /> },
  { view: 'voice', label: 'Voice', icon: <Mic size={18} /> },
  { view: 'chat-history', label: 'Chat History', icon: <History size={18} /> },
  { view: 'project-builder', label: 'Project Builder', icon: <Layers size={18} /> },
  { view: 'settings', label: 'Settings', icon: <Settings size={18} /> },
];

export function Sidebar() {
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const tasks = useAppStore((s) => s.tasks);
  const debugIssues = useAppStore((s) => s.debugIssues);
  const projectSession = useAppStore((s) => s.projectSession);

  const runningTasks = tasks.filter((t) => t.status === 'running').length;
  const openIssues = debugIssues.filter((d) => d.status !== 'resolved').length;
  const runningSubtasks = projectSession?.status === 'running'
    ? (projectSession.subtasks.filter((s) => s.status === 'running' || s.status === 'assigned').length)
    : 0;

  const getBadge = (view: SidebarView): number | null => {
    if (view === 'tasks' && runningTasks > 0) return runningTasks;
    if (view === 'debug' && openIssues > 0) return openIssues;
    if (view === 'project-builder' && runningSubtasks > 0) return runningSubtasks;
    return null;
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <nav className="sidebar-nav">
        {navItems.map(({ view, label, icon }) => {
          const badge = getBadge(view);
          return (
            <button
              key={view}
              className={`sidebar-item ${activeView === view ? 'active' : ''}`}
              onClick={() => setActiveView(view)}
              title={collapsed ? label : undefined}
            >
              <span className="sidebar-icon">{icon}</span>
              {!collapsed && <span className="sidebar-label">{label}</span>}
              {badge !== null && (
                <span className="sidebar-badge">{badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      <button className="sidebar-toggle" onClick={toggleSidebar} aria-label="Toggle sidebar">
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </aside>
  );
}
