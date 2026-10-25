// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "./Button";

interface ErrorStateProps {
  title?: string;
  message: string;
  errorCode?: string;
  onRetry?: () => void;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = "Đã xảy ra sự cố kết nối",
  message,
  errorCode,
  onRetry,
  className = "",
}) => {
  return (
    <div
      className={`p-6 border border-rose-200 dark:border-rose-900/60 rounded-xl bg-rose-50/50 dark:bg-rose-950/20 text-center ${className}`}
    >
      <div className="w-10 h-10 mx-auto rounded-full bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-3">
        <AlertCircle className="w-5 h-5" />
      </div>
      <h4 className="text-sm font-semibold text-rose-900 dark:text-rose-300">
        {title}
      </h4>
      <p className="mt-1 text-xs text-rose-700 dark:text-rose-400/90 max-w-md mx-auto leading-relaxed">
        {message}
      </p>
      {errorCode && (
        <div className="mt-2 text-[11px] font-mono text-rose-500 dark:text-rose-400">
          Mã lỗi: {errorCode}
        </div>
      )}
      {onRetry && (
        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Thử kết nối lại
          </Button>
        </div>
      )}
    </div>
  );
};
