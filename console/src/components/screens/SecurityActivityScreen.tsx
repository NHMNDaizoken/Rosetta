// SPDX-FileCopyrightText: 2026 Junctura Contributors
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
import { AuditSessionEvent, AuditVerification } from "../../types";
import { api } from "../../services/apiClient";
import { useI18n } from "../../locales/i18n";
import { PageHeader } from "../layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "../common/Card";
import { Badge } from "../common/Badge";
import { Button } from "../common/Button";

export const SecurityActivityScreen: React.FC = () => {
  const { t } = useI18n();
  const [sessionEvents] = useState<AuditSessionEvent[]>(api.getSessionActivity());

  const [verification, setVerification] = useState<AuditVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const runVerification = async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      setVerification(await api.verifyAuditChain());
    } catch (error) {
      setVerification(null);
      const code = error instanceof Error ? error.message : "";
      setVerifyError(
        code === "audit_permission_required"
          ? t.security.chainErrorPermission
          : `${t.security.chainErrorGeneric}: ${code || "request_failed"}`
      );
    } finally {
      setVerifying(false);
    }
  };

  const reasonLabel = (reason: string) =>
    (t.security as Record<string, string>)[`reason_${reason}`] ?? reason;

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

      {/* Protected audit and hash-chain integrity check */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <CardTitle>{t.security.chainTitle}</CardTitle>
          </div>
          <Badge variant="sandstone">SHA-256</Badge>
        </CardHeader>
        <CardContent className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
          <p className="leading-relaxed">{t.security.auditExplanation}</p>
          <p className="leading-relaxed">{t.security.chainExplanation}</p>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={runVerification} disabled={verifying} leftIcon={<ShieldCheck className="w-4 h-4" />}>
              {verifying ? t.security.chainChecking : t.security.chainButton}
            </Button>
            {verification?.preview && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">{t.security.chainPreview}</span>
            )}
          </div>

          {verifyError && (
            <div role="alert" className="p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{verifyError}</span>
            </div>
          )}

          {verification && !verification.preview && (
            <div
              role="status"
              className={`p-4 rounded-lg border space-y-2 ${
                verification.verified
                  ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30"
                  : "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30"
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-sm">
                {verification.verified ? (
                  <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                )}
                <span className={verification.verified ? "text-emerald-800 dark:text-emerald-200" : "text-red-800 dark:text-red-200"}>
                  {verification.verified ? t.security.chainIntact : t.security.chainBroken}
                </span>
              </div>
              <p>
                <strong>{verification.entries}</strong> {t.security.chainEntries}
                {verification.newlySealed > 0 && (
                  <> · <strong>{verification.newlySealed}</strong> {t.security.chainNewlySealed}</>
                )}
                {" · "}
                <Clock className="inline w-3 h-3 -mt-0.5" />{" "}
                {new Date(verification.verifiedAt).toLocaleString()}
              </p>
              {verification.headHash && (
                <p className="font-mono text-[11px] break-all text-slate-500 dark:text-slate-400">
                  {t.security.chainHead}: {verification.headHash}
                </p>
              )}
              {verification.firstBreak && (
                <p className="text-red-700 dark:text-red-300">
                  {t.security.chainBreakAt} <strong>#{verification.firstBreak.chainSeq}</strong>
                  {" — "}
                  {reasonLabel(verification.firstBreak.reason)}
                  {verification.firstBreak.eventId && (
                    <span className="block font-mono text-[11px] mt-1 break-all">{verification.firstBreak.eventId}</span>
                  )}
                </p>
              )}
            </div>
          )}
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
