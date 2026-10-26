// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect } from "react";
import {
  Database,
  FileCode,
  FileText,
  Share2,
  Plus,
  Trash2,
  Clock,
  Layers,
  Lock,
  Upload,
  Info,
  CheckCircle,
  Eye,
  AlertTriangle,
} from "lucide-react";
import { StructuredRecord, StoredObject, ResourceShare } from "../../types";
import { api } from "../../services/apiClient";
import { useI18n } from "../../locales/i18n";
import { PageHeader } from "../layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "../common/Card";
import { Badge } from "../common/Badge";
import { Button } from "../common/Button";
import { SearchFilterBar } from "../common/SearchFilterBar";
import { ConfirmationDialog } from "../common/ConfirmationDialog";
import { DetailDrawer } from "../common/DetailDrawer";
import { CodeBlock } from "../common/CodeBlock";

export const AccessResourcesScreen: React.FC = () => {
  const { t } = useI18n();
  const isLive = api.getLiveMode();
  const [activeTab, setActiveTab] = useState<"records" | "objects" | "shares">("records");

  // Records state
  const [records, setRecords] = useState<StructuredRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<StructuredRecord | null>(null);
  const [isCreateRecordOpen, setIsCreateRecordOpen] = useState(false);
  const [newCollection, setNewCollection] = useState("devices");
  const [newRecordJson, setNewRecordJson] = useState('{\n  "status": "operational",\n  "version": "1.0"\n}');
  const [recordError, setRecordError] = useState<string | null>(null);

  // Objects state
  const [objects, setObjects] = useState<StoredObject[]>([]);
  const [selectedObject, setSelectedObject] = useState<StoredObject | null>(null);

  // Shares state
  const [shares, setShares] = useState<ResourceShare[]>([]);
  const [isCreateShareOpen, setIsCreateShareOpen] = useState(false);
  const [shareResourceType, setShareResourceType] = useState<"record" | "object">("record");
  const [shareResourceId, setShareResourceId] = useState("");
  const [shareGranteeAppId, setShareGranteeAppId] = useState("");
  const [shareMinutes, setShareMinutes] = useState(60);
  const [shareError, setShareError] = useState<string | null>(null);

  // Revoke Share Confirmation
  const [shareToRevoke, setShareToRevoke] = useState<ResourceShare | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const loadData = async () => {
    const [recs, objs, shrs] = await Promise.all([
      api.getRecords(),
      api.getObjects(),
      api.getResourceShares(),
    ]);
    setRecords(recs);
    setObjects(objs);
    setShares(shrs);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLive) {
      setRecordError(t.resources.previewOnlyOperation);
      return;
    }
    setRecordError(null);
    try {
      const parsed = JSON.parse(newRecordJson);
      const created = await api.createRecord(newCollection.trim(), parsed);
      await loadData();
      setIsCreateRecordOpen(false);
      setSelectedRecord(created);
    } catch (err: unknown) {
      setRecordError((err as Error).message || "JSON không hợp lệ");
    }
  };

  const handleCreateShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLive) {
      setShareError(t.resources.previewOnlyOperation);
      return;
    }
    setShareError(null);
    try {
      const expiresAt = new Date(Date.now() + shareMinutes * 60 * 1000).toISOString();
      await api.createResourceShare({
        resourceType: shareResourceType,
        resourceId: shareResourceId.trim(),
        granteeAppId: shareGranteeAppId.trim(),
        expiresAt,
      });
      await loadData();
      setIsCreateShareOpen(false);
      setShareResourceId("");
      setShareGranteeAppId("");
    } catch (err: unknown) {
      setShareError((err as Error).message);
    }
  };

  const handleRevokeShare = async () => {
    if (!shareToRevoke) return;
    if (isLive) {
      setShareToRevoke(null);
      return;
    }
    setIsRevoking(true);
    try {
      await api.revokeResourceShare(shareToRevoke.shareId);
      await loadData();
      setShareToRevoke(null);
    } catch {
      // Error
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.resources.title}
        subtitle={t.resources.subtitle}
        badges={<Badge variant="rosetta">v2 App-Private Namespace</Badge>}
        actions={
          activeTab === "records" ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setIsCreateRecordOpen(true)}
              leftIcon={<Plus className="w-4 h-4" />}
              disabled={isLive}
              title={isLive ? t.resources.liveActionsDisabled : undefined}
            >
              {t.resources.createRecord}
            </Button>
          ) : activeTab === "shares" ? (
            <Button
              variant="teal"
              size="md"
              onClick={() => setIsCreateShareOpen(true)}
              leftIcon={<Share2 className="w-4 h-4" />}
              disabled={isLive}
              title={isLive ? t.resources.liveActionsDisabled : undefined}
            >
              {t.resources.createShare}
            </Button>
          ) : null
        }
      />

      {/* Legacy Boundary Notice */}
      <div className="p-4 rounded-lg bg-slate-50 dark:bg-[#12232F] border border-slate-200/80 dark:border-[#223E50] flex items-start gap-3 text-xs text-slate-600 dark:text-slate-300">
        <Lock className="w-4 h-4 text-rosetta-blue dark:text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          {t.resources.legacyNotice}
        </p>
      </div>

      {isLive && (
        <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="leading-relaxed">{t.resources.liveUnsupportedNotice}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-[#223E50] gap-6 text-xs font-semibold select-none">
        <button
          onClick={() => setActiveTab("records")}
          className={`pb-3 flex items-center gap-2 transition-colors relative cursor-pointer ${
            activeTab === "records"
              ? "text-[#176B80] dark:text-sky-400"
              : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <Database className="w-4 h-4" />
          <span>{t.resources.structuredDataTab}</span>
          <Badge variant="outline" className="ml-1 text-[10px]">
            {records.length}
          </Badge>
          {activeTab === "records" && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#176B80] dark:bg-sky-400" />
          )}
        </button>

        <button
          onClick={() => setActiveTab("objects")}
          className={`pb-3 flex items-center gap-2 transition-colors relative cursor-pointer ${
            activeTab === "objects"
              ? "text-[#176B80] dark:text-sky-400"
              : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <FileCode className="w-4 h-4" />
          <span>{t.resources.objectsTab}</span>
          <Badge variant="outline" className="ml-1 text-[10px]">
            {objects.length}
          </Badge>
          {activeTab === "objects" && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#176B80] dark:bg-sky-400" />
          )}
        </button>

        <button
          onClick={() => setActiveTab("shares")}
          className={`pb-3 flex items-center gap-2 transition-colors relative cursor-pointer ${
            activeTab === "shares"
              ? "text-[#18877A] dark:text-teal-400"
              : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <Share2 className="w-4 h-4" />
          <span>{t.resources.sharesTab}</span>
          <Badge variant="teal" className="ml-1 text-[10px]">
            {shares.length}
          </Badge>
          {activeTab === "shares" && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#18877A] dark:bg-teal-400" />
          )}
        </button>
      </div>

      {/* Tab Content: Structured Records */}
      {activeTab === "records" && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-[#172E3C]/40 border-b border-slate-200/80 dark:border-[#223E50] text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Collection</th>
                    <th className="px-5 py-3">Record UUID</th>
                    <th className="px-5 py-3">Dữ liệu tóm tắt (JSON Keys)</th>
                    <th className="px-5 py-3">Phân loại</th>
                    <th className="px-5 py-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#223E50]/70">
                  {records.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-slate-400">
                        {isLive ? t.resources.liveEmptyList : t.common.noData}
                      </td>
                    </tr>
                  )}
                  {records.map((r) => (
                    <tr
                      key={r.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-[#172E3C]/30 transition-colors"
                    >
                      <td className="px-5 py-3 font-semibold text-stone-ink dark:text-slate-100">
                        {r.collection}
                      </td>
                      <td className="px-5 py-3 font-mono text-[11px] text-slate-400">
                        {r.id}
                      </td>
                      <td className="px-5 py-3 text-slate-500 font-mono text-[11px]">
                        {Object.keys(r.data).join(", ")}
                      </td>
                      <td className="px-5 py-3">
                        {r.isShared ? (
                          <Badge variant="teal">Đã chia sẻ (Shared)</Badge>
                        ) : (
                          <Badge variant="outline">Riêng tư (Owned)</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedRecord(r)}
                          leftIcon={<Eye className="w-3.5 h-3.5" />}
                        >
                          Xem JSON
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tab Content: Objects */}
      {activeTab === "objects" && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-[#172E3C]/40 border-b border-slate-200/80 dark:border-[#223E50] text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Object UUID</th>
                    <th className="px-5 py-3">Dung lượng</th>
                    <th className="px-5 py-3">Content-Type</th>
                    <th className="px-5 py-3">Phiên bản</th>
                    <th className="px-5 py-3 text-right">Ranh giới</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#223E50]/70">
                  {objects.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-slate-400">
                        {isLive ? t.resources.liveEmptyList : t.common.noData}
                      </td>
                    </tr>
                  )}
                  {objects.map((obj) => (
                    <tr
                      key={obj.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-[#172E3C]/30 transition-colors"
                    >
                      <td className="px-5 py-3 font-mono text-[11px] font-semibold text-stone-ink dark:text-slate-100">
                        {obj.id}
                      </td>
                      <td className="px-5 py-3 font-mono text-[11px]">
                        {(obj.size / 1024).toFixed(1)} KB
                      </td>
                      <td className="px-5 py-3 text-slate-500 font-mono text-[11px]">
                        {obj.contentType}
                      </td>
                      <td className="px-5 py-3 font-mono text-[11px]">
                        v{obj.version ?? 1}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Badge variant="outline">SeaweedFS Opaque</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tab Content: Resource Shares */}
      {activeTab === "shares" && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-[#172E3C]/40 border-b border-slate-200/80 dark:border-[#223E50] text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Share ID</th>
                    <th className="px-5 py-3">Loại tài nguyên</th>
                    <th className="px-5 py-3">Resource UUID</th>
                    <th className="px-5 py-3">Grantee App ID</th>
                    <th className="px-5 py-3">Thời hạn hết hạn</th>
                    <th className="px-5 py-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#223E50]/70">
                  {shares.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-6 text-center text-slate-400">
                        {isLive ? t.resources.liveEmptyList : t.common.noData}
                      </td>
                    </tr>
                  )}
                  {shares.map((s) => (
                    <tr
                      key={s.shareId}
                      className="hover:bg-slate-50/80 dark:hover:bg-[#172E3C]/30 transition-colors"
                    >
                      <td className="px-5 py-3 font-mono text-[11px] font-semibold text-stone-ink dark:text-slate-100">
                        {s.shareId.substring(0, 13)}...
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant="rosetta">{s.resourceType.toUpperCase()}</Badge>
                      </td>
                      <td className="px-5 py-3 font-mono text-[11px] text-slate-500">
                        {s.resourceId}
                      </td>
                      <td className="px-5 py-3 font-mono text-[11px] text-slate-500">
                        {s.granteeAppId}
                      </td>
                      <td className="px-5 py-3 font-mono text-[11px] text-amber-700 dark:text-amber-400">
                        {new Date(s.expiresAt).toLocaleString("vi-VN")}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setShareToRevoke(s)}
                          leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                          disabled={isLive}
                          title={isLive ? t.resources.liveActionsDisabled : undefined}
                        >
                          Thu hồi
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Record Inspector Drawer */}
      <DetailDrawer
        isOpen={!!selectedRecord}
        onClose={() => setSelectedRecord(null)}
        title={`Bản ghi: ${selectedRecord?.collection}`}
        subtitle={selectedRecord?.id}
      >
        {selectedRecord && (
          <div className="space-y-4">
            <div>
              <span className="text-slate-400 text-xs">Mã định danh bản ghi:</span>
              <div className="font-mono text-xs text-stone-ink dark:text-slate-200 mt-0.5">
                {selectedRecord.id}
              </div>
            </div>

            <div>
              <span className="text-slate-400 text-xs">Nội dung JSON (Payload):</span>
              <div className="mt-2">
                <CodeBlock
                  code={JSON.stringify(selectedRecord.data, null, 2)}
                  language="json"
                />
              </div>
            </div>
          </div>
        )}
      </DetailDrawer>

      {/* Create Record Modal */}
      <ConfirmationDialog
        isOpen={isCreateRecordOpen}
        onCancel={() => setIsCreateRecordOpen(false)}
        onConfirm={handleCreateRecord as unknown as () => void}
        title={t.resources.createRecord}
        description="Tạo bản ghi mới trong collection ứng dụng qua POST /v2/data/{collection}."
        confirmLabel="Lưu bản ghi"
        variant="info"
      >
        <div className="space-y-4 my-2 text-left">
          {recordError && (
            <div className="p-2.5 rounded bg-rose-50 text-rose-700 text-xs border border-rose-200">
              {recordError}
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-1">
              {t.resources.collectionName}
            </label>
            <input
              type="text"
              required
              value={newCollection}
              onChange={(e) => setNewCollection(e.target.value)}
              placeholder="VD: devices, sensors, logs"
              className="w-full px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#12232F] text-stone-ink dark:text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-rosetta-blue"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-1">
              {t.resources.recordDataJson}
            </label>
            <textarea
              rows={5}
              required
              value={newRecordJson}
              onChange={(e) => setNewRecordJson(e.target.value)}
              className="w-full px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#12232F] text-stone-ink dark:text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-rosetta-blue"
            />
          </div>
        </div>
      </ConfirmationDialog>

      {/* Create Share Modal */}
      <ConfirmationDialog
        isOpen={isCreateShareOpen}
        onCancel={() => setIsCreateShareOpen(false)}
        onConfirm={handleCreateShare as unknown as () => void}
        title={t.resources.createShare}
        description="Cấp quyền chia sẻ chỉ đọc (read-only) có thời hạn cho backend ứng dụng thụ hưởng qua POST /v2/resource-shares."
        confirmLabel="Cấp quyền chia sẻ"
        variant="info"
      >
        <div className="space-y-4 my-2 text-left">
          {shareError && (
            <div className="p-2.5 rounded bg-rose-50 text-rose-700 text-xs border border-rose-200">
              {shareError}
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-1">
              {t.resources.shareResourceType}
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="resourceType"
                  checked={shareResourceType === "record"}
                  onChange={() => setShareResourceType("record")}
                />
                <span>Bản ghi (Record)</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="resourceType"
                  checked={shareResourceType === "object"}
                  onChange={() => setShareResourceType("object")}
                />
                <span>Đối tượng nhị phân (Object)</span>
              </label>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-1">
              {t.resources.shareResourceId}
            </label>
            <input
              type="text"
              required
              value={shareResourceId}
              onChange={(e) => setShareResourceId(e.target.value)}
              placeholder="Nhập UUID của bản ghi hoặc object..."
              className="w-full px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#12232F] text-stone-ink dark:text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-rosetta-blue"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-1">
              {t.resources.shareGranteeAppId}
            </label>
            <input
              type="text"
              required
              value={shareGranteeAppId}
              onChange={(e) => setShareGranteeAppId(e.target.value)}
              placeholder="Nhập App ID của ứng dụng được cấp quyền đọc..."
              className="w-full px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#12232F] text-stone-ink dark:text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-rosetta-blue"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-1">
              Thời gian hiệu lực (Phút)
            </label>
            <input
              type="number"
              min={1}
              max={10080}
              value={shareMinutes}
              onChange={(e) => setShareMinutes(Number(e.target.value))}
              className="w-full px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#12232F] text-stone-ink dark:text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-rosetta-blue"
            />
          </div>
        </div>
      </ConfirmationDialog>

      {/* Revoke Share Confirmation */}
      <ConfirmationDialog
        isOpen={!!shareToRevoke}
        onCancel={() => setShareToRevoke(null)}
        onConfirm={handleRevokeShare}
        title="Thu hồi liên kết chia sẻ tài nguyên"
        description={`Bạn có chắc muốn thu hồi quyền chia sẻ '${shareToRevoke?.shareId}'? Ứng dụng thụ hưởng sẽ mất ngay quyền truy cập.`}
        confirmLabel={t.common.delete}
        isLoading={isRevoking}
        variant="danger"
      />
    </div>
  );
};
