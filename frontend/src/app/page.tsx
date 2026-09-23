"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

/** Callers use /s/[token]. Owner login optional. */
const DEFAULT_SHARE = process.env.NEXT_PUBLIC_DEFAULT_SHARE_TOKEN || "";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    if (DEFAULT_SHARE) {
      router.replace(`/s/${DEFAULT_SHARE}`);
      return;
    }
    const token = getToken();
    if (token) {
      router.push("/dashboard");
    } else {
      // No forced login — public create hint
      router.replace("/s");
    }
  }, [router]);
  return <div className="flex h-screen items-center justify-center text-sm text-slate-500">Loading…</div>;
}
