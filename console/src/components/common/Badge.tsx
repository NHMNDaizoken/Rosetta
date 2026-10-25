// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";

export type BadgeVariant =
  | "default"
  | "rosetta"
  | "teal"
  | "sandstone"
  | "success"
  | "warning"
  | "destructive"
  | "outline"
  | "method-get"
  | "method-post"
  | "method-put"
  | "method-patch"
  | "method-delete";

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = "default",
  children,
  className = "",
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case "rosetta":
        return "bg-[#E8F3F5] text-[#176B80] border-[#C2E1E7] dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800";
      case "teal":
        return "bg-[#E6F5F3] text-[#18877A] border-[#BCE4DF] dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800";
      case "sandstone":
        return "bg-[#FBF4EE] text-[#C58B62] border-[#E8D0BF] dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800";
      case "success":
        return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800";
      case "warning":
        return "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800";
      case "destructive":
        return "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800";
      case "outline":
        return "bg-transparent text-slate-700 border-slate-300 dark:text-slate-300 dark:border-slate-700";
      case "method-get":
        return "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-700 font-mono font-bold text-[10px]";
      case "method-post":
        return "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700 font-mono font-bold text-[10px]";
      case "method-put":
      case "method-patch":
        return "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-700 font-mono font-bold text-[10px]";
      case "method-delete":
        return "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-700 font-mono font-bold text-[10px]";
      default:
        return "bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
    }
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getVariantStyles()} ${className}`}
    >
      {children}
    </span>
  );
};
