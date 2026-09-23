"use client";

/** Fallback when someone opens /s without a token. */
export default function ShareIndexPage() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Payment create link</h1>
        <p className="mt-2 text-sm text-slate-600">
          Callers ke liye shared URL chahiye: <code className="text-xs">/s/&lt;token&gt;</code>
        </p>
        <p className="mt-3 text-[12px] text-slate-400">Login ki zarurat nahi — shop owner Settings se link copy kare.</p>
      </div>
    </main>
  );
}
