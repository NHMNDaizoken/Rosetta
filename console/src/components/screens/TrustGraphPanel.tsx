// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Network, RefreshCw, ShieldOff } from "lucide-react";
import { TrustGraph, TrustGraphEdge, TrustGrantState } from "../../types";
import { api } from "../../services/apiClient";
import { useI18n } from "../../locales/i18n";
import { Card, CardHeader, CardTitle, CardContent } from "../common/Card";
import { Badge } from "../common/Badge";
import { Button } from "../common/Button";

const STATES: TrustGrantState[] = ["active", "pending", "expired", "revoked"];
const SOON_MS = 7 * 86_400_000;
const WIDTH = 640;
const HEIGHT = 380;
const NODE_R = 24;

const STROKE: Record<TrustGrantState, string> = {
  active: "#0F9F8F",
  pending: "#D08A1C",
  expired: "#94A3B8",
  revoked: "#DC2626",
};

const CHIP: Record<TrustGrantState, string> = {
  active: "bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900",
  pending: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  expired: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700",
  revoked: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
};

export function layoutNodes(count: number): Array<{ x: number; y: number }> {
  if (count === 1) return [{ x: WIDTH / 2, y: HEIGHT / 2 }];
  const radius = Math.min(WIDTH, HEIGHT) / 2 - 62;
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    return { x: WIDTH / 2 + radius * Math.cos(angle) * 1.35, y: HEIGHT / 2 + radius * Math.sin(angle) };
  });
}

export function edgePath(from: { x: number; y: number }, to: { x: number; y: number }, lane: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const bend = 28 + lane * 22;
  const cx = (from.x + to.x) / 2 + nx * bend;
  const cy = (from.y + to.y) / 2 + ny * bend;
  const trim = (px: number, py: number, qx: number, qy: number, by: number) => {
    const l = Math.hypot(qx - px, qy - py) || 1;
    return { x: px + ((qx - px) / l) * by, y: py + ((qy - py) / l) * by };
  };
  const start = trim(from.x, from.y, cx, cy, NODE_R + 2);
  const end = trim(to.x, to.y, cx, cy, NODE_R + 6);
  return { d: `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`, labelX: (start.x + 2 * cx + end.x) / 4, labelY: (start.y + 2 * cy + end.y) / 4 };
}

const shortName = (name: string) => ([...name].length > 18 ? [...name].slice(0, 17).join("") + "…" : name);
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => [...word][0]?.toUpperCase() ?? "").join("");

export const TrustGraphPanel: React.FC = () => {
  const { t, language } = useI18n();
  const c = t.capabilities;
  const [graph, setGraph] = useState<TrustGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TrustGrantState | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusApp, setFocusApp] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [revoking, setRevoking] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGraph(await api.getTrustGraph());
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      setGraph(null);
      setError(code === "trust_permission_required" ? c.graphErrorPermission : `${c.graphErrorGeneric}: ${code || "request_failed"}`);
    } finally {
      setLoading(false);
    }
  }, [c.graphErrorGeneric, c.graphErrorPermission]);

  useEffect(() => {
    void load();
    return api.subscribe(() => void load());
  }, [load]);

  const now = Date.now();
  const names = useMemo(() => new Map(graph?.nodes.map((n) => [n.appId, n.displayName]) ?? []), [graph]);
  const nameOf = (id: string) => names.get(id) ?? id.slice(0, 8);
  const positions = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    const points = layoutNodes(nodes.length);
    return new Map(nodes.map((n, i) => [n.appId, points[i]]));
  }, [graph]);

  const visibleEdges = useMemo(
    () => (graph?.edges ?? []).filter((e) => (filter === "all" || e.state === filter) && positions.has(e.providerAppId) && positions.has(e.consumerAppId)),
    [graph, filter, positions]
  );
  const lanes = useMemo(() => {
    const seen = new Map<string, number>();
    return new Map(
      visibleEdges.map((e) => {
        const key = `${e.providerAppId}>${e.consumerAppId}`;
        const lane = seen.get(key) ?? 0;
        seen.set(key, lane + 1);
        return [e.grantId, lane];
      })
    );
  }, [visibleEdges]);
  const counts = useMemo(() => {
    const result: Record<string, number> = { all: graph?.edges.length ?? 0 };
    for (const state of STATES) result[state] = graph?.edges.filter((e) => e.state === state).length ?? 0;
    return result;
  }, [graph]);
  const selected = graph?.edges.find((e) => e.grantId === selectedId) ?? null;

  const relative = (iso: string) => {
    const days = Math.round((Date.parse(iso) - now) / 86_400_000);
    const hours = Math.round((Date.parse(iso) - now) / 3_600_000);
    const format = new Intl.RelativeTimeFormat(language === "vi" ? "vi" : "en", { numeric: "auto" });
    return Math.abs(days) >= 1 ? format.format(days, "day") : format.format(hours, "hour");
  };
  const absolute = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(language === "vi" ? "vi-VN" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";
  const soon = (e: TrustGraphEdge) => e.state === "active" && Date.parse(e.expiresAt) - now < SOON_MS;
  const dimmed = (e: TrustGraphEdge) =>
    (focusApp !== null && e.providerAppId !== focusApp && e.consumerAppId !== focusApp) || (selectedId !== null && selectedId !== e.grantId);

  const select = (id: string) => {
    setSelectedId((current) => (current === id ? null : id));
    setReason("");
    setNotice(null);
  };

  const revoke = async () => {
    if (!selected) return;
    setRevoking(true);
    setNotice(null);
    try {
      await api.revokeTrustGrant(selected, reason);
      setReason("");
      await load();
      setNotice({ ok: true, text: c.revokeDone });
    } catch (failure) {
      setNotice({ ok: false, text: `${c.revokeError}: ${failure instanceof Error ? failure.message : "request_failed"}` });
    } finally {
      setRevoking(false);
    }
  };

  const stateLabel = (state: TrustGrantState) => c[`state_${state}` as const];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Network className="w-5 h-5 text-teal-600 dark:text-teal-400" />
          <CardTitle>{c.graphTitle}</CardTitle>
          {graph && (
            <Badge variant={graph.scope === "tenant" ? "teal" : "sandstone"}>
              {graph.scope === "tenant" ? c.graphScopeTenant : c.graphScopeOwned}
            </Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}
          leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />}>
          {c.graphRefresh}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
        <p className="leading-relaxed">{c.graphDesc}</p>
        {graph?.preview && <p className="text-[11px] text-slate-500 dark:text-slate-400">{c.graphPreview}</p>}
        {graph?.truncated && <p className="text-[11px] text-amber-700 dark:text-amber-300">{c.graphTruncated}</p>}

        {error && (
          <div role="alert" className="p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {graph && (
          <>
            <div className="flex flex-wrap gap-2" role="group" aria-label={c.colState}>
              {(["all", ...STATES] as const).map((state) => (
                <button
                  key={state}
                  type="button"
                  aria-pressed={filter === state}
                  onClick={() => setFilter(state)}
                  className={`px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${
                    filter === state
                      ? "bg-stone-ink text-white border-stone-ink dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100"
                      : state === "all"
                        ? "border-slate-200 dark:border-[#223E50] hover:bg-slate-50 dark:hover:bg-[#172E3C]"
                        : CHIP[state]
                  }`}
                >
                  {state === "all" ? c.filterAll : stateLabel(state)} · {counts[state]}
                </button>
              ))}
            </div>

            {graph.nodes.length === 0 || graph.edges.length === 0 ? (
              <p className="py-8 text-center text-slate-500 dark:text-slate-400">{c.graphEmpty}</p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px] gap-4">
                <div className="rounded-lg border border-slate-200/80 dark:border-[#223E50] bg-slate-50/60 dark:bg-[#0C1A24] overflow-hidden">
                  <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto block" role="img" aria-label={c.graphTitle}>
                    <defs>
                      {STATES.map((state) => (
                        <marker key={state} id={`arrow-${state}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                          <path d="M 0 0 L 10 5 L 0 10 z" fill={STROKE[state]} />
                        </marker>
                      ))}
                    </defs>
                    {visibleEdges.map((edge) => {
                      const from = positions.get(edge.providerAppId)!;
                      const to = positions.get(edge.consumerAppId)!;
                      const path = edgePath(from, to, lanes.get(edge.grantId) ?? 0);
                      const isSelected = edge.grantId === selectedId;
                      return (
                        <g
                          key={edge.grantId}
                          data-testid={`edge-${edge.grantId}`}
                          className="cursor-pointer"
                          style={{ opacity: dimmed(edge) ? 0.18 : 1, transition: "opacity 150ms" }}
                          onClick={() => select(edge.grantId)}
                        >
                          <title>{`${nameOf(edge.providerAppId)} → ${nameOf(edge.consumerAppId)}: ${edge.title ?? edge.capabilityId} (${stateLabel(edge.state)})`}</title>
                          <path d={path.d} fill="none" stroke="transparent" strokeWidth={14} />
                          <path
                            d={path.d}
                            fill="none"
                            stroke={STROKE[edge.state]}
                            strokeWidth={isSelected ? 3.5 : 2}
                            strokeDasharray={edge.state === "revoked" ? "6 5" : edge.state === "pending" ? "2 4" : undefined}
                            markerEnd={`url(#arrow-${edge.state})`}
                          />
                          {edge.state === "active" && (
                            <circle r={3} fill={STROKE.active}>
                              <animateMotion dur={`${2.4 + (lanes.get(edge.grantId) ?? 0) * 0.4}s`} repeatCount="indefinite" path={path.d} />
                            </circle>
                          )}
                          {(isSelected || soon(edge)) && (
                            <text x={path.labelX} y={path.labelY - 6} textAnchor="middle" className="fill-slate-700 dark:fill-slate-200 stroke-slate-50 dark:stroke-[#0C1A24]" style={{ fontSize: 10, fontWeight: 600, paintOrder: "stroke", strokeWidth: 4 }}>
                              {soon(edge) ? `⏳ ${edge.title ?? edge.version}` : edge.title ?? edge.version}
                            </text>
                          )}
                        </g>
                      );
                    })}
                    {graph.nodes.map((node) => {
                      const p = positions.get(node.appId)!;
                      const focused = focusApp === node.appId;
                      return (
                        <g
                          key={node.appId}
                          className="cursor-pointer"
                          onClick={() => setFocusApp(focused ? null : node.appId)}
                          style={{ opacity: focusApp && !focused ? 0.55 : 1 }}
                        >
                          <title>{`${node.displayName} (${node.state})`}</title>
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={NODE_R}
                            className={node.owned ? "fill-teal-50 dark:fill-teal-950" : "fill-white dark:fill-[#172E3C]"}
                            stroke={focused ? "#0F9F8F" : node.state === "active" ? "#64748B" : "#D08A1C"}
                            strokeWidth={focused ? 3 : 1.5}
                            strokeDasharray={node.state === "active" ? undefined : "3 3"}
                          />
                          <text x={p.x} y={p.y + 4} textAnchor="middle" className="fill-slate-700 dark:fill-slate-100" style={{ fontSize: 12, fontWeight: 700 }}>
                            {initials(node.displayName)}
                          </text>
                          <text x={p.x} y={p.y + NODE_R + 15} textAnchor="middle" className="fill-slate-700 dark:fill-slate-200 stroke-slate-50 dark:stroke-[#0C1A24]" style={{ fontSize: 11, fontWeight: 600, paintOrder: "stroke", strokeWidth: 4 }}>
                            {shortName(node.displayName)}
                          </text>
                          {(node.owned || node.state !== "active") && (
                            <text x={p.x} y={p.y + NODE_R + 28} textAnchor="middle" className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 9 }}>
                              {node.owned ? c.nodeOwned : node.state}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>

                <aside className="rounded-lg border border-slate-200/80 dark:border-[#223E50] p-4 space-y-3" aria-live="polite">
                  <h4 className="font-semibold text-sm text-stone-ink dark:text-slate-100">{c.detailTitle}</h4>
                  {!selected ? (
                    <p className="text-slate-500 dark:text-slate-400">{c.detailNone}</p>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <p className="font-semibold text-stone-ink dark:text-slate-100">{selected.title ?? selected.capabilityId}</p>
                        <p className="font-mono text-[10px] break-all text-slate-500">{selected.capabilityId} · v{selected.version}</p>
                      </div>
                      <p>
                        <span className="font-medium">{nameOf(selected.providerAppId)}</span> → <span className="font-medium">{nameOf(selected.consumerAppId)}</span>
                      </p>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                        <dt className="text-slate-500">{c.colState}</dt>
                        <dd>
                          <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full border text-[10px] font-medium ${CHIP[selected.state]}`}>{stateLabel(selected.state)}</span>
                        </dd>
                        <dt className="text-slate-500">{c.detailOperations}</dt>
                        <dd>{selected.operations.map((op) => c[`op_${op}` as const]).join(", ")}</dd>
                        <dt className="text-slate-500">{c.colExpires}</dt>
                        <dd>
                          {absolute(selected.expiresAt)} <span className="text-slate-500">({relative(selected.expiresAt)})</span>
                        </dd>
                        <dt className="text-slate-500">{c.detailActivated}</dt>
                        <dd>{absolute(selected.activatedAt)}</dd>
                        {selected.revokedAt && (
                          <>
                            <dt className="text-slate-500">{c.detailRevoked}</dt>
                            <dd>{absolute(selected.revokedAt)}</dd>
                          </>
                        )}
                      </dl>
                      {(selected.state === "active" || selected.state === "pending") && (
                        <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-[#223E50]/70">
                          <label className="block text-[11px] font-medium" htmlFor="revoke-reason">
                            {c.revokeReason}
                          </label>
                          <input
                            id="revoke-reason"
                            value={reason}
                            maxLength={512}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder={c.revokeReasonPlaceholder}
                            className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#0C1A24] text-xs"
                          />
                          <Button variant="destructive" size="sm" onClick={() => void revoke()} disabled={revoking || !reason.trim()}
                            leftIcon={<ShieldOff className="w-3.5 h-3.5" />}>
                            {revoking ? c.revoking : c.revokeButton}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                  {notice && (
                    <p role="status" className={`flex items-start gap-1.5 ${notice.ok ? "text-teal-700 dark:text-teal-300" : "text-red-700 dark:text-red-300"}`}>
                      {notice.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
                      <span>{notice.text}</span>
                    </p>
                  )}
                </aside>
              </div>
            )}

            {graph.edges.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-left text-xs">
                  <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2 pr-3 font-medium">{c.colProvider}</th>
                      <th className="py-2 pr-3 font-medium">{c.colConsumer}</th>
                      <th className="py-2 pr-3 font-medium">{c.colCapability}</th>
                      <th className="py-2 pr-3 font-medium">{c.colState}</th>
                      <th className="py-2 font-medium">{c.colExpires}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEdges.map((edge) => (
                      <tr
                        key={edge.grantId}
                        onClick={() => select(edge.grantId)}
                        className={`cursor-pointer border-t border-slate-100 dark:border-[#223E50]/70 hover:bg-slate-50 dark:hover:bg-[#172E3C]/50 ${
                          edge.grantId === selectedId ? "bg-teal-50/60 dark:bg-teal-950/20" : ""
                        }`}
                      >
                        <td className="py-2 pr-3">{nameOf(edge.providerAppId)}</td>
                        <td className="py-2 pr-3">{nameOf(edge.consumerAppId)}</td>
                        <td className="py-2 pr-3">
                          {edge.title ?? edge.capabilityId} <span className="text-slate-400">v{edge.version}</span>
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full border text-[10px] font-medium ${CHIP[edge.state]}`}>{stateLabel(edge.state)}</span>
                          {soon(edge) && <span className="ml-1.5 text-[10px] text-amber-700 dark:text-amber-300">{c.expiringSoon}</span>}
                        </td>
                        <td className="py-2 whitespace-nowrap">{relative(edge.expiresAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {loading && !graph && !error && <p className="py-6 text-center text-slate-500">{c.graphLoading}</p>}
      </CardContent>
    </Card>
  );
};
