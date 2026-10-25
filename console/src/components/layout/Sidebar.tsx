// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";
import {
  LayoutDashboard,
  Server,
  Layers,
  Database,
  GitBranch,
  Terminal,
  ShieldCheck,
  Settings,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LucideIcon,
} from "lucide-react";
import { ScreenId } from "../../types";
import { useI18n } from "../../locales/i18n";
import { RosettaLogo } from "../common/RosettaLogo";
import { BRAND } from "../../constants/brand";

interface SidebarProps {
  currentScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

interface NavItem {
  id: ScreenId;
  label: string;
  icon: LucideIcon;
  isRoadmap?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentScreen,
  onNavigate,
  isCollapsed,
  onToggleCollapse,
}) => {
  const { t } = useI18n();

  const navSections: NavSection[] = [
    {
      label: t.nav.workspace,
      items: [
        { id: "overview", label: t.nav.overview, icon: LayoutDashboard },
        { id: "cores", label: t.nav.cores, icon: Server },
        { id: "applications", label: t.nav.applications, icon: Layers },
      ],
    },
    {
      label: t.nav.platform,
      items: [
        { id: "resources", label: t.nav.resources, icon: Database },
        { id: "workflows", label: t.nav.workflows, icon: GitBranch },
        { id: "api-explorer", label: t.nav.apiExplorer, icon: Terminal },
      ],
    },
    {
      label: t.nav.operations,
      items: [
        { id: "security", label: t.nav.security, icon: ShieldCheck },
        { id: "settings", label: t.nav.settings, icon: Settings },
      ],
    },
    {
      label: t.nav.future,
      items: [
        {
          id: "capabilities",
          label: t.nav.capabilities,
          icon: Sparkles,
          isRoadmap: true,
        },
      ],
    },
  ];

  return (
    <aside
      className={`fixed top-0 left-0 bottom-0 z-40 bg-white dark:bg-[#0E1A23] border-r border-slate-200/80 dark:border-[#223E50] flex flex-col transition-all duration-300 select-none ${
        isCollapsed ? "w-16" : "w-64"
      }`}
      aria-label="Sidebar navigation"
    >
      {/* Brand Header */}
      <div className="h-16 px-4 border-b border-slate-100 dark:border-[#223E50]/70 flex items-center justify-between">
        <button
          onClick={() => onNavigate("overview")}
          className="flex items-center text-left focus:outline-none"
        >
          <RosettaLogo size={32} showText={!isCollapsed} />
        </button>
        <button
          onClick={onToggleCollapse}
          className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title={isCollapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Nav Items */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-6">
        {navSections.map((section, idx) => (
          <div key={idx} className="space-y-1">
            {!isCollapsed && (
              <div className="px-3 pb-1.5 text-[10px] font-bold tracking-wider text-slate-400 dark:text-slate-500 uppercase">
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = currentScreen === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  title={isCollapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition-colors relative group ${
                    isActive
                      ? "bg-[#E8F3F5] text-[#176B80] dark:bg-[#172E3C] dark:text-sky-300 font-semibold"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100/80 dark:hover:bg-[#172E3C]/50 hover:text-stone-ink dark:hover:text-slate-200"
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 flex-shrink-0 transition-transform ${
                      isActive ? "text-[#176B80] dark:text-sky-300" : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300"
                    }`}
                  />
                  {!isCollapsed && (
                    <span className="truncate flex-1 text-left">{item.label}</span>
                  )}
                  {!isCollapsed && item.isRoadmap && (
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                      Roadmap
                    </span>
                  )}
                  {isActive && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-[#176B80] dark:bg-sky-400" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer Info */}
      <div className="p-3 border-t border-slate-100 dark:border-[#223E50]/70 bg-slate-50/50 dark:bg-[#12232F]/30 text-[11px] text-slate-500 dark:text-slate-400">
        {!isCollapsed ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-stone-ink dark:text-slate-200">
                {BRAND.layer}
              </span>
              <span className="text-[10px] text-slate-400">v{BRAND.version}</span>
            </div>
            <a
              href={BRAND.githubUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[10px] text-rosetta-blue dark:text-sky-400 hover:underline mt-1"
            >
              <span>Mã nguồn GitHub</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        ) : (
          <div className="text-center font-bold text-slate-400 text-xs">v1</div>
        )}
      </div>
    </aside>
  );
};
