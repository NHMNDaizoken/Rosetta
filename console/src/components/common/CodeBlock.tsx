// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React, { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language = "bash",
  className = "",
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div
      className={`relative rounded-lg bg-slate-900 border border-slate-800 text-slate-100 font-mono text-xs overflow-hidden ${className}`}
    >
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-slate-950/70 border-b border-slate-800/80 text-[11px] text-slate-400">
        <span>{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 hover:text-slate-200 transition-colors py-0.5 px-1.5 rounded hover:bg-slate-800 cursor-pointer"
          title="Sao chép vào bộ nhớ tạm"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-teal-400" />
              <span className="text-teal-400 font-sans">Đã sao chép</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span className="font-sans">Sao chép</span>
            </>
          )}
        </button>
      </div>
      <div className="p-3.5 overflow-x-auto max-h-80 leading-relaxed whitespace-pre">
        {code}
      </div>
    </div>
  );
};
