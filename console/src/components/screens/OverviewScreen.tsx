// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect } from "react";
import {
  Activity,
  CheckCircle,
  AlertTriangle,
  Clock,
  Layers,
  ArrowRight,
  RefreshCw,
  Server,
  GitBranch,
  Terminal,
  ShieldCheck,
  Building2,
  Info,
} from "lucide-react";
import { HealthStatus, ReadyStatus, IdentityState, ScreenId } from "../../types";
import { api } from "../../services/apiClient";
import { useI18n } from "../../locales/i18n";
import { BRAND } from "../../constants/brand";
import { PageHeader } from "../layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../common/Card";
import { StatCard } from "../common/StatCard";
import { StatusIndicator } from "../common/StatusIndicator";
import { Badge } from "../common/Badge";
import { Button } from "../common/Button";

interface OverviewScreenProps {
  onNavigate: (screen: ScreenId) => void;
  identityState: IdentityState;
  onRetryIdentity: () => void;
}

export const OverviewScreen: React.FC<OverviewScreenProps> = ({
  onNavigate,
  identityState,
  onRetryIdentity,
}) => {
  const { t } = useI18n();
  const identity = identityState.identity;
  const identityStatusText = t.identity[identityState.status];
  const identityBadgeVariant =
    identityState.status === "authenticated"
      ? "teal"
      : identityState.status === "preview"
        ? "sandstone"
        : "destructive";
  const identityBadgeText =
    identityState.status === "authenticated"
      ? t.identity.verified
      : identityState.status === "preview"
        ? t.identity.preview
        : identityStatusText;
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [ready, setReady] = useState<ReadyStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    const [h, r] = await Promise.all([api.getHealth(), api.getReady()]);
    setHealth(h);
    setReady(r);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.overview.title}
        subtitle={t.overview.subtitle}
        badges={
          <Badge variant={ready?.status === "ready" ? "teal" : "warning"}>
            {ready?.status === "ready" ? t.common.systemHealthy : t.common.systemDegraded}
          </Badge>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            isLoading={loading}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            {t.common.refresh}
          </Button>
        }
      />

      {/* Honest Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Core Process Liveness */}
        <StatCard
          title={t.overview.processLiveness}
          value={health?.status === "ok" ? "200 OK" : "DEGRADED"}
          subtitle={health?.latencyMs ? `${health.latencyMs}ms latency` : "Responding"}
          icon={<Activity className="w-4 h-4 text-rosetta-blue dark:text-sky-400" />}
          statusIndicator={
            <StatusIndicator status={health?.status === "ok" ? "ok" : "error"} />
          }
          badge={<Badge variant="rosetta">GET /health</Badge>}
        />

        {/* 5 Core Dependencies Readiness */}
        <StatCard
          title={t.overview.dependencyReadiness}
          value={
            ready?.status === "ready"
              ? "READY (5/5)"
              : ready?.status === "not_ready"
                ? "NOT READY"
                : "CHECKING"
          }
          subtitle={
            ready?.status === "ready"
              ? "All configured dependencies responded"
              : ready?.status === "not_ready"
                ? "At least one dependency failed"
                : "Awaiting /ready"
          }
          icon={<Server className="w-4 h-4 text-teal-600 dark:text-teal-400" />}
          statusIndicator={
            <StatusIndicator status={ready?.status === "ready" ? "ready" : ready?.status === "not_ready" ? "error" : "unknown"} />
          }
          badge={<Badge variant="teal">GET /ready</Badge>}
        />

        {/* Active Tenant Context */}
        <StatCard
          title={t.overview.activeTenant}
          value={identity?.tenantId ?? identityStatusText}
          subtitle={
            identity
              ? `${t.common.roles}: ${identity.roles.join(", ")}`
              : t.overview.identityNoSubstitution
          }
          icon={<Building2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
          badge={
            <Badge variant={identityBadgeVariant}>
              {identityBadgeText}
            </Badge>
          }
        />

        {/* Control Plane Boundary */}
        <StatCard
          title="Layer-1 Headless Control"
          value="Loopback Only"
          subtitle="Nginx 127.0.0.1:8080"
          icon={<ShieldCheck className="w-4 h-4 text-stone-600 dark:text-slate-300" />}
          badge={<Badge variant="outline">No Public VPS</Badge>}
        />
      </div>

      {api.getLiveMode() && identityState.status !== "authenticated" && (
        <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 flex flex-col sm:flex-row sm:items-start gap-3 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="space-y-1 flex-1">
            <p className="font-semibold">{t.overview.identityRequiredTitle}</p>
            <p className="leading-relaxed">
              {identityState.status === "missing"
                ? t.overview.identityRequiredDesc
                : identityState.status === "rejected"
                  ? t.overview.identityRejectedDesc
                  : `${identityStatusText}. ${t.overview.identityNoSubstitution}.`}
            </p>
          </div>
          <div className="flex gap-2 sm:ml-auto">
            <Button variant="outline" size="sm" onClick={onRetryIdentity}>
              {t.common.retry}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onNavigate("settings")}>
              {t.nav.settings}
            </Button>
          </div>
        </div>
      )}

      {/* Architectural Notice on Honest Telemetry */}
      <div className="p-4 rounded-lg bg-slate-50 dark:bg-[#12232F] border border-slate-200/80 dark:border-[#223E50] flex items-start gap-3 text-xs text-slate-600 dark:text-slate-300">
        <Info className="w-4 h-4 text-rosetta-blue dark:text-sky-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-stone-ink dark:text-slate-100">
            {t.overview.verifiedReadinessNotice}
          </p>
          <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
            {t.overview.honestMetricsNotice}
          </p>
        </div>
      </div>

      {/* 5 Foundational Cores Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-stone-ink dark:text-slate-100 tracking-tight">
              {t.overview.coreSummaryTitle}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t.overview.coreSummaryDesc}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigate("cores")}
            rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
          >
            {t.common.viewDetails}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {BRAND.cores.map((core) => (
            <Card key={core.id} hoverable className="flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-md bg-[#E8F3F5] dark:bg-[#172E3C] flex items-center justify-center text-[#176B80] dark:text-sky-400 font-bold text-xs">
                      {core.id.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold">{core.name}</CardTitle>
                      <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                        {core.provider}
                      </span>
                    </div>
                  </div>
                  <StatusIndicator
                    status={
                      ready?.status === "ready"
                        ? "ready"
                        : ready?.status === "not_ready"
                          ? "error"
                          : "unknown"
                    }
                  />
                </div>
              </CardHeader>
              <CardContent className="py-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <p>{core.description}</p>
                <div className="mt-3 pt-2 border-t border-slate-100 dark:border-[#223E50]/70 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="font-mono">{core.port}</span>
                  <Badge variant="outline">{core.protocol.split(" ")[0]}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Quick Action Shortcuts */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t.overview.quickActions}</CardTitle>
            <CardDescription>
              Các lối tắt nhanh tới quy trình vận hành và kiểm thử hợp đồng đã triển khai.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <button
              onClick={() => onNavigate("applications")}
              className="p-4 rounded-lg border border-slate-200 dark:border-[#223E50] hover:border-rosetta-blue dark:hover:border-sky-500 bg-white dark:bg-[#12232F] hover:shadow-xs transition-all text-left flex items-start gap-3 group cursor-pointer"
            >
              <div className="p-2 rounded bg-sky-50 dark:bg-sky-950/60 text-rosetta-blue dark:text-sky-400 group-hover:scale-105 transition-transform">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-stone-ink dark:text-slate-100 group-hover:text-rosetta-blue dark:group-hover:text-sky-400">
                  {t.overview.registerApp}
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  POST /v1/applications
                </p>
              </div>
            </button>

            <button
              onClick={() => onNavigate("workflows")}
              className="p-4 rounded-lg border border-slate-200 dark:border-[#223E50] hover:border-teal-600 dark:hover:border-teal-400 bg-white dark:bg-[#12232F] hover:shadow-xs transition-all text-left flex items-start gap-3 group cursor-pointer"
            >
              <div className="p-2 rounded bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 group-hover:scale-105 transition-transform">
                <GitBranch className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-stone-ink dark:text-slate-100 group-hover:text-teal-600 dark:group-hover:text-teal-400">
                  {t.overview.startWorkflow}
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  POST /v1/workflows/executions
                </p>
              </div>
            </button>

            <button
              onClick={() => onNavigate("api-explorer")}
              className="p-4 rounded-lg border border-slate-200 dark:border-[#223E50] hover:border-amber-600 dark:hover:border-amber-400 bg-white dark:bg-[#12232F] hover:shadow-xs transition-all text-left flex items-start gap-3 group cursor-pointer"
            >
              <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 group-hover:scale-105 transition-transform">
                <Terminal className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-stone-ink dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400">
                  {t.overview.exploreApis}
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  OpenAPI 3.1 (44 Operations)
                </p>
              </div>
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
