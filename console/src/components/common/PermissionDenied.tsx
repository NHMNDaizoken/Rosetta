// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";
import { ShieldAlert } from "lucide-react";

interface PermissionDeniedProps {
  actionName?: string;
  requiredRole?: string;
  className?: string;
}

export const PermissionDenied: React.FC<PermissionDeniedProps> = ({
  actionName = "Thao tác này",
  requiredRole = "core-writer / admin",
  className = "",
}) => {
  return (
    <div
      className={`p-4 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 flex items-start gap-3 ${className}`}
    >
      <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
      <div>
        <h5 className="text-xs font-semibold text-amber-900 dark:text-amber-200">
          Quyền truy cập bị giới hạn (Fail-Closed)
        </h5>
        <p className="text-xs text-amber-800/90 dark:text-amber-300/80 mt-0.5 leading-relaxed">
          {actionName} yêu cầu vai trò <span className="font-mono font-semibold">{requiredRole}</span> hoặc tài khoản quản trị viên độc lập được ghi danh trong cơ sở dữ liệu.
        </p>
      </div>
    </div>
  );
};
