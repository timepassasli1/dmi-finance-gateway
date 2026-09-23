"use client";
import { useState } from "react";

export function CodeBlock({ title, code }: { title?: string; code: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      {title && <h3 className="font-semibold text-gray-900 mb-3">{title}</h3>}
      <div className="relative">
        <pre className="bg-gray-900 text-green-400 rounded-lg p-4 text-sm overflow-x-auto whitespace-pre-wrap">{code}</pre>
        <button
          type="button"
          onClick={copy}
          className="absolute top-2 right-2 text-xs bg-gray-800 text-gray-300 hover:text-white px-2 py-1 rounded"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}
