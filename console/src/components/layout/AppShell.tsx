// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React, { useState } from "react";
import { ScreenId, UserIdentity } from "../../types";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { BRAND } from "../../constants/brand";
import { RosettaLogo } from "../common/RosettaLogo";
import { X } from "lucide-react";

interface AppShellProps {
  currentScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  isLiveMode: boolean;
  onToggleLiveMode: () => void;
  identity: UserIdentity;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentScreen,
  onNavigate,
  isLiveMode,
  onToggleLiveMode,
  identity,
  children,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const handleMobileNavigate = (screen: ScreenId) => {
    onNavigate(screen);
    setIsMobileOpen(false);
  };

  return (
    <div className="min-h-screen bg-app-bg text-stone-ink dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
      {/* Desktop Persistent Sidebar */}
      <div className="hidden md:block">
        <Sidebar
          currentScreen={currentScreen}
          onNavigate={onNavigate}
          isCollapsed={isCollapsed}
          onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
        />
      </div>

      {/* Mobile Drawer */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs md:hidden"
          onClick={() => setIsMobileOpen(false)}
        >
          <div
            className="w-64 bg-white dark:bg-[#0E1A23] h-full shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-16 px-4 border-b border-slate-100 dark:border-[#223E50]/70 flex items-center justify-between">
              <RosettaLogo size={28} showText={true} />
              <button
                onClick={() => setIsMobileOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <Sidebar
                currentScreen={currentScreen}
                onNavigate={handleMobileNavigate}
                isCollapsed={false}
                onToggleCollapse={() => {}}
              />
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col transition-all duration-300 ${
          isCollapsed ? "md:pl-16" : "md:pl-64"
        }`}
      >
        <Header
          currentScreen={currentScreen}
          onNavigate={onNavigate}
          onOpenMobileMenu={() => setIsMobileOpen(true)}
          isLiveMode={isLiveMode}
          onToggleLiveMode={onToggleLiveMode}
          identity={identity}
        />

        <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full">
          {children}
        </main>

        <footer className="py-4 px-6 border-t border-slate-200/70 dark:border-[#223E50]/50 text-center text-xs text-slate-500 dark:text-slate-400 bg-white/40 dark:bg-[#0E1A23]/30">
          <p>{BRAND.copyright} — {BRAND.concept}</p>
        </footer>
      </div>
    </div>
  );
};
