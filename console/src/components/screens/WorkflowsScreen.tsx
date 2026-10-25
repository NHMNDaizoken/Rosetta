// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect } from "react";
import {
  GitBranch,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  ArrowRight,
  RefreshCw,
  Plus,
  Info,
  Check,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { WorkflowDefinition, WorkflowExecution } from "../../types";
import { api } from "../../services/apiClient";
import { useI18n } from "../../locales/i18n";
import { PageHeader } from "../layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "../common/Card";
import { Badge } from "../common/Badge";
import { Button } from "../common/Button";
import { StatusIndicator } from "../common/StatusIndicator";
import { ConfirmationDialog } from "../common/ConfirmationDialog";
import { DetailDrawer } from "../common/DetailDrawer";
import { CodeBlock } from "../common/CodeBlock";

export const WorkflowsScreen: React.FC = () => {
  const { t } = useI18n();
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [selectedExecution, setSelectedExecution] = useState<WorkflowExecution | null>(null);

  // Start execution state
  const [isStartOpen, setIsStartOpen] = useState(false);
  const [selectedDefId, setSelectedDefId] = useState("");
  const [inputVariables, setInputVariables] = useState('{\n  "technicalFixture": true\n}');
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Complete task state
  const [isCompleting, setIsCompleting] = useState(false);

  // Cancel execution state
  const [executionToCancel, setExecutionToCancel] = useState<WorkflowExecution | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const loadWorkflows = async () => {
    const [defs, execs] = await Promise.all([
      api.getWorkflowDefinitions(),
      api.getWorkflowExecutions(),
    ]);
    setDefinitions(defs);
    setExecutions(execs);
    if (defs.length > 0 && !selectedDefId) {
      setSelectedDefId(defs[0].id);
    }
  };

  useEffect(() => {
    loadWorkflows();
  }, []);

  const handleStartSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsStarting(true);
    setStartError(null);
    try {
      const parsedInput = JSON.parse(inputVariables);
      const newExec = await api.startWorkflowExecution(selectedDefId, parsedInput);
      await loadWorkflows();
      setIsStartOpen(false);
      setSelectedExecution(newExec);
    } catch (err: unknown) {
      setStartError((err as Error).message || "JSON không hợp lệ");
    } finally {
      setIsStarting(false);
    }
  };

  const handleCompleteTask = async (executionId: string) => {
    setIsCompleting(true);
    try {
      await api.completeWorkflowTask(executionId);
      await loadWorkflows();
      const updated = executions.find((e) => e.id === executionId);
      if (updated) setSelectedExecution({ ...updated, status: "completed" });
    } catch {
      // Error
    } finally {
      setIsCompleting(false);
    }
  };

  const handleCancelExecution = async () => {
    if (!executionToCancel) return;
    setIsCancelling(true);
    try {
      await api.cancelWorkflowExecution(executionToCancel.id);
      await loadWorkflows();
      setExecutionToCancel(null);
      if (selectedExecution?.id === executionToCancel.id) {
        setSelectedExecution({ ...selectedExecution, status: "cancelled" });
      }
    } catch {
      // Error
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.workflows.title}
        subtitle={t.workflows.subtitle}
        badges={<Badge variant="rosetta">Flowable REST 8.0.0</Badge>}
        actions={
          <Button
            variant="teal"
            size="md"
            onClick={() => setIsStartOpen(true)}
            leftIcon={<Play className="w-4 h-4" />}
          >
            {t.workflows.startExecutionBtn}
          </Button>
        }
      />

      {/* Idempotency Ledger Notice */}
      <div className="p-4 rounded-lg bg-slate-50 dark:bg-[#12232F] border border-slate-200/80 dark:border-[#223E50] flex items-start gap-3 text-xs text-slate-600 dark:text-slate-300">
        <Info className="w-4 h-4 text-rosetta-blue dark:text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          {t.workflows.idempotencyKeyNotice}
        </p>
      </div>

      {/* Available Definitions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {t.workflows.definitionsTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {definitions.map((def) => (
              <div
                key={def.id}
                className="p-4 rounded-lg border border-slate-200/80 dark:border-[#223E50] bg-slate-50/50 dark:bg-[#172E3C]/30 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-xs text-stone-ink dark:text-slate-100">
                      {def.name}
                    </span>
                    <Badge variant="outline">v{def.version}</Badge>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    {def.description}
                  </p>
                  <div className="mt-2 font-mono text-[10px] text-slate-400">
                    Key: {def.key}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-200/60 dark:border-[#223E50]/60 flex items-center justify-between">
                  <span className="text-[11px] text-teal-600 dark:text-teal-400 font-medium">
                    BPMN 2.0 Installed
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setSelectedDefId(def.id);
                      setIsStartOpen(true);
                    }}
                    leftIcon={<Play className="w-3 h-3" />}
                  >
                    Chạy ngay
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Executions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {t.workflows.executionsTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-[#172E3C]/40 border-b border-slate-200/80 dark:border-[#223E50] text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3">Execution ID</th>
                  <th className="px-5 py-3">Quy trình (Definition)</th>
                  <th className="px-5 py-3">Trạng thái</th>
                  <th className="px-5 py-3">Thời điểm bắt đầu</th>
                  <th className="px-5 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#223E50]/70">
                {executions.map((exec) => (
                  <tr
                    key={exec.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-[#172E3C]/30 transition-colors"
                  >
                    <td className="px-5 py-3.5 font-mono text-[11px] font-semibold text-stone-ink dark:text-slate-100">
                      {exec.id}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[11px] text-slate-500">
                      {exec.definitionKey ?? exec.definitionId.split(":")[0]}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <StatusIndicator status={exec.status} />
                        <span className="capitalize font-medium">
                          {exec.status === "running"
                            ? t.workflows.runningStatus
                            : exec.status === "completed"
                            ? t.workflows.completedStatus
                            : t.workflows.cancelledStatus}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[11px] text-slate-400">
                      {new Date(exec.startTime).toLocaleTimeString("vi-VN")}
                    </td>
                    <td className="px-5 py-3.5 text-right space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedExecution(exec)}
                      >
                        {t.common.viewDetails}
                      </Button>
                      {exec.status === "running" && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setExecutionToCancel(exec)}
                        >
                          Hủy
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Execution Details Drawer with BPMN Visual Timeline */}
      <DetailDrawer
        isOpen={!!selectedExecution}
        onClose={() => setSelectedExecution(null)}
        title="Chi tiết thực thi quy trình"
        subtitle={selectedExecution?.id}
      >
        {selectedExecution && (
          <div className="space-y-6 text-xs text-slate-600 dark:text-slate-300">
            {/* Status card */}
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-[#172E3C]/40 border border-slate-200/80 dark:border-[#223E50] flex items-center justify-between">
              <div>
                <span className="text-slate-400 block text-[11px]">Trạng thái tiến trình</span>
                <div className="flex items-center gap-2 mt-1">
                  <StatusIndicator status={selectedExecution.status} />
                  <span className="font-semibold text-stone-ink dark:text-slate-100 uppercase tracking-wide">
                    {selectedExecution.status}
                  </span>
                </div>
              </div>
              {selectedExecution.status === "running" && (
                <Button
                  variant="teal"
                  size="sm"
                  onClick={() => handleCompleteTask(selectedExecution.id)}
                  isLoading={isCompleting}
                  leftIcon={<Check className="w-3.5 h-3.5" />}
                >
                  {t.workflows.completeTaskBtn}
                </Button>
              )}
            </div>

            {/* Visual BPMN Timeline Component */}
            <div className="space-y-3">
              <h4 className="font-semibold text-stone-ink dark:text-slate-100 text-sm">
                {t.workflows.workflowTimeline}
              </h4>
              <div className="p-4 rounded-lg border border-slate-200/80 dark:border-[#223E50] space-y-4">
                {/* Step 1: Start Event */}
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-700 flex items-center justify-center text-emerald-700 dark:text-emerald-400 text-[10px] font-bold flex-shrink-0">
                    S
                  </div>
                  <div>
                    <span className="font-semibold text-stone-ink dark:text-slate-100">
                      Bắt đầu tiến trình (Start Event)
                    </span>
                    <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                      {new Date(selectedExecution.startTime).toISOString()}
                    </p>
                  </div>
                </div>

                <div className="w-0.5 h-6 bg-slate-200 dark:bg-slate-700 ml-3" />

                {/* Step 2: Checkpoint Task */}
                <div className="flex items-start gap-3">
                  <div
                    className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                      selectedExecution.status === "completed"
                        ? "bg-emerald-100 dark:bg-emerald-950/70 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400"
                        : selectedExecution.status === "running"
                        ? "bg-sky-100 dark:bg-sky-950/70 border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-400 animate-pulse"
                        : "bg-rose-100 dark:bg-rose-950/70 border-rose-300 text-rose-700"
                    }`}
                  >
                    T
                  </div>
                  <div>
                    <span className="font-semibold text-stone-ink dark:text-slate-100">
                      User Checkpoint Task
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {selectedExecution.status === "running"
                        ? "Đang chờ hoàn thành tác vụ người dùng qua POST /complete"
                        : selectedExecution.status === "completed"
                        ? "Đã hoàn thành tác vụ thành công"
                        : "Tiến trình đã bị hủy trước khi hoàn tất"}
                    </p>
                  </div>
                </div>

                <div className="w-0.5 h-6 bg-slate-200 dark:bg-slate-700 ml-3" />

                {/* Step 3: End Event */}
                <div className="flex items-start gap-3">
                  <div
                    className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                      selectedExecution.status === "completed"
                        ? "bg-emerald-100 dark:bg-emerald-950/70 border-emerald-300 text-emerald-700"
                        : "bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-400"
                    }`}
                  >
                    E
                  </div>
                  <div>
                    <span className="font-semibold text-stone-ink dark:text-slate-100">
                      Kết thúc tiến trình (End Event)
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {selectedExecution.status === "completed"
                        ? "Tiến trình đạt trạng thái kết thúc an toàn"
                        : "Chưa hoàn tất"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Input Variables */}
            <div>
              <span className="text-slate-400 text-xs">Biến đầu vào (Input Variables):</span>
              <div className="mt-2">
                <CodeBlock
                  code={JSON.stringify(selectedExecution.input ?? {}, null, 2)}
                  language="json"
                />
              </div>
            </div>
          </div>
        )}
      </DetailDrawer>

      {/* Start Execution Modal */}
      <ConfirmationDialog
        isOpen={isStartOpen}
        onCancel={() => setIsStartOpen(false)}
        onConfirm={handleStartSubmit as unknown as () => void}
        title={t.workflows.startExecutionBtn}
        description="Khởi chạy một phiên thực thi mới của quy trình BPMN đã cài đặt."
        confirmLabel="Khởi chạy tiến trình"
        isLoading={isStarting}
        variant="info"
      >
        <div className="space-y-4 my-2 text-left">
          {startError && (
            <div className="p-2.5 rounded bg-rose-50 text-rose-700 text-xs border border-rose-200">
              {startError}
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-1">
              {t.workflows.selectDefinition}
            </label>
            <select
              value={selectedDefId}
              onChange={(e) => setSelectedDefId(e.target.value)}
              className="w-full px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#12232F] text-stone-ink dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-rosetta-blue"
            >
              {definitions.map((def) => (
                <option key={def.id} value={def.id}>
                  {def.name} ({def.key})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-1">
              {t.workflows.inputVariablesJson}
            </label>
            <textarea
              rows={4}
              value={inputVariables}
              onChange={(e) => setInputVariables(e.target.value)}
              className="w-full px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#12232F] text-stone-ink dark:text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-rosetta-blue"
            />
          </div>
        </div>
      </ConfirmationDialog>

      {/* Cancel Execution Confirmation */}
      <ConfirmationDialog
        isOpen={!!executionToCancel}
        onCancel={() => setExecutionToCancel(null)}
        onConfirm={handleCancelExecution}
        title="Hủy bỏ thực thi quy trình"
        description={`Bạn có chắc muốn hủy bỏ execution '${executionToCancel?.id}'? Tiến trình sẽ dừng lại vĩnh viễn.`}
        confirmLabel="Hủy thực thi"
        isLoading={isCancelling}
        variant="danger"
      />
    </div>
  );
};
