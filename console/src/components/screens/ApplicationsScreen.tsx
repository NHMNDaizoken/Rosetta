// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect } from "react";
import {
  Layers,
  Search,
  Plus,
  CheckCircle,
  Clock,
  AlertCircle,
  XCircle,
  ShieldCheck,
  PauseCircle,
  PlayCircle,
  Ban,
  Info,
  Check,
  ExternalLink,
} from "lucide-react";
import { Application, Approval, ApplicationState } from "../../types";
import { api } from "../../services/apiClient";
import { useI18n } from "../../locales/i18n";
import { PageHeader } from "../layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "../common/Card";
import { Badge } from "../common/Badge";
import { Button } from "../common/Button";
import { SearchFilterBar } from "../common/SearchFilterBar";
import { ConfirmationDialog } from "../common/ConfirmationDialog";
import { DetailDrawer } from "../common/DetailDrawer";
import { StatusIndicator } from "../common/StatusIndicator";

export const ApplicationsScreen: React.FC = () => {
  const { t } = useI18n();
  const [applications, setApplications] = useState<Application[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);

  // App Lookup by ID
  const [lookupId, setLookupId] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Registration Modal / Form State
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newOAuthClientId, setNewOAuthClientId] = useState("");
  const [newProviderOrigin, setNewProviderOrigin] = useState("https://");
  const [isSubmittingRegister, setIsSubmittingRegister] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  // Approval Creation State
  const [isApprovalOpen, setIsApprovalOpen] = useState(false);
  const [approvalDecision, setApprovalDecision] = useState<"approve" | "deny">("approve");
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  // State Transition Modal State
  const [isStateOpen, setIsStateOpen] = useState(false);
  const [targetAction, setTargetAction] = useState<"suspend" | "reactivate" | "revoke">("suspend");
  const [stateReason, setStateReason] = useState("");
  const [isSubmittingState, setIsSubmittingState] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);

  const loadApps = async () => {
    const list = await api.getApplicationsList();
    setApplications(list);
  };

  useEffect(() => {
    loadApps();
  }, []);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupId.trim()) return;
    setIsLookingUp(true);
    setLookupError(null);
    try {
      const app = await api.getApplication(lookupId.trim());
      if (app) {
        setSelectedApp(app);
      } else {
        setLookupError("Không tìm thấy ứng dụng với ID đã cung cấp trong tenant này.");
      }
    } catch {
      setLookupError("Lỗi kết nối khi tra cứu ứng dụng.");
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingRegister(true);
    setRegisterError(null);
    try {
      const created = await api.registerApplication({
        displayName: newDisplayName.trim(),
        oauthClientId: newOAuthClientId.trim(),
        providerOrigin: newProviderOrigin.trim(),
      });
      await loadApps();
      setSelectedApp(created);
      setIsRegisterOpen(false);
      setNewDisplayName("");
      setNewOAuthClientId("");
      setNewProviderOrigin("https://");
    } catch (err: unknown) {
      setRegisterError((err as Error).message);
    } finally {
      setIsSubmittingRegister(false);
    }
  };

  const handleApprovalSubmit = async () => {
    if (!selectedApp) return;
    setIsSubmittingApproval(true);
    setApprovalError(null);
    try {
      // Step 1: Create approval (valid for 10 minutes)
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const approval = await api.createApproval({
        resourceId: selectedApp.appId,
        resourceDigest: selectedApp.digest,
        resourceRevision: selectedApp.revision,
        requesterSubject: selectedApp.ownerSubject,
        requesterAppId: selectedApp.appId,
        decision: approvalDecision,
        expiresAt,
      });

      // Step 2: If decision was approve, consume approval to activate
      if (approvalDecision === "approve") {
        await api.approveApplication(selectedApp.appId, approval.approvalId);
      }

      await loadApps();
      const updated = await api.getApplication(selectedApp.appId);
      if (updated) setSelectedApp(updated);
      setIsApprovalOpen(false);
    } catch (err: unknown) {
      setApprovalError((err as Error).message);
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  const handleStateSubmit = async () => {
    if (!selectedApp) return;
    setIsSubmittingState(true);
    setStateError(null);
    try {
      await api.transitionApplicationState(
        selectedApp.appId,
        targetAction,
        stateReason.trim() || "Operational state transition"
      );
      await loadApps();
      const updated = await api.getApplication(selectedApp.appId);
      if (updated) setSelectedApp(updated);
      setIsStateOpen(false);
      setStateReason("");
    } catch (err: unknown) {
      setStateError((err as Error).message);
    } finally {
      setIsSubmittingState(false);
    }
  };

  const getStateBadge = (state: ApplicationState) => {
    switch (state) {
      case "active":
        return <Badge variant="teal">Hoạt động (Active)</Badge>;
      case "pending":
        return <Badge variant="warning">Chờ duyệt (Pending)</Badge>;
      case "suspended":
        return <Badge variant="destructive">Tạm đình chỉ (Suspended)</Badge>;
      case "revoked":
        return <Badge variant="outline">Đã thu hồi (Revoked)</Badge>;
      default:
        return <Badge>{state}</Badge>;
    }
  };

  const filteredApps = applications.filter(
    (app) =>
      app.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.appId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.oauthClientId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.applications.title}
        subtitle={t.applications.subtitle}
        actions={
          <Button
            variant="primary"
            size="md"
            onClick={() => setIsRegisterOpen(true)}
            leftIcon={<Plus className="w-4 h-4" />}
          >
            {t.applications.registerNewApp}
          </Button>
        }
      />

      {/* Contract & Directory Architecture Notice */}
      <div className="p-4 rounded-lg bg-slate-50 dark:bg-[#12232F] border border-slate-200/80 dark:border-[#223E50] flex items-start gap-3 text-xs text-slate-600 dark:text-slate-300">
        <Info className="w-4 h-4 text-rosetta-blue dark:text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          {t.applications.globalListNotice}
        </p>
      </div>

      {/* ID Lookup Card */}
      <Card>
        <CardContent className="py-4">
          <form onSubmit={handleLookup} className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value)}
                placeholder={t.applications.enterAppId}
                className="w-full pl-9 pr-4 py-1.5 text-xs rounded-md border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#12232F] text-stone-ink dark:text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-rosetta-blue"
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              isLoading={isLookingUp}
            >
              {t.applications.lookupBtn}
            </Button>
          </form>
          {lookupError && (
            <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
              {lookupError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Applications Table */}
      <Card>
        <CardHeader>
          <div className="w-full">
            <SearchFilterBar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              placeholder="Lọc ứng dụng theo tên hoặc OAuth Client..."
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-[#172E3C]/40 border-b border-slate-200/80 dark:border-[#223E50] text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3">Ứng dụng</th>
                  <th className="px-5 py-3">OAuth Client ID</th>
                  <th className="px-5 py-3">Provider Origin</th>
                  <th className="px-5 py-3">Trạng thái</th>
                  <th className="px-5 py-3">Phiên bản (Rev)</th>
                  <th className="px-5 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#223E50]/70">
                {filteredApps.map((app) => (
                  <tr
                    key={app.appId}
                    className="hover:bg-slate-50/80 dark:hover:bg-[#172E3C]/30 transition-colors"
                  >
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-stone-ink dark:text-slate-100">
                        {app.displayName}
                      </div>
                      <div className="font-mono text-[10px] text-slate-400">
                        {app.appId}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[11px]">
                      {app.oauthClientId}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 font-mono text-[11px] truncate max-w-[180px]">
                      {app.providerOrigin}
                    </td>
                    <td className="px-5 py-3.5">
                      {getStateBadge(app.state)}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[11px]">
                      r{app.revision}
                    </td>
                    <td className="px-5 py-3.5 text-right space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedApp(app)}
                      >
                        {t.common.viewDetails}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Application Details Drawer */}
      <DetailDrawer
        isOpen={!!selectedApp}
        onClose={() => setSelectedApp(null)}
        title={selectedApp?.displayName ?? ""}
        subtitle={selectedApp?.appId}
        width="lg"
      >
        {selectedApp && (
          <div className="space-y-6 text-xs text-slate-600 dark:text-slate-300">
            {/* Status and Action Header */}
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-[#172E3C]/40 border border-slate-200/80 dark:border-[#223E50] flex items-center justify-between">
              <div>
                <span className="text-slate-400 block text-[11px]">Trạng thái hiện tại</span>
                <div className="mt-1">{getStateBadge(selectedApp.state)}</div>
              </div>
              <div className="flex gap-2">
                {selectedApp.state === "pending" && (
                  <Button
                    variant="teal"
                    size="sm"
                    onClick={() => setIsApprovalOpen(true)}
                    leftIcon={<ShieldCheck className="w-3.5 h-3.5" />}
                  >
                    Phê duyệt (Two-Person)
                  </Button>
                )}
                {selectedApp.state === "active" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTargetAction("suspend");
                      setIsStateOpen(true);
                    }}
                    leftIcon={<PauseCircle className="w-3.5 h-3.5" />}
                  >
                    Đình chỉ
                  </Button>
                )}
                {selectedApp.state === "suspended" && (
                  <Button
                    variant="teal"
                    size="sm"
                    onClick={() => {
                      setTargetAction("reactivate");
                      setIsStateOpen(true);
                    }}
                    leftIcon={<PlayCircle className="w-3.5 h-3.5" />}
                  >
                    Kích hoạt lại
                  </Button>
                )}
                {selectedApp.state !== "revoked" && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setTargetAction("revoke");
                      setIsStateOpen(true);
                    }}
                    leftIcon={<Ban className="w-3.5 h-3.5" />}
                  >
                    Thu hồi vĩnh viễn
                  </Button>
                )}
              </div>
            </div>

            {/* Application Identity Metadata */}
            <div className="space-y-3">
              <h4 className="font-semibold text-stone-ink dark:text-slate-100 text-sm">
                Thông tin định danh & Ghi danh
              </h4>
              <div className="space-y-2.5 p-4 rounded-lg border border-slate-200/80 dark:border-[#223E50]">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Tenant:</span>
                  <span className="font-mono font-medium">{selectedApp.tenantId}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Chủ sở hữu (Owner Subject):</span>
                  <span className="font-mono text-[11px] truncate max-w-[240px]">{selectedApp.ownerSubject}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">OAuth Client ID:</span>
                  <span className="font-mono font-medium">{selectedApp.oauthClientId}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Provider Origin:</span>
                  <span className="font-mono text-rosetta-blue dark:text-sky-400">{selectedApp.providerOrigin}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Revision:</span>
                  <span className="font-mono">r{selectedApp.revision}</span>
                </div>
              </div>
            </div>

            {/* Cryptographic Digest */}
            <div className="space-y-2">
              <h4 className="font-semibold text-stone-ink dark:text-slate-100 text-sm">
                Proposal Digest (JCS SHA-256)
              </h4>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Mã băm SHA-256 xác thực bất biến được quản trị viên độc lập kiểm tra trước khi ký quyết định phê duyệt.
              </p>
              <div className="p-3 bg-slate-900 rounded font-mono text-[11px] text-emerald-400 break-all border border-slate-800">
                {selectedApp.digest}
              </div>
            </div>
          </div>
        )}
      </DetailDrawer>

      {/* Registration Modal Dialog */}
      <ConfirmationDialog
        isOpen={isRegisterOpen}
        onCancel={() => setIsRegisterOpen(false)}
        onConfirm={handleRegisterSubmit as unknown as () => void}
        title={t.applications.registerNewApp}
        description="Đề xuất đăng ký ứng dụng mới vào tenant hiện tại qua POST /v1/applications."
        confirmLabel={t.applications.formSubmitRegister}
        isLoading={isSubmittingRegister}
        variant="info"
      >
        <div className="space-y-4 my-2 text-left">
          {registerError && (
            <div className="p-2.5 rounded bg-rose-50 text-rose-700 text-xs border border-rose-200">
              {registerError}
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-1">
              {t.applications.formDisplayName}
            </label>
            <input
              type="text"
              required
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder="VD: Rosetta Logistics Hub"
              className="w-full px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#12232F] text-stone-ink dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-rosetta-blue"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-1">
              {t.applications.formOAuthClientId}
            </label>
            <input
              type="text"
              required
              value={newOAuthClientId}
              onChange={(e) => setNewOAuthClientId(e.target.value)}
              placeholder="VD: tenant-a-logistics-client"
              className="w-full px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#12232F] text-stone-ink dark:text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-rosetta-blue"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-1">
              {t.applications.formProviderOrigin}
            </label>
            <input
              type="url"
              required
              value={newProviderOrigin}
              onChange={(e) => setNewProviderOrigin(e.target.value)}
              placeholder="https://provider.example.com"
              className="w-full px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#12232F] text-stone-ink dark:text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-rosetta-blue"
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              Bắt buộc giao thức HTTPS chuẩn, không chứa IP hoặc path.
            </span>
          </div>
        </div>
      </ConfirmationDialog>

      {/* Two-Person Approval Modal */}
      <ConfirmationDialog
        isOpen={isApprovalOpen}
        onCancel={() => setIsApprovalOpen(false)}
        onConfirm={handleApprovalSubmit}
        title={t.applications.createApprovalTitle}
        description="Quản trị viên độc lập kiểm tra proposal digest và ký quyết định phê duyệt."
        confirmLabel={t.applications.submitApprovalBtn}
        isLoading={isSubmittingApproval}
        variant="warning"
      >
        <div className="space-y-4 my-2 text-left">
          {approvalError && (
            <div className="p-2.5 rounded bg-rose-50 text-rose-700 text-xs border border-rose-200">
              {approvalError}
            </div>
          )}
          <div className="p-3 bg-slate-50 dark:bg-[#172E3C]/50 rounded border border-slate-200/80 dark:border-[#223E50] text-xs space-y-1">
            <span className="text-slate-500">Digest cần xác thực:</span>
            <div className="font-mono text-[10px] text-stone-ink dark:text-slate-200 break-all">
              {selectedApp?.digest}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-1">
              Quyết định (Decision)
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="decision"
                  checked={approvalDecision === "approve"}
                  onChange={() => setApprovalDecision("approve")}
                />
                <span className="text-emerald-700 dark:text-emerald-400 font-medium">Chấp thuận (Approve)</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="decision"
                  checked={approvalDecision === "deny"}
                  onChange={() => setApprovalDecision("deny")}
                />
                <span className="text-rose-700 dark:text-rose-400 font-medium">Từ chối (Deny)</span>
              </label>
            </div>
          </div>
        </div>
      </ConfirmationDialog>

      {/* State Transition Modal */}
      <ConfirmationDialog
        isOpen={isStateOpen}
        onCancel={() => setIsStateOpen(false)}
        onConfirm={handleStateSubmit}
        title={`Chuyển trạng thái: ${targetAction.toUpperCase()}`}
        description={`Thao tác chuyển trạng thái ứng dụng '${selectedApp?.displayName}' sang ${targetAction}.`}
        confirmLabel={t.common.confirm}
        isLoading={isSubmittingState}
        variant={targetAction === "revoke" ? "danger" : "warning"}
      >
        <div className="space-y-4 my-2 text-left">
          {stateError && (
            <div className="p-2.5 rounded bg-rose-50 text-rose-700 text-xs border border-rose-200">
              {stateError}
            </div>
          )}
          {targetAction === "revoke" && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded text-xs text-rose-700 dark:text-rose-300">
              {t.common.terminalStateNotice}
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-1">
              {t.applications.actionReason}
            </label>
            <textarea
              rows={3}
              required
              value={stateReason}
              onChange={(e) => setStateReason(e.target.value)}
              placeholder={t.applications.actionReasonPlaceholder}
              className="w-full px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#12232F] text-stone-ink dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-rosetta-blue"
            />
          </div>
        </div>
      </ConfirmationDialog>
    </div>
  );
};
