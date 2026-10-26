// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";
import {
  Menu,
  Moon,
  Sun,
  Globe,
  Radio,
  SlidersHorizontal,
  Building2,
  CheckCircle2,
} from "lucide-react";
import { ScreenId, IdentityState } from "../../types";
import { useI18n } from "../../locales/i18n";
import { useTheme } from "../../services/themeContext";
import { Breadcrumbs } from "./Breadcrumbs";
import { Badge } from "../common/Badge";

interface HeaderProps {
  currentScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  onOpenMobileMenu: () => void;
  isLiveMode: boolean;
  onToggleLiveMode: () => void;
  identityState: IdentityState;
}

export const Header: React.FC<HeaderProps> = ({
  currentScreen,
  onNavigate,
  onOpenMobileMenu,
  isLiveMode,
  onToggleLiveMode,
  identityState,
}) => {
  const { language, toggleLanguage, t } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const identity = identityState.identity;
  const identityText = identity?.tenantId ?? t.identity[identityState.status];
  const identityVerified =
    identityState.status === "authenticated" || identityState.status === "preview";

  return (
    <header className="h-16 px-4 md:px-6 bg-white/95 dark:bg-[#0E1A23]/95 backdrop-blur-xs border-b border-slate-200/80 dark:border-[#223E50] flex items-center justify-between sticky top-0 z-30 select-none">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileMenu}
          className="md:hidden p-2 rounded-md text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Open mobile menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <Breadcrumbs currentScreen={currentScreen} onNavigate={onNavigate} />
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {/* Mode Switcher Badge (Live Connected vs Demo Preview) */}
        <button
          onClick={onToggleLiveMode}
          title={isLiveMode ? t.common.liveModeTooltip : t.common.previewModeTooltip}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
            isLiveMode
              ? "bg-teal-50 border-teal-300 text-teal-800 dark:bg-teal-950/70 dark:border-teal-700 dark:text-teal-300 shadow-xs"
              : "bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/70 dark:border-amber-700 dark:text-amber-300"
          }`}
        >
          <Radio
            className={`w-3.5 h-3.5 ${
              isLiveMode ? "animate-pulse text-teal-600 dark:text-teal-400" : "text-amber-600 dark:text-amber-400"
            }`}
          />
          <span className="hidden sm:inline">
            {isLiveMode ? t.common.liveMode : t.common.previewMode}
          </span>
          <span className="sm:hidden">{isLiveMode ? "LIVE" : "DEMO"}</span>
        </button>

        {/* Tenant Indicator */}
        <div
          className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 dark:bg-[#172E3C] border border-slate-200/80 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 font-mono"
          title={identityState.status === "preview" ? t.identity.preview : undefined}
        >
          <Building2 className="w-3.5 h-3.5 text-rosetta-blue dark:text-sky-400" />
          <span>{identityText}</span>
          {identityVerified && (
            <CheckCircle2 className="w-3 h-3 text-teal-600 dark:text-teal-400 ml-0.5" />
          )}
        </div>

        {/* Language Toggle */}
        <button
          onClick={toggleLanguage}
          className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1 text-xs font-medium cursor-pointer"
          title={language === "vi" ? "Switch to English" : "Chuyển sang Tiếng Việt"}
          aria-label="Toggle language"
        >
          <Globe className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          <span className="uppercase text-[11px] font-bold">{language}</span>
        </button>

        {/* Dark / Light Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          title={isDark ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối"}
          aria-label="Toggle color theme"
        >
          {isDark ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-slate-600" />
          )}
        </button>

        {/* Settings Shortcut */}
        <button
          onClick={() => onNavigate("settings")}
          className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          title={t.nav.settings}
          aria-label="Settings"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
