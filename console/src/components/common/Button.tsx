// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React, { forwardRef } from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "teal"
  | "sandstone"
  | "outline"
  | "ghost"
  | "destructive";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      isLoading = false,
      leftIcon,
      rightIcon,
      children,
      className = "",
      disabled,
      ...props
    },
    ref
  ) => {
    const getVariantStyles = () => {
      switch (variant) {
        case "primary":
          return "bg-[#176B80] hover:bg-[#135566] text-white shadow-sm border border-transparent dark:bg-sky-600 dark:hover:bg-sky-500";
        case "teal":
          return "bg-[#18877A] hover:bg-[#136e63] text-white shadow-sm border border-transparent dark:bg-teal-600 dark:hover:bg-teal-500";
        case "sandstone":
          return "bg-[#C58B62] hover:bg-[#af7850] text-white shadow-sm border border-transparent dark:bg-amber-600 dark:hover:bg-amber-500";
        case "secondary":
          return "bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700";
        case "outline":
          return "bg-transparent hover:bg-slate-50 text-slate-700 border border-slate-300 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800/60";
        case "ghost":
          return "bg-transparent hover:bg-slate-100 text-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/50";
        case "destructive":
          return "bg-rose-600 hover:bg-rose-700 text-white shadow-sm border border-transparent dark:bg-rose-600 dark:hover:bg-rose-500";
        default:
          return "";
      }
    };

    const getSizeStyles = () => {
      switch (size) {
        case "sm":
          return "px-2.5 py-1 text-xs gap-1.5 rounded";
        case "lg":
          return "px-5 py-2.5 text-base gap-2.5 rounded-lg";
        default:
          return "px-3.5 py-1.5 text-sm gap-2 rounded-md";
      }
    };

    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center font-medium transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none ${getVariantStyles()} ${getSizeStyles()} ${className}`}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
        ) : (
          leftIcon && <span className="flex-shrink-0">{leftIcon}</span>
        )}
        <span>{children}</span>
        {!isLoading && rightIcon && (
          <span className="flex-shrink-0">{rightIcon}</span>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
