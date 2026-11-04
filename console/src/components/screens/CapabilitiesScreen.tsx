// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";
import { Layers, GitMerge, Lock, Send, Workflow, ShieldCheck, Info } from "lucide-react";
import { useI18n } from "../../locales/i18n";
import { PageHeader } from "../layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "../common/Card";
import { Badge } from "../common/Badge";
import { TrustGraphPanel } from "./TrustGraphPanel";

export const CapabilitiesScreen: React.FC = () => {
  const { t } = useI18n();
  const c = t.capabilities;

  const modules = [
    { id: "registry", title: c.registryTitle, description: c.registryDesc, icon: Layers, endpoint: "GET /v1/capabilities", optIn: false },
    { id: "trust", title: c.trustTitle, description: c.trustDesc, icon: Lock, endpoint: "POST /v1/trust/grants", optIn: false },
    { id: "audit", title: c.auditTitle, description: c.auditDesc, icon: ShieldCheck, endpoint: "POST /v1/audit-events/verify", optIn: false },
    { id: "invocation", title: c.invocationTitle, description: c.invocationDesc, icon: Send, endpoint: "POST /v1/capability-executions", optIn: true },
    { id: "composition", title: c.compositionTitle, description: c.compositionDesc, icon: Workflow, endpoint: "POST /v1/compositions", optIn: true },
    { id: "resolver", title: c.resolverTitle, description: c.resolverDesc, icon: GitMerge, endpoint: "…/versions/{version}/validate", optIn: true },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={c.title} subtitle={c.subtitle} badges={<Badge variant="teal">{c.statusBadge}</Badge>} />

      <TrustGraphPanel />

      <div className="p-4 rounded-lg bg-sky-50/70 dark:bg-sky-950/20 border border-sky-200/80 dark:border-sky-900/50 flex items-start gap-3 text-xs text-sky-900 dark:text-sky-200">
        <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="leading-relaxed">{c.notice}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{c.modulesTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {modules.map(({ id, title, description, icon: Icon, endpoint, optIn }) => (
              <div key={id} className="p-4 rounded-lg border border-slate-200/80 dark:border-[#223E50] flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-md bg-slate-100 dark:bg-[#172E3C]">
                      <Icon className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                    </div>
                    <h4 className="font-semibold text-sm text-stone-ink dark:text-slate-100">{title}</h4>
                  </div>
                  <Badge variant={optIn ? "sandstone" : "teal"}>{optIn ? c.statusOptIn : c.statusImplemented}</Badge>
                </div>
                <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300 flex-1">{description}</p>
                <code className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{endpoint}</code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
