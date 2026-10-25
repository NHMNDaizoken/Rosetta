// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect } from "react";
import { ScreenId, UserIdentity } from "./types";
import { api } from "./services/apiClient";
import { I18nProvider } from "./locales/i18n";
import { ThemeProvider } from "./services/themeContext";
import { AppShell } from "./components/layout/AppShell";
import { OverviewScreen } from "./components/screens/OverviewScreen";
import { CoreServicesScreen } from "./components/screens/CoreServicesScreen";
import { ApplicationsScreen } from "./components/screens/ApplicationsScreen";
import { AccessResourcesScreen } from "./components/screens/AccessResourcesScreen";
import { WorkflowsScreen } from "./components/screens/WorkflowsScreen";
import { ApiExplorerScreen } from "./components/screens/ApiExplorerScreen";
import { SecurityActivityScreen } from "./components/screens/SecurityActivityScreen";
import { PlatformSettingsScreen } from "./components/screens/PlatformSettingsScreen";
import { CapabilitiesScreen } from "./components/screens/CapabilitiesScreen";
import { MOCK_IDENTITY } from "./services/mockData";

export const AppContent: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<ScreenId>(() => {
    const hash = window.location.hash.replace(/^#\/?/, "") as ScreenId;
    const valid: ScreenId[] = [
      "overview",
      "cores",
      "applications",
      "resources",
      "workflows",
      "api-explorer",
      "security",
      "settings",
      "capabilities",
    ];
    return valid.includes(hash) ? hash : "overview";
  });

  const [isLiveMode, setIsLiveMode] = useState<boolean>(api.getLiveMode());
  const [identity, setIdentity] = useState<UserIdentity>(MOCK_IDENTITY);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, "") as ScreenId;
      const valid: ScreenId[] = [
        "overview",
        "cores",
        "applications",
        "resources",
        "workflows",
        "api-explorer",
        "security",
        "settings",
        "capabilities",
      ];
      if (valid.includes(hash)) {
        setCurrentScreen(hash);
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    api.getIdentity().then(setIdentity);
  }, [isLiveMode]);

  const handleNavigate = (screen: ScreenId) => {
    setCurrentScreen(screen);
    window.location.hash = `#/${screen}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleToggleLiveMode = () => {
    const next = !isLiveMode;
    setIsLiveMode(next);
    api.setLiveMode(next);
  };

  const renderActiveScreen = () => {
    switch (currentScreen) {
      case "overview":
        return <OverviewScreen onNavigate={handleNavigate} identity={identity} />;
      case "cores":
        return <CoreServicesScreen />;
      case "applications":
        return <ApplicationsScreen />;
      case "resources":
        return <AccessResourcesScreen />;
      case "workflows":
        return <WorkflowsScreen />;
      case "api-explorer":
        return <ApiExplorerScreen />;
      case "security":
        return <SecurityActivityScreen />;
      case "settings":
        return <PlatformSettingsScreen />;
      case "capabilities":
        return <CapabilitiesScreen />;
      default:
        return <OverviewScreen onNavigate={handleNavigate} identity={identity} />;
    }
  };

  return (
    <AppShell
      currentScreen={currentScreen}
      onNavigate={handleNavigate}
      isLiveMode={isLiveMode}
      onToggleLiveMode={handleToggleLiveMode}
      identity={identity}
    >
      {renderActiveScreen()}
    </AppShell>
  );
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AppContent />
      </I18nProvider>
    </ThemeProvider>
  );
};

export default App;
