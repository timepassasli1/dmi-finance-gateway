"use client";
import { useEffect, useState, useRef } from "react";
import { api, API_URL } from "@/lib/api";
import { shareCreateUrl } from "@/lib/gateway-config";

interface Profile {
  business_name: string;
  legal_name: string;
  website_url: string;
  phone: string;
  email: string;
  status: string;
  kyc_status: string;
  client_code: string;
  logo_url?: string;
  brand_color?: string;
  upi_vpa?: string;
  paytm_mid?: string;
  share_link_token?: string;
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<Profile>("/v1/client/profile").then(setProfile).finally(() => setLoading(false));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    const name = profile.business_name.trim();
    if (!name) {
      setError("Shop name required hai");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await api.post<Profile>("/v1/client/profile", {
        business_name: name,
        legal_name: profile.legal_name,
        website_url: profile.website_url,
        phone: profile.phone,
        brand_color: profile.brand_color || "#6726A8",
        upi_vpa: profile.upi_vpa || "",
        paytm_mid: profile.paytm_mid || "",
      });
      setProfile(updated);
      setSuccess("Saved — naye payment pages pe ye shop name dikhega");
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const data = await api.upload<Profile>("/v1/client/logo", fd);
      setProfile(data);
      setSuccess("Logo uploaded — payment page pe dikhega");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function submitReview() {
    await api.post("/v1/client/submit-review");
    api.get<Profile>("/v1/client/profile").then(setProfile);
  }

  async function copyShareLink() {
    if (!profile?.share_link_token) return;
    try {
      await navigator.clipboard.writeText(shareCreateUrl(profile.share_link_token));
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function rotateShareLink() {
    if (!confirm("Purana shared link band ho jayega. Naya generate karein?")) return;
    setRotating(true);
    setError("");
    try {
      const data = await api.post<{ share_link_token: string }>("/v1/client/share-link/rotate");
      setProfile((p) => (p ? { ...p, share_link_token: data.share_link_token } : p));
      setSuccess("Naya shared link ban gaya — callers ko naya URL bhejo");
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Rotate failed");
    } finally {
      setRotating(false);
    }
  }

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!profile) return null;

  const logoSrc = profile.logo_url
    ? profile.logo_url.startsWith("http")
      ? profile.logo_url
      : `${API_URL}${profile.logo_url}`
    : "";

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Shop name, logo aur checkout branding yahan se change karo</p>
      </div>

      <form onSubmit={save} className="space-y-6">
        {success && (
          <div className="rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>
        )}
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Shop name — primary */}
        <div className="rounded-xl border border-[#6726A8]/25 bg-white p-6 shadow-sm">
          <h3 className="mb-1 font-semibold text-gray-900">Shop name</h3>
          <p className="mb-4 text-xs text-gray-500">
            Ye naam payment page pe “Paying to …” ke neeche dikhta hai. Kabhi bhi change kar sakte ho.
          </p>
          <label className="mb-1 block text-sm font-medium text-gray-700">Shop / Business name</label>
          <input
            value={profile.business_name}
            onChange={(e) => setProfile((p) => (p ? { ...p, business_name: e.target.value } : p))}
            placeholder="e.g. Kayesh Store"
            className="w-full max-w-lg rounded-lg border border-gray-300 px-3 py-2.5 text-base font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
            required
          />
        </div>

        {/* Branding */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="mb-4 font-semibold text-gray-900">Payment page branding</h3>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <div className="flex flex-col items-center gap-3">
              <div
                className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
                style={{ boxShadow: `0 0 0 4px ${(profile.brand_color || "#6726A8")}22` }}
              >
                {logoSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoSrc} alt="Logo" className="h-full w-full object-contain p-2" />
                ) : (
                  <span className="text-3xl font-bold" style={{ color: profile.brand_color || "#6726A8" }}>
                    {(profile.business_name || "M").slice(0, 1)}
                  </span>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadLogo(f);
                }}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="rounded-lg bg-[#6726A8] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {uploading ? "Uploading…" : "Upload logo"}
              </button>
              <p className="max-w-[160px] text-center text-[11px] text-gray-400">PNG/JPG/WebP, max 2MB</p>
            </div>

            <div className="flex-1 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Brand color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={profile.brand_color || "#6726A8"}
                    onChange={(e) => setProfile((p) => (p ? { ...p, brand_color: e.target.value } : p))}
                    className="h-10 w-14 cursor-pointer rounded border border-gray-300"
                  />
                  <input
                    value={profile.brand_color || "#6726A8"}
                    onChange={(e) => setProfile((p) => (p ? { ...p, brand_color: e.target.value } : p))}
                    className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Checkout UPI ID
                </label>
                <input
                  value={profile.upi_vpa || ""}
                  onChange={(e) => setProfile((p) => (p ? { ...p, upi_vpa: e.target.value } : p))}
                  placeholder="name@airtel / name@paytm / name@fino"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  Jo VPA yahan daalo (Airtel / Paytm / Fino…) wahi QR aur UPI buttons pe jayega.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Paytm MID</label>
                <input
                  value={profile.paytm_mid || ""}
                  onChange={(e) => setProfile((p) => (p ? { ...p, paytm_mid: e.target.value } : p))}
                  placeholder="MkQY..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="font-semibold text-gray-900">Shared create link (callers)</h3>
          <p className="mt-1 text-sm text-gray-500">
            Ye ek link sab callers ko de do — login nahi. Amount daal ke customer pay link banayenge.
          </p>
          {profile.share_link_token ? (
            <>
              <div className="mt-3 break-all rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-800">
                {shareCreateUrl(profile.share_link_token)}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyShareLink}
                  className="rounded-lg bg-[#6726A8] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                >
                  {shareCopied ? "Copied" : "Copy shared link"}
                </button>
                <button
                  type="button"
                  onClick={rotateShareLink}
                  disabled={rotating}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {rotating ? "…" : "Rotate (old link band)"}
                </button>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-amber-700">Share link load nahi hua — page refresh karo.</p>
          )}
        </div>

        {/* Extra profile */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Business details</h3>
            <div className="flex items-center space-x-2 text-sm text-gray-400">
              <span>Client Code:</span>
              <code className="text-gray-700">{profile.client_code}</code>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Legal name</label>
              <input
                value={profile.legal_name}
                onChange={(e) => setProfile((p) => (p ? { ...p, legal_name: e.target.value } : p))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Website URL</label>
              <input
                value={profile.website_url}
                onChange={(e) => setProfile((p) => (p ? { ...p, website_url: e.target.value } : p))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Phone</label>
              <input
                value={profile.phone}
                onChange={(e) => setProfile((p) => (p ? { ...p, phone: e.target.value } : p))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
              <input
                value={profile.email}
                disabled
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[#6726A8] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save shop name & settings"}
          </button>
          {profile.status === "PENDING" && (
            <button
              type="button"
              onClick={submitReview}
              className="rounded-lg border border-[#6726A8] px-4 py-2 text-sm text-[#6726A8] hover:bg-purple-50"
            >
              Submit for Review
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
