// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";

interface LoadingSkeletonProps {
  rows?: number;
  className?: string;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  rows = 3,
  className = "",
}) => {
  return (
    <div className={`space-y-3 animate-pulse ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 items-center">
          <div className="h-4 bg-slate-200 dark:bg-slate-700/60 rounded w-1/4" />
          <div className="h-4 bg-slate-200 dark:bg-slate-700/60 rounded w-1/2" />
          <div className="h-4 bg-slate-200 dark:bg-slate-700/60 rounded w-1/6 ml-auto" />
        </div>
      ))}
    </div>
  );
};
