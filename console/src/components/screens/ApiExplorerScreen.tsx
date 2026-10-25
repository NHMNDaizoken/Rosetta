// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React, { useState } from "react";
import {
  Terminal,
  Search,
  Filter,
  Copy,
  Check,
  Code2,
  Lock,
  Layers,
  ChevronDown,
  ChevronRight,
  Info,
} from "lucide-react";
import {
  FOUNDATION_ENDPOINTS,
  OPENAPI_TAGS,
  ApiEndpointDef,
  generateCurlExample,
  generateFetchExample,
} from "../../constants/openapiData";
import { useI18n } from "../../locales/i18n";
import { PageHeader } from "../layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "../common/Card";
import { Badge, BadgeVariant } from "../common/Badge";
import { Button } from "../common/Button";
import { CodeBlock } from "../common/CodeBlock";

export const ApiExplorerScreen: React.FC = () => {
  const { t, language } = useI18n();
  const [selectedTag, setSelectedTag] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedOpId, setExpandedOpId] = useState<string | null>(null);

  const getMethodBadgeVariant = (method: string): BadgeVariant => {
    switch (method) {
      case "GET":
      case "HEAD":
        return "method-get";
      case "POST":
        return "method-post";
      case "PUT":
        return "method-put";
      case "PATCH":
        return "method-patch";
      case "DELETE":
        return "method-delete";
      default:
        return "default";
    }
  };

  const filteredEndpoints = FOUNDATION_ENDPOINTS.filter((ep) => {
    const matchesTag =
      selectedTag === "all" || ep.tags.includes(selectedTag);
    const matchesSearch =
      ep.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ep.operationId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ep.method.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTag && matchesSearch;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.apiExplorer.title}
        subtitle={t.apiExplorer.subtitle}
        badges={
          <Badge variant="rosetta">
            {FOUNDATION_ENDPOINTS.length} Implemented Operations
          </Badge>
        }
      />

      {/* Contract Notice */}
      <div className="p-4 rounded-lg bg-slate-50 dark:bg-[#12232F] border border-slate-200/80 dark:border-[#223E50] flex items-start gap-3 text-xs text-slate-600 dark:text-slate-300">
        <Info className="w-4 h-4 text-rosetta-blue dark:text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          {t.apiExplorer.capabilityNotice}
        </p>
      </div>

      {/* Filter and Search Bar */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.apiExplorer.searchEndpoint}
                className="w-full pl-9 pr-4 py-1.5 text-xs rounded border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#12232F] text-stone-ink dark:text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-rosetta-blue"
              />
            </div>

            {/* Tag Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              {OPENAPI_TAGS.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => setSelectedTag(tag.id)}
                  className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors cursor-pointer ${
                    selectedTag === tag.id
                      ? "bg-[#176B80] text-white border-[#176B80] dark:bg-sky-600 dark:border-sky-600"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-[#172E3C]/40 dark:text-slate-300 dark:border-[#223E50]"
                  }`}
                >
                  {language === "vi" ? tag.label : tag.enLabel}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Endpoints List */}
      <div className="space-y-3">
        {filteredEndpoints.map((ep) => {
          const isExpanded = expandedOpId === ep.operationId;
          return (
            <Card
              key={ep.operationId}
              className="border-slate-200/80 dark:border-[#223E50] overflow-hidden"
            >
              <div
                onClick={() =>
                  setExpandedOpId(isExpanded ? null : ep.operationId)
                }
                className="p-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/80 dark:hover:bg-[#172E3C]/30 transition-colors select-none"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Badge variant={getMethodBadgeVariant(ep.method)}>
                    {ep.method}
                  </Badge>
                  <code className="text-xs font-semibold text-stone-ink dark:text-slate-100 font-mono truncate">
                    {ep.path}
                  </code>
                  <span className="hidden sm:inline text-xs text-slate-400 font-mono text-[11px]">
                    ({ep.operationId})
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {ep.security && ep.security.length > 0 && (
                    <Badge variant="outline" className="hidden md:inline-flex text-[10px]">
                      Bearer Token
                    </Badge>
                  )}
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  )}
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="p-5 border-t border-slate-100 dark:border-[#223E50]/70 bg-slate-50/40 dark:bg-[#172E3C]/20 space-y-4">
                  {/* Operation Summary */}
                  <div>
                    <h5 className="text-xs font-semibold text-stone-ink dark:text-slate-200 mb-1">
                      Mô tả & Phạm vi:
                    </h5>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {ep.summary || "Endpoint hợp đồng Foundation API."}
                    </p>
                  </div>

                  {/* Responses */}
                  <div>
                    <h5 className="text-xs font-semibold text-stone-ink dark:text-slate-200 mb-1.5">
                      Mã phản hồi chuẩn:
                    </h5>
                    <div className="flex flex-wrap gap-1.5">
                      {ep.responses.map((code) => (
                        <span
                          key={code}
                          className={`font-mono text-[10px] px-2 py-0.5 rounded border ${
                            code.startsWith("2")
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800"
                              : code.startsWith("4")
                              ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800"
                              : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800"
                          }`}
                        >
                          HTTP {code}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Examples */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
                    <div>
                      <span className="text-[11px] font-semibold text-slate-500 block mb-1">
                        Ví dụ lệnh cURL:
                      </span>
                      <CodeBlock
                        code={generateCurlExample(ep)}
                        language="bash"
                      />
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-500 block mb-1">
                        Ví dụ mã lệnh TypeScript (Fetch):
                      </span>
                      <CodeBlock
                        code={generateFetchExample(ep)}
                        language="typescript"
                      />
                    </div>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};
