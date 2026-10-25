// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";
import { ChevronRight, Home } from "lucide-react";
import { ScreenId } from "../../types";
import { useI18n } from "../../locales/i18n";

interface BreadcrumbsProps {
  currentScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ currentScreen, onNavigate }) => {
  const { t } = useI18n();

  const getScreenTitle = (screen: ScreenId) => {
    switch (screen) {
      case "overview":
        return t.nav.overview;
      case "cores":
        return t.nav.cores;
      case "applications":
        return t.nav.applications;
      case "resources":
        return t.nav.resources;
      case "workflows":
        return t.nav.workflows;
      case "api-explorer":
        return t.nav.apiExplorer;
      case "security":
        return t.nav.security;
      case "settings":
        return t.nav.settings;
      case "capabilities":
        return t.nav.capabilities;
      default:
        return screen;
    }
  };

  return (
    <nav aria-label="Breadcrumb" className="flex items-center text-xs text-slate-500 dark:text-slate-400">
      <button
        onClick={() => onNavigate("overview")}
        className="flex items-center gap-1.5 hover:text-stone-ink dark:hover:text-slate-100 transition-colors"
      >
        <Home className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Rosetta</span>
      </button>

      {currentScreen !== "overview" && (
        <>
          <ChevronRight className="w-3 h-3 mx-2 text-slate-400 flex-shrink-0" />
          <span className="font-medium text-stone-ink dark:text-slate-200">
            {getScreenTitle(currentScreen)}
          </span>
        </>
      )}
    </nav>
  );
};
