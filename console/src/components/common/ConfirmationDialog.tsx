// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React, { useEffect, useRef } from "react";
import { AlertTriangle, Info, X } from "lucide-react";
import { Button } from "./Button";

interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info";
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel = "Xác nhận",
  cancelLabel = "Hủy bỏ",
  variant = "warning",
  isLoading = false,
  onConfirm,
  onCancel,
  children,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isLoading) {
        onCancel();
      }
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
      setTimeout(() => confirmBtnRef.current?.focus(), 50);
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, isLoading, onCancel]);

  if (!isOpen) return null;

  const getIcon = () => {
    switch (variant) {
      case "danger":
        return <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />;
      case "warning":
        return <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />;
      default:
        return <Info className="w-5 h-5 text-sky-600 dark:text-sky-400" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      aria-describedby="dialog-description"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md bg-white dark:bg-[#12232F] rounded-xl border border-slate-200 dark:border-[#223E50] shadow-2xl overflow-hidden"
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-full bg-slate-100 dark:bg-[#172E3C] flex-shrink-0">
              {getIcon()}
            </div>
            <div className="flex-1 min-w-0">
              <h3
                id="dialog-title"
                className="text-base font-semibold text-stone-ink dark:text-slate-100"
              >
                {title}
              </h3>
              <p
                id="dialog-description"
                className="mt-1 text-sm text-slate-500 dark:text-slate-400 leading-relaxed"
              >
                {description}
              </p>
            </div>
            <button
              onClick={onCancel}
              disabled={isLoading}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-md"
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {children && <div className="mt-4">{children}</div>}

          <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-[#223E50]/70">
            <Button
              variant="outline"
              size="md"
              onClick={onCancel}
              disabled={isLoading}
            >
              {cancelLabel}
            </Button>
            <Button
              ref={confirmBtnRef}
              variant={variant === "danger" ? "destructive" : "primary"}
              size="md"
              isLoading={isLoading}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
