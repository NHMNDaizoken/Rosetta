// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";
import { Search, X } from "lucide-react";

interface SearchFilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  placeholder?: string;
  filterComponent?: React.ReactNode;
  rightAction?: React.ReactNode;
  className?: string;
}

export const SearchFilterBar: React.FC<SearchFilterBarProps> = ({
  searchQuery,
  onSearchChange,
  placeholder = "Tìm kiếm...",
  filterComponent,
  rightAction,
  className = "",
}) => {
  return (
    <div
      className={`flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 ${className}`}
    >
      <div className="flex flex-1 items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-9 pr-8 py-1.5 text-xs rounded-md border border-slate-200 dark:border-[#223E50] bg-white dark:bg-[#12232F] text-stone-ink dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#176B80] dark:focus:ring-sky-500 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label="Xóa tìm kiếm"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {filterComponent}
      </div>
      {rightAction && <div className="flex-shrink-0">{rightAction}</div>}
    </div>
  );
};
