// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";

export type StatusType = "ok" | "ready" | "warning" | "error" | "running" | "completed" | "cancelled" | "planned" | "unknown";

interface StatusIndicatorProps {
  status: StatusType;
  label?: string;
  pulse?: boolean;
  className?: string;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  label,
  pulse = true,
  className = "",
}) => {
  const getStyles = () => {
    switch (status) {
      case "ok":
      case "ready":
      case "completed":
        return {
          dot: "bg-teal-600 dark:bg-teal-400",
          ping: "bg-teal-400 dark:bg-teal-300",
          text: "text-teal-800 dark:text-teal-300",
        };
      case "running":
        return {
          dot: "bg-sky-600 dark:bg-sky-400",
          ping: "bg-sky-400 dark:bg-sky-300",
          text: "text-sky-800 dark:text-sky-300",
        };
      case "warning":
        return {
          dot: "bg-amber-500 dark:bg-amber-400",
          ping: "bg-amber-300 dark:bg-amber-200",
          text: "text-amber-800 dark:text-amber-300",
        };
      case "error":
      case "cancelled":
        return {
          dot: "bg-rose-600 dark:bg-rose-400",
          ping: "bg-rose-400 dark:bg-rose-300",
          text: "text-rose-800 dark:text-rose-300",
        };
      case "planned":
        return {
          dot: "bg-amber-700/80 dark:bg-amber-500",
          ping: "bg-amber-500",
          text: "text-amber-900 dark:text-amber-300",
        };
      default:
        return {
          dot: "bg-slate-400 dark:bg-slate-500",
          ping: "bg-slate-300",
          text: "text-slate-600 dark:text-slate-400",
        };
    }
  };

  const styles = getStyles();

  return (
    <div
      className={`inline-flex items-center gap-2 ${className}`}
      role="status"
      aria-label={label ?? status}
    >
      <span className="relative flex h-2.5 w-2.5">
        {pulse && status !== "unknown" && status !== "planned" && (
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${styles.ping}`}
          />
        )}
        <span
          className={`relative inline-flex rounded-full h-2.5 w-2.5 ${styles.dot}`}
        />
      </span>
      {label && (
        <span className={`text-xs font-medium tracking-tight ${styles.text}`}>
          {label}
        </span>
      )}
    </div>
  );
};
