// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect } from "react";
import { ScreenId, IdentityState } from "./types";
import { api } from "./services/apiClient";
import { I18nProvider } from "./locales/i18n";
import { ThemeProvider } from "./services/themeContext";
import { AppShell } from "./components/layout/AppShell";
import { OverviewScreen } from "./components/screens/OverviewScreen";
import { CoreServicesScreen } from "./components/screens/CoreServicesScreen";
import { ApplicationsScreen } from "./components/screens/ApplicationsScreen";
import { AccessResourcesScreen } from "./components/screens/AccessResourcesScreen";
import { WorkflowsScreen } from "./components/screens/WorkflowsScreen";
import { GettingStartedScreen } from "./components/screens/GettingStartedScreen";
import { ApiExplorerScreen } from "./components/screens/ApiExplorerScreen";
import { SecurityActivityScreen } from "./components/screens/SecurityActivityScreen";
import { PlatformSettingsScreen } from "./components/screens/PlatformSettingsScreen";
import { CapabilitiesScreen } from "./components/screens/CapabilitiesScreen";
import { MOCK_IDENTITY } from "./services/mockData";

const VALID_SCREENS: ScreenId[] = [
  "overview",
  "cores",
  "applications",
  "resources",
  "workflows",
  "getting-started",
  "api-explorer",
  "security",
  "settings",
  "capabilities",
];

function screenFromHash(): ScreenId {
  const hash = window.location.hash.replace(/^#\/?/, "") as ScreenId;
  return VALID_SCREENS.includes(hash) ? hash : "overview";
}

export const AppContent: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<ScreenId>(screenFromHash);

  const [isLiveMode, setIsLiveMode] = useState<boolean>(api.getLiveMode());
  const [identityState, setIdentityState] = useState<IdentityState>(() =>
    api.getLiveMode()
      ? { status: "loading" }
      : { status: "preview", identity: MOCK_IDENTITY }
  );
  const [identityNonce, setIdentityNonce] = useState(0);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, "") as ScreenId;
      if (VALID_SCREENS.includes(hash)) {
        setCurrentScreen(hash);
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (!isLiveMode) {
      setIdentityState({ status: "preview", identity: MOCK_IDENTITY });
      return;
    }
    let cancelled = false;
    setIdentityState({ status: "loading" });
    api.getIdentity().then((next) => {
      if (!cancelled) setIdentityState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [isLiveMode, identityNonce]);

  useEffect(() => {
    return api.subscribe(() => {
      const live = api.getLiveMode();
      setIsLiveMode(live);
      setIdentityState(
        live ? { status: "loading" } : { status: "preview", identity: MOCK_IDENTITY }
      );
      setIdentityNonce((value) => value + 1);
    });
  }, []);

  const handleNavigate = (screen: ScreenId) => {
    setCurrentScreen(screen);
    window.location.hash = `#/${screen}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleToggleLiveMode = () => {
    const next = !isLiveMode;
    setIsLiveMode(next);
    setIdentityState(
      next ? { status: "loading" } : { status: "preview", identity: MOCK_IDENTITY }
    );
    api.setLiveMode(next);
  };

  const modeKey = isLiveMode ? "live" : "preview";
  const retryIdentity = () => {
    setIdentityState({ status: "loading" });
    setIdentityNonce((value) => value + 1);
  };

  const renderActiveScreen = () => {
    switch (currentScreen) {
      case "overview":
        return (
          <OverviewScreen
            key={modeKey}
            onNavigate={handleNavigate}
            identityState={identityState}
            onRetryIdentity={retryIdentity}
          />
        );
      case "cores":
        return <CoreServicesScreen />;
      case "applications":
        return <ApplicationsScreen key={modeKey} />;
      case "resources":
        return <AccessResourcesScreen key={modeKey} />;
      case "workflows":
        return <WorkflowsScreen key={modeKey} />;
      case "getting-started":
        return <GettingStartedScreen />;
      case "api-explorer":
        return <ApiExplorerScreen />;
      case "security":
        return <SecurityActivityScreen key={modeKey} />;
      case "settings":
        return <PlatformSettingsScreen />;
      case "capabilities":
        return <CapabilitiesScreen />;
      default:
        return (
          <OverviewScreen
            key={modeKey}
            onNavigate={handleNavigate}
            identityState={identityState}
            onRetryIdentity={retryIdentity}
          />
        );
    }
  };

  return (
    <AppShell
      currentScreen={currentScreen}
      onNavigate={handleNavigate}
      isLiveMode={isLiveMode}
      onToggleLiveMode={handleToggleLiveMode}
      identityState={identityState}
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
