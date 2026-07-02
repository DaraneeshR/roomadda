"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import {
  kycMimeSchema,
  type KycMeResponse,
  type KycMime,
  type KycSlot,
  type KycSupportingDocType,
  type KycViewStatus,
} from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";

/**
 * Just-in-time KYC: required only at the booking step, never to browse. This
 * panel shows the caller's status and, when a submission is needed, drag-and-drop
 * upload of the three documents. Files go to the PRIVATE bucket via the presigned
 * pattern (proxied through `/api/kyc/upload`); only opaque object keys are held
 * here, and only the keys are submitted.
 */
const ACCEPT = "image/jpeg,image/png,application/pdf";

interface SlotState {
  key: string | null;
  contentType: KycMime | null;
  fileName: string | null;
  uploading: boolean;
  error: string | null;
}

const emptySlot: SlotState = { key: null, contentType: null, fileName: null, uploading: false, error: null };

const SUPPORTING_LABELS: Record<KycSupportingDocType, string> = {
  STUDENT_ID: "Student ID",
  OFFICE_ID: "Office ID",
  OFFER_LETTER: "Offer letter",
};

export function KycPanel(): React.ReactNode {
  const { status: authStatus, login, apiFetch } = useAuth();
  const [kyc, setKyc] = useState<KycMeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch("/api/kyc/me");
    if (res.ok) {
      const body = (await res.json()) as { kyc: KycMeResponse };
      setKyc(body.kyc);
    }
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => {
    if (authStatus === "authenticated") void loadStatus();
    else if (authStatus === "anonymous") setLoading(false);
  }, [authStatus, loadStatus]);

  if (authStatus === "loading" || (authStatus === "authenticated" && loading)) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  if (authStatus === "anonymous") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <p className="text-slate-600">Log in to manage your KYC verification.</p>
        <button
          type="button"
          onClick={() => login(() => void loadStatus())}
          className="mt-4 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
        >
          Log in
        </button>
      </div>
    );
  }

  const view: KycViewStatus = kyc?.status ?? "NOT_SUBMITTED";
  const canUpload = view === "NOT_SUBMITTED" || view === "REJECTED";

  return (
    <div className="space-y-6">
      <StatusBanner kyc={kyc} />
      {canUpload && <UploadForm onSubmitted={loadStatus} />}
    </div>
  );
}

function StatusBanner({ kyc }: { kyc: KycMeResponse | null }): React.ReactNode {
  const view: KycViewStatus = kyc?.status ?? "NOT_SUBMITTED";
  const styles: Record<KycViewStatus, string> = {
    NOT_SUBMITTED: "border-slate-200 bg-slate-50 text-slate-700",
    PENDING: "border-amber-200 bg-amber-50 text-amber-800",
    VERIFIED: "border-green-200 bg-green-50 text-green-800",
    REJECTED: "border-red-200 bg-red-50 text-red-800",
  };
  const labels: Record<KycViewStatus, string> = {
    NOT_SUBMITTED: "Not submitted",
    PENDING: "Under review",
    VERIFIED: "Verified",
    REJECTED: "Rejected",
  };
  const messages: Record<KycViewStatus, string> = {
    NOT_SUBMITTED: "Upload your documents below. KYC is only needed when you book — you can browse freely without it.",
    PENDING: "Your documents are being reviewed. We'll update this once they're checked.",
    VERIFIED: "Your identity is verified. You're all set to book.",
    REJECTED: "Your submission was rejected. Please review the reason and re-upload below.",
  };

  return (
    <div className={`rounded-xl border p-4 ${styles[view]}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold uppercase tracking-wide">KYC status:</span>
        <span className="text-sm font-bold">{labels[view]}</span>
      </div>
      <p className="mt-1 text-sm">{messages[view]}</p>
      {view === "REJECTED" && kyc?.rejectReason && (
        <p className="mt-2 text-sm">
          <span className="font-semibold">Reason:</span> {kyc.rejectReason}
        </p>
      )}
    </div>
  );
}

function UploadForm({ onSubmitted }: { onSubmitted: () => Promise<void> }): React.ReactNode {
  const { apiFetch } = useAuth();
  const [front, setFront] = useState<SlotState>(emptySlot);
  const [back, setBack] = useState<SlotState>(emptySlot);
  const [supporting, setSupporting] = useState<SlotState>(emptySlot);
  const [docType, setDocType] = useState<KycSupportingDocType>("STUDENT_ID");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setters: Record<KycSlot, (s: SlotState) => void> = {
    aadhaar_front: setFront,
    aadhaar_back: setBack,
    supporting: setSupporting,
  };

  async function upload(slot: KycSlot, file: File): Promise<void> {
    const set = setters[slot];
    if (!kycMimeSchema.safeParse(file.type).success) {
      set({ ...emptySlot, fileName: file.name, error: "Use a JPG, PNG, or PDF file." });
      return;
    }
    set({ key: null, contentType: null, fileName: file.name, uploading: true, error: null });
    const form = new FormData();
    form.set("slot", slot);
    form.set("file", file);
    if (slot === "supporting") form.set("docType", docType);
    try {
      const res = await apiFetch("/api/kyc/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        set({ ...emptySlot, fileName: file.name, error: body.message ?? "Upload failed." });
        return;
      }
      const { key } = (await res.json()) as { key: string };
      set({ key, contentType: file.type as KycMime, fileName: file.name, uploading: false, error: null });
    } catch {
      set({ ...emptySlot, fileName: file.name, error: "Network error during upload." });
    }
  }

  const ready =
    front.key !== null && back.key !== null && supporting.key !== null && !submitting;

  async function submit(): Promise<void> {
    if (!front.key || !back.key || !supporting.key || !front.contentType || !back.contentType || !supporting.contentType) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/kyc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aadhaarFront: { key: front.key, contentType: front.contentType },
          aadhaarBack: { key: back.key, contentType: back.contentType },
          supporting: { key: supporting.key, contentType: supporting.contentType, docType },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "Could not submit. Please try again.");
        return;
      }
      await onSubmitted();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-base font-semibold text-slate-900">Upload documents</h2>
      <p className="mt-1 text-sm text-slate-500">
        Aadhaar (front &amp; back) and one supporting ID. JPG, PNG or PDF, up to 8&nbsp;MB each.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <DropZone label="Aadhaar — front" slot="aadhaar_front" state={front} onFile={upload} />
        <DropZone label="Aadhaar — back" slot="aadhaar_back" state={back} onFile={upload} />
        <div>
          <DropZone
            label="Supporting ID"
            slot="supporting"
            state={supporting}
            onFile={upload}
          />
          <select
            className="mt-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            value={docType}
            onChange={(e) => setDocType(e.target.value as KycSupportingDocType)}
            aria-label="Supporting document type"
          >
            {(Object.keys(SUPPORTING_LABELS) as KycSupportingDocType[]).map((t) => (
              <option key={t} value={t}>
                {SUPPORTING_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={!ready}
        onClick={() => void submit()}
        className="mt-5 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit for verification"}
      </button>
    </div>
  );
}

function DropZone({
  label,
  slot,
  state,
  onFile,
}: {
  label: string;
  slot: KycSlot;
  state: SlotState;
  onFile: (slot: KycSlot, file: File) => void;
}): React.ReactNode {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function onDrop(e: DragEvent<HTMLButtonElement>): void {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(slot, file);
  }

  const done = state.key !== null;

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex h-28 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed px-2 text-center text-xs transition ${
          dragging
            ? "border-teal-500 bg-teal-50"
            : done
              ? "border-green-300 bg-green-50 text-green-700"
              : "border-slate-300 bg-slate-50 text-slate-500 hover:border-teal-400"
        }`}
      >
        {state.uploading ? (
          <span>Uploading…</span>
        ) : done ? (
          <>
            <span className="font-semibold">✓ Uploaded</span>
            <span className="mt-0.5 max-w-full truncate">{state.fileName}</span>
          </>
        ) : (
          <>
            <span className="font-medium">Drop file or click</span>
            <span className="mt-0.5">JPG, PNG, PDF</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(slot, file);
          e.target.value = "";
        }}
      />
      {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </div>
  );
}
