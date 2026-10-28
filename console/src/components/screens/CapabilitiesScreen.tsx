// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";
import {
  Sparkles,
  Layers,
  ArrowRight,
  ShieldAlert,
  GitMerge,
  BookOpen,
  CheckCircle2,
  Lock,
  Workflow,
  Cpu,
  FileCode2,
} from "lucide-react";
import { useI18n } from "../../locales/i18n";
import { PageHeader } from "../layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "../common/Card";
import { Badge } from "../common/Badge";
import { StatusIndicator } from "../common/StatusIndicator";

export const CapabilitiesScreen: React.FC = () => {
  const { t } = useI18n();

  const capabilities = [
    {
      id: "registry",
      title: t.capabilities.registryTitle,
      description: t.capabilities.registryDesc,
      icon: <Layers className="w-5 h-5 text-rosetta-blue dark:text-sky-400" />,
      specFile: "CAPABILITY_EXTENSIONS_V1.md",
      specEndpoint: "GET /v1/capabilities (Planned)",
    },
    {
      id: "resolver",
      title: t.capabilities.resolverTitle,
      description: t.capabilities.resolverDesc,
      icon: <GitMerge className="w-5 h-5 text-teal-600 dark:text-teal-400" />,
      specFile: "CAPABILITY_EXTENSIONS_V1.md",
      specEndpoint: "POST /v1/resolver/check (Planned)",
    },
    {
      id: "trust",
      title: t.capabilities.trustTitle,
      description: t.capabilities.trustDesc,
      icon: <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
      specFile: "CAPABILITY_TRUST_EXECUTION_V1.md",
      specEndpoint: "POST /v1/trust/grants (Planned)",
    },
    {
      id: "composition",
      title: t.capabilities.compositionTitle,
      description: t.capabilities.compositionDesc,
      icon: <Workflow className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
      specFile: "CAPABILITY_EXTENSIONS_V1.md",
      specEndpoint: "POST /v1/compositions/execute (Planned)",
    },
    {
      id: "hosting",
      title: t.capabilities.hostingTitle,
      description: t.capabilities.hostingDesc,
      icon: <Cpu className="w-5 h-5 text-slate-600 dark:text-slate-300" />,
      specFile: "DEPLOYMENT_MODEL.md",
      specEndpoint: "No runtime (Proposed)",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.capabilities.title}
        subtitle={t.capabilities.subtitle}
        badges={
          <Badge variant="sandstone">
            {t.capabilities.statusBadge}
          </Badge>
        }
      />

      {/* Honest Architectural Roadmap Notice */}
      <div className="p-4 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/50 flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200">
        <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          {t.capabilities.notice}
        </p>
      </div>

      {/* Layer-1 Headless Core vs Layer-2 Capabilities Architecture Diagram */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Ranh giới kiến trúc: Layer-1 Headless PaaS vs Tầng Năng lực mở rộng
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border border-teal-200 dark:border-teal-900/60 bg-teal-50/30 dark:bg-teal-950/20 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                <h4 className="font-bold text-teal-950 dark:text-teal-200 text-sm">
                  Đã triển khai hoàn tất (Layer-1 Foundation Core)
                </h4>
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400 leading-relaxed">
                <li>Identity/SSO qua Keycloak 26.8.1 (OIDC, S256 PKCE)</li>
                <li>Nginx API Gateway (Loopback reverse proxy, auth-request)</li>
                <li>Structured Data (PostgreSQL 17, PostgREST 16.5, SQL RLS)</li>
                <li>Object Storage (SeaweedFS 4.48, opaque immutable bytes)</li>
                <li>Workflow Engine (Flowable REST 8.0.0, SQL Idempotency Ledger)</li>
                <li>Application Registration, Approval & v2 Resource Sharing</li>
              </ul>
            </div>

            <div className="p-4 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/30 dark:bg-amber-950/20 space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <h4 className="font-bold text-amber-950 dark:text-amber-200 text-sm">
                  Lộ trình tương lai (Capability Extension Layer)
                </h4>
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400 leading-relaxed">
                <li>Capability Registry runtime & versioning catalog</li>
                <li>Semantic Compatibility Resolver</li>
                <li>Cross-App Trust, Delegation & On-Behalf-Of scope exchange</li>
                <li>Composition & Execution Graph Engine</li>
                <li>General-purpose Security Assessment Service</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Four Capability Modules */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {capabilities.map((cap) => (
          <Card key={cap.id} hoverable className="flex flex-col justify-between">
            <div>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-[#172E3C]">
                    {cap.icon}
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold">{cap.title}</CardTitle>
                    <span className="text-[11px] font-mono text-amber-600 dark:text-amber-400">
                      Design Specification Draft
                    </span>
                  </div>
                </div>
                <StatusIndicator status="planned" pulse={false} />
              </CardHeader>
              <CardContent className="pt-3">
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {cap.description}
                </p>
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-[#223E50]/70 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Đặc tả thiết kế:</span>
                  <code className="text-stone-ink dark:text-slate-200 text-[11px]">
                    {cap.specFile}
                  </code>
                </div>
              </CardContent>
            </div>
            <CardFooter>
              <div className="flex items-center justify-between w-full text-[11px]">
                <span className="font-mono text-slate-400">{cap.specEndpoint}</span>
                <Badge variant="sandstone">Planned</Badge>
              </div>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
};
