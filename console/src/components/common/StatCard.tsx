// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";

interface StatCardProps {
  title: string;
  value: React.ReactNode;
  subtitle?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  statusIndicator?: React.ReactNode;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  badge,
  statusIndicator,
  className = "",
}) => {
  return (
    <div
      className={`bg-white dark:bg-[#12232F] rounded-lg border border-slate-200/80 dark:border-[#223E50] p-4 shadow-sm transition-all duration-200 hover:border-slate-300 dark:hover:border-slate-600 ${className}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {title}
        </span>
        {icon && (
          <div className="w-7 h-7 rounded bg-slate-100 dark:bg-[#172E3C] flex items-center justify-center text-slate-600 dark:text-slate-300">
            {icon}
          </div>
        )}
      </div>

      <div className="flex items-baseline gap-2 mb-1">
        <div className="text-xl font-bold tracking-tight text-stone-ink dark:text-slate-100 font-sans">
          {value}
        </div>
        {statusIndicator && <div>{statusIndicator}</div>}
      </div>

      <div className="flex items-center justify-between mt-1 text-[11px] text-slate-400 dark:text-slate-500">
        {subtitle && <span>{subtitle}</span>}
        {badge && <div className="ml-auto">{badge}</div>}
      </div>
    </div>
  );
};
