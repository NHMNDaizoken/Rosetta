// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  badges,
  actions,
  className = "",
}) => {
  return (
    <div
      className={`pb-5 mb-6 border-b border-slate-200/80 dark:border-[#223E50] flex flex-col md:flex-row md:items-center md:justify-between gap-4 ${className}`}
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-stone-ink dark:text-slate-100 font-sans">
            {title}
          </h1>
          {badges && <div className="flex items-center gap-1.5">{badges}</div>}
        </div>
        {subtitle && (
          <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 max-w-3xl leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2.5 flex-shrink-0">{actions}</div>
      )}
    </div>
  );
};
