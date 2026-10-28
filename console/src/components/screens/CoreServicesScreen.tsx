// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React, { useEffect, useState } from "react";
import {
  Server,
  ShieldCheck,
  Database,
  FolderArchive,
  GitPullRequest,
  CheckCircle2,
  ExternalLink,
  Lock,
  Network,
  Info,
} from "lucide-react";
import { BRAND } from "../../constants/brand";
import { api } from "../../services/apiClient";
import { ReadyStatus } from "../../types";
import { useI18n } from "../../locales/i18n";
import { PageHeader } from "../layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "../common/Card";
import { Badge } from "../common/Badge";
import { StatusIndicator } from "../common/StatusIndicator";
import { Button } from "../common/Button";
import { DetailDrawer } from "../common/DetailDrawer";

export const CoreServicesScreen: React.FC = () => {
  const { t, language } = useI18n();
  const [selectedCore, setSelectedCore] = useState<(typeof BRAND.cores)[0] | null>(null);
  const [ready, setReady] = useState<ReadyStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getReady().then((result) => {
      if (!cancelled) setReady(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const readiness =
    ready?.status === "ready" ? "ready" : ready?.status === "not_ready" ? "error" : "unknown";

  const getCoreIcon = (id: string) => {
    switch (id) {
      case "identity":
        return <ShieldCheck className="w-5 h-5 text-rosetta-blue dark:text-sky-400" />;
      case "gateway":
        return <Network className="w-5 h-5 text-teal-600 dark:text-teal-400" />;
      case "data":
        return <Database className="w-5 h-5 text-amber-600 dark:text-amber-400" />;
      case "objects":
        return <FolderArchive className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />;
      case "workflow":
        return <GitPullRequest className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />;
      default:
        return <Server className="w-5 h-5 text-slate-500" />;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.cores.title}
        subtitle={t.cores.subtitle}
        badges={<Badge variant="teal">5/5 Cores Implemented</Badge>}
      />

      {/* Network Isolation Security Notice */}
      <div className="p-4 rounded-lg bg-slate-50 dark:bg-[#12232F] border border-slate-200/80 dark:border-[#223E50] flex items-start gap-3 text-xs text-slate-600 dark:text-slate-300">
        <Lock className="w-4 h-4 text-rosetta-blue dark:text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          {t.cores.securityBoundaryInfo}
        </p>
      </div>

      <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
        <StatusIndicator status={readiness} />
        <span>{t.cores.readinessNote}</span>
      </div>

      {/* Five Core Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {BRAND.cores.map((core) => (
          <Card key={core.id} hoverable className="flex flex-col justify-between">
            <div>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-[#172E3C]">
                    {getCoreIcon(core.id)}
                  </div>
                  <div>
                    <CardTitle className="text-base">{core.name}</CardTitle>
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                      {core.provider}
                    </span>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4 pt-4">
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {language === "vi" ? core.description : core.enDescription}
                </p>

                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-[#223E50]/70 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">
                      {t.cores.protocol}:
                    </span>
                    <span className="font-medium text-stone-ink dark:text-slate-200">
                      {core.protocol}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">
                      {t.cores.portBoundary}:
                    </span>
                    <span className="font-mono text-[11px] text-stone-ink dark:text-slate-200">
                      {core.port}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">
                      {t.cores.verifiedRoute}:
                    </span>
                    <code className="text-[11px] text-rosetta-blue dark:text-sky-400">
                      {core.statusRoute}
                    </code>
                  </div>
                </div>
              </CardContent>
            </div>

            <CardFooter>
              <div className="flex items-center justify-between w-full">
                <span className="text-[11px] text-slate-400">
                  Container Isolated
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedCore(core)}
                >
                  {t.common.viewDetails}
                </Button>
              </div>
            </CardFooter>
          </Card>
        ))}
      </div>

      {/* Drawer for In-depth Core Inspection */}
      <DetailDrawer
        isOpen={!!selectedCore}
        onClose={() => setSelectedCore(null)}
        title={selectedCore?.name ?? ""}
        subtitle={selectedCore?.provider}
      >
        {selectedCore && (
          <div className="space-y-6 text-xs text-slate-600 dark:text-slate-300">
            <div>
              <h4 className="font-semibold text-stone-ink dark:text-slate-100 text-sm mb-1">
                Kiến trúc & Ranh giới vận hành
              </h4>
              <p className="leading-relaxed">
                {language === "vi" ? selectedCore.description : selectedCore.enDescription}
              </p>
            </div>

            <div className="space-y-3 p-4 rounded-lg bg-slate-50 dark:bg-[#172E3C]/40 border border-slate-200/70 dark:border-[#223E50]">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Giao thức:</span>
                <span className="font-semibold text-stone-ink dark:text-slate-100">{selectedCore.protocol}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Mạng nội bộ:</span>
                <span className="font-mono text-stone-ink dark:text-slate-100">{selectedCore.port}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Hợp đồng kiểm tra:</span>
                <span className="font-mono text-rosetta-blue dark:text-sky-400">{selectedCore.statusRoute}</span>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-stone-ink dark:text-slate-100 text-sm mb-2">
                Giới hạn kỹ thuật & Hướng dẫn quản trị viên
              </h4>
              <div className="p-3.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200 leading-relaxed">
                {selectedCore.limitations}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-[#223E50]">
              <h4 className="font-semibold text-stone-ink dark:text-slate-100 text-sm mb-2">
                Tài liệu hợp đồng Layer 1
              </h4>
              <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                Xem chi tiết đặc tả tại tập tin <code className="text-stone-ink dark:text-slate-200">docs/CORE_API.md</code> và mã nguồn adapter trong thư mục <code className="text-stone-ink dark:text-slate-200">src/</code>.
              </p>
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
};
