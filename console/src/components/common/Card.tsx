// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
}

export const Card: React.FC<CardProps> = ({
  hoverable = false,
  children,
  className = "",
  ...props
}) => {
  return (
    <div
      className={`bg-white dark:bg-[#12232F] rounded-lg border border-slate-200/80 dark:border-[#223E50] shadow-sm overflow-hidden transition-all duration-200 ${
        hoverable
          ? "hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-md"
          : ""
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <div
      className={`px-5 py-4 border-b border-slate-100 dark:border-[#223E50]/70 flex items-center justify-between gap-4 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <h3
      className={`text-base font-semibold text-stone-ink dark:text-slate-100 tracking-tight ${className}`}
      {...props}
    >
      {children}
    </h3>
  );
};

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <p
      className={`text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed ${className}`}
      {...props}
    >
      {children}
    </p>
  );
};

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <div className={`p-5 ${className}`} {...props}>
      {children}
    </div>
  );
};

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <div
      className={`px-5 py-3 bg-slate-50/60 dark:bg-[#172E3C]/40 border-t border-slate-100 dark:border-[#223E50]/70 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
