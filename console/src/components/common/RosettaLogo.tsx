// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";

interface RosettaLogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

export const RosettaLogo: React.FC<RosettaLogoProps> = ({
  size = 32,
  showText = true,
  className = "",
}) => {
  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0 transition-transform hover:scale-105 duration-200"
        aria-hidden="true"
      >
        {/* Base Geometric Stone Silhouette */}
        <rect width="48" height="48" rx="10" fill="#172F3D" />
        
        {/* Layer 1 Facet: Rosetta Blue */}
        <path
          d="M14 14C14 12.8954 14.8954 12 16 12H27C30.3137 12 33 14.6863 33 18C33 20.8494 31.0152 23.2346 28.3408 23.8408L33.5 34H27.5L23.5 24H19V34H14V14Z"
          fill="#176B80"
        />

        {/* Central Interconnection Node: Mediterranean Teal */}
        <circle cx="23.5" cy="18" r="3.2" fill="#18877A" />

        {/* Heritage Translating Accent: Sandstone */}
        <path
          d="M19 16.5H26.5C27.3284 16.5 28 17.1716 28 18C28 18.8284 27.3284 19.5 26.5 19.5H19V16.5Z"
          fill="#C58B62"
        />
      </svg>

      {showText && (
        <div className="flex flex-col">
          <span className="font-bold text-base leading-tight tracking-tight text-stone-ink dark:text-slate-100 font-sans">
            Rosetta
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-rosetta-blue dark:text-sky-400">
            Console
          </span>
        </div>
      )}
    </div>
  );
};
