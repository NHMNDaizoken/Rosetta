// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";
import { FolderSearch } from "lucide-react";
import { Button } from "./Button";

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  className = "",
}) => {
  return (
    <div
      className={`py-12 px-6 text-center border-2 border-dashed border-slate-200 dark:border-[#223E50] rounded-xl bg-slate-50/50 dark:bg-[#12232F]/30 ${className}`}
    >
      <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 dark:bg-[#172E3C] flex items-center justify-center text-slate-400 dark:text-slate-500 mb-3">
        {icon ?? <FolderSearch className="w-6 h-6" />}
      </div>
      <h4 className="text-sm font-semibold text-stone-ink dark:text-slate-100">
        {title}
      </h4>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
        {description}
      </p>
      {actionLabel && onAction && (
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  );
};
