// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect } from "react";
import {
  Settings,
  Globe,
  Sun,
  Moon,
  Laptop,
  Radio,
  Server,
  Key,
  CheckCircle,
  AlertCircle,
  Save,
} from "lucide-react";
import { useI18n } from "../../locales/i18n";
import { useTheme } from "../../services/themeContext";
import { api } from "../../services/apiClient";
import { PageHeader } from "../layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "../common/Card";
import { Button } from "../common/Button";
import { Badge } from "../common/Badge";
import { Language, Theme } from "../../types";

export const PlatformSettingsScreen: React.FC = () => {
  const { t, language, setLanguage } = useI18n();
  const { theme, setTheme } = useTheme();

  const [gatewayUrl, setGatewayUrl] = useState(api.getBaseUrl());
  const [token, setToken] = useState(api.getToken() || "");
  const [isLive, setIsLive] = useState(api.getLiveMode());
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<string | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [isProbing, setIsProbing] = useState(false);

  useEffect(() => {
    return api.subscribe(() => setIsLive(api.getLiveMode()));
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);
    try {
      api.setBaseUrl(gatewayUrl);
      api.setToken(token.trim() || null);
      api.setLiveMode(isLive);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      setSaveError(
        (err as Error).message === "gateway_origin_not_approved"
          ? t.settings.invalidGateway
          : (err as Error).message
      );
    }
  };

  const handleClearToken = () => {
    api.setToken(null);
    setToken("");
    setSaveError(null);
  };

  const handleProbeGateway = async () => {
    setIsProbing(true);
    setProbeResult(null);
    setProbeError(null);
    if (!api.isApprovedGatewayUrl(gatewayUrl)) {
      setProbeError(t.settings.invalidGateway);
      setIsProbing(false);
      return;
    }
    try {
      const start = performance.now();
      const base = gatewayUrl.trim().replace(/\/+$/, "");
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
      const latency = Math.round(performance.now() - start);
      if (res.ok) {
        const body = await res.json();
        setProbeResult(`Kết nối thành công! HTTP 200 (${latency}ms) — Dịch vụ: ${body.service}, Trạng thái: ${body.status}`);
      } else {
        setProbeError(`Gateway phản hồi mã lỗi: HTTP ${res.status}`);
      }
    } catch (err: unknown) {
      setProbeError(`Không thể kết nối đến Gateway: ${(err as Error).message}`);
    } finally {
      setIsProbing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title={t.settings.title}
        subtitle={t.settings.subtitle}
      />

      <form onSubmit={handleSave} className="space-y-6">
        {/* Gateway & Network Configuration */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Server className="w-5 h-5 text-rosetta-blue dark:text-sky-400" />
              <CardTitle>Cấu hình cổng Gateway & Kết nối</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-1">
                {t.settings.gatewayUrlLabel}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  value={gatewayUrl}
                  onChange={(e) => setGatewayUrl(e.target.value)}
                  placeholder="http://127.0.0.1:8080"
                  className="flex-1 px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#12232F] text-stone-ink dark:text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-rosetta-blue"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleProbeGateway}
                  isLoading={isProbing}
                >
                  Kiểm tra kết nối
                </Button>
              </div>
              {probeResult && (
                <p className="mt-2 text-xs font-mono text-teal-600 dark:text-teal-400">
                  {probeResult}
                </p>
              )}
              {probeError && (
                <p className="mt-2 text-xs font-mono text-rose-600 dark:text-rose-400">
                  {probeError}
                </p>
              )}
            </div>

            {/* Mode selection */}
            <div className="pt-2">
              <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-2">
                Chế độ hoạt động mặc định
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="mode"
                    checked={isLive}
                    onChange={() => setIsLive(true)}
                  />
                  <span className="font-medium text-teal-700 dark:text-teal-400">
                    Kết nối trực tiếp (Live Mode)
                  </span>
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="mode"
                    checked={!isLive}
                    onChange={() => setIsLive(false)}
                  />
                  <span className="font-medium text-amber-700 dark:text-amber-400">
                    Chế độ mô phỏng (Preview Demo Mode)
                  </span>
                </label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Operator Bearer Token */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Key className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              <CardTitle>{t.settings.tokenSectionTitle}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {t.settings.tokenSectionDesc}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
              {t.settings.tokenMemoryNotice}
            </p>
            <textarea
              rows={3}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t.settings.tokenPlaceholder}
              className="w-full px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#12232F] text-stone-ink dark:text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-rosetta-blue"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClearToken}
              disabled={!token}
            >
              {t.settings.tokenClear}
            </Button>
          </CardContent>
        </Card>

        {/* Language and Appearance */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              <CardTitle>Giao diện & Ngôn ngữ</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Language */}
            <div>
              <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-2">
                {t.settings.languageLabel}
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setLanguage("vi")}
                  className={`px-4 py-2 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                    language === "vi"
                      ? "bg-[#176B80] text-white border-[#176B80] shadow-sm"
                      : "bg-white dark:bg-[#172E3C]/40 border-slate-200 dark:border-[#223E50] text-slate-700 dark:text-slate-300 hover:bg-slate-50"
                  }`}
                >
                  🇻🇳 Tiếng Việt (Mặc định)
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage("en")}
                  className={`px-4 py-2 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                    language === "en"
                      ? "bg-[#176B80] text-white border-[#176B80] shadow-sm"
                      : "bg-white dark:bg-[#172E3C]/40 border-slate-200 dark:border-[#223E50] text-slate-700 dark:text-slate-300 hover:bg-slate-50"
                  }`}
                >
                  🇺🇸 English (Complete)
                </button>
              </div>
            </div>

            {/* Theme */}
            <div>
              <label className="block text-xs font-semibold text-stone-ink dark:text-slate-200 mb-2">
                {t.settings.themeLabel}
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer ${
                    theme === "light"
                      ? "bg-slate-100 dark:bg-slate-800 border-slate-400 text-stone-ink font-semibold"
                      : "border-slate-200 dark:border-[#223E50] text-slate-600 dark:text-slate-400"
                  }`}
                >
                  <Sun className="w-4 h-4 text-amber-500" />
                  <span>{t.settings.lightTheme}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer ${
                    theme === "dark"
                      ? "bg-slate-100 dark:bg-slate-800 border-slate-400 text-stone-ink dark:text-slate-100 font-semibold"
                      : "border-slate-200 dark:border-[#223E50] text-slate-600 dark:text-slate-400"
                  }`}
                >
                  <Moon className="w-4 h-4 text-sky-400" />
                  <span>{t.settings.darkTheme}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("system")}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer ${
                    theme === "system"
                      ? "bg-slate-100 dark:bg-slate-800 border-slate-400 text-stone-ink dark:text-slate-100 font-semibold"
                      : "border-slate-200 dark:border-[#223E50] text-slate-600 dark:text-slate-400"
                  }`}
                >
                  <Laptop className="w-4 h-4" />
                  <span>{t.settings.systemTheme}</span>
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            size="md"
            leftIcon={<Save className="w-4 h-4" />}
          >
            {t.settings.saveSettings}
          </Button>
          {saveSuccess && (
            <span className="text-xs text-teal-600 dark:text-teal-400 font-medium flex items-center gap-1">
              <CheckCircle className="w-4 h-4" />
              Đã lưu cấu hình thành công!
            </span>
          )}
          {saveError && (
            <span className="text-xs text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1">
              <AlertCircle className="w-4 h-4" />
              {saveError}
            </span>
          )}
        </div>
      </form>
    </div>
  );
};
