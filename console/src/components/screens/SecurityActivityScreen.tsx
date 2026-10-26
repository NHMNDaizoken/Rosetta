// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React, { useState } from "react";
import {
  ShieldCheck,
  Lock,
  Key,
  Database,
  Terminal,
  Activity,
  CheckCircle,
  AlertTriangle,
  FileText,
  Clock,
  Info,
} from "lucide-react";
import { AuditSessionEvent } from "../../types";
import { api } from "../../services/apiClient";
import { useI18n } from "../../locales/i18n";
import { PageHeader } from "../layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "../common/Card";
import { Badge } from "../common/Badge";
import { CodeBlock } from "../common/CodeBlock";

export const SecurityActivityScreen: React.FC = () => {
  const { t } = useI18n();
  const [sessionEvents] = useState<AuditSessionEvent[]>(api.getSessionActivity());

  const auditProposalContract = `// Proposed Administrative Audit Endpoint Contract
// GET /v1/admin/audit-events
// Requires: Administrator-enrolled subject + Keycloak 'admin' role
{
  "total": 128,
  "limit": 50,
  "offset": 0,
  "items": [
    {
      "id": "audit-uuid-v4",
      "timestamp": "2026-10-25T15:20:00Z",
      "action": "APPLICATION_REGISTERED",
      "subject": "operator-subject-uuid",
      "tenantId": "tenant-a",
      "resourceType": "application",
      "resourceId": "app-uuid-v4",
      "decision": "approve",
      "digest": "sha256:...",
      "clientIp": "127.0.0.1"
    }
  ]
}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.security.title}
        subtitle={t.security.subtitle}
        badges={<Badge variant="teal">Defense-in-Depth</Badge>}
      />

      {/* Multi-Tier Defense Architecture */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            <CardTitle>{t.security.architectureTitle}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          <div className="p-3 rounded-lg border border-slate-200/80 dark:border-[#223E50] bg-slate-50/50 dark:bg-[#172E3C]/30 flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 font-bold flex items-center justify-center text-[10px] flex-shrink-0">1</span>
            <p>{t.security.layerBoundary1}</p>
          </div>
          <div className="p-3 rounded-lg border border-slate-200/80 dark:border-[#223E50] bg-slate-50/50 dark:bg-[#172E3C]/30 flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300 font-bold flex items-center justify-center text-[10px] flex-shrink-0">2</span>
            <p>{t.security.layerBoundary2}</p>
          </div>
          <div className="p-3 rounded-lg border border-slate-200/80 dark:border-[#223E50] bg-slate-50/50 dark:bg-[#172E3C]/30 flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-bold flex items-center justify-center text-[10px] flex-shrink-0">3</span>
            <p>{t.security.layerBoundary3}</p>
          </div>
          <div className="p-3 rounded-lg border border-slate-200/80 dark:border-[#223E50] bg-slate-50/50 dark:bg-[#172E3C]/30 flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold flex items-center justify-center text-[10px] flex-shrink-0">4</span>
            <p>{t.security.layerBoundary4}</p>
          </div>
          <div className="p-3 rounded-lg border border-slate-200/80 dark:border-[#223E50] bg-slate-50/50 dark:bg-[#172E3C]/30 flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 font-bold flex items-center justify-center text-[10px] flex-shrink-0">5</span>
            <p>{t.security.layerBoundary5}</p>
          </div>
        </CardContent>
      </Card>

      {/* Honest Audit Events Boundary Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <CardTitle>{t.security.auditTitle}</CardTitle>
          </div>
          <Badge variant="sandstone">Database Isolated</Badge>
        </CardHeader>
        <CardContent className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
          <p className="leading-relaxed">
            {t.security.auditExplanation}
          </p>

          <div className="p-3.5 bg-slate-50 dark:bg-[#172E3C]/30 rounded-lg border border-slate-200/80 dark:border-[#223E50] space-y-2">
            <h5 className="font-semibold text-stone-ink dark:text-slate-100 text-xs">
              Hướng dẫn kiểm toán cho Quản trị viên hệ thống (Operator):
            </h5>
            <ol className="list-decimal list-inside space-y-1 text-slate-500 dark:text-slate-400 text-[11px] font-mono">
              <li>docker compose logs --follow core | grep "application_"</li>
              <li>docker compose exec database psql -U rosetta_admin -d rosetta_data -c "SELECT * FROM app_private.audit_events ORDER BY created_at DESC LIMIT 20;"</li>
            </ol>
          </div>

          <div className="pt-2">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">
              Đề xuất hợp đồng tương lai cho Admin Audit API:
            </span>
            <CodeBlock code={auditProposalContract} language="json" />
          </div>
        </CardContent>
      </Card>

      {/* Current Session Activity Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {t.security.sessionActivityTitle}
          </CardTitle>
          <Badge variant="outline">
            {sessionEvents.length} {t.security.sessionEventsSuffix}
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <p className="px-5 py-3 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-[#223E50]/70">
            {t.security.sessionDiagnosticsNotice}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-[#172E3C]/40 border-b border-slate-200/80 dark:border-[#223E50] text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3">Thời gian</th>
                  <th className="px-5 py-3">Hành động</th>
                  <th className="px-5 py-3">Phân loại</th>
                  <th className="px-5 py-3">Chi tiết</th>
                  <th className="px-5 py-3 text-right">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#223E50]/70 font-mono text-[11px]">
                {sessionEvents.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center font-sans text-slate-400">
                      {t.common.noData}
                    </td>
                  </tr>
                )}
                {sessionEvents.map((evt) => (
                  <tr
                    key={evt.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-[#172E3C]/30 transition-colors"
                  >
                    <td className="px-5 py-3 text-slate-400">
                      {new Date(evt.timestamp).toLocaleTimeString("vi-VN")}
                    </td>
                    <td className="px-5 py-3 font-semibold text-stone-ink dark:text-slate-100">
                      {evt.action}
                    </td>
                    <td className="px-5 py-3 font-sans">
                      <Badge variant="outline">{evt.category}</Badge>
                    </td>
                    <td className="px-5 py-3 text-slate-500 font-sans max-w-md truncate">
                      {evt.details}
                    </td>
                    <td className="px-5 py-3 text-right font-sans">
                      <Badge variant={evt.status === "success" ? "teal" : "destructive"}>
                        {evt.status.toUpperCase()}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
