"use client";

import { useRef, useState, type DragEvent } from "react";
import type { PublicListingPhoto } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { MIN_PUBLISH_PHOTOS, photosStillNeeded } from "../../lib/host";

/**
 * Drag-and-drop photo upload for a listing. Reuses the KYC presigned pattern:
 * each file is streamed to the PUBLIC bucket via `/api/host/listings/:id/photos/
 * upload` (presign → PUT server-side → attach), so the browser never touches the
 * bucket and the strict CSP holds. A listing needs at least 5 photos before it
 * can be submitted for review; the running count makes that gate visible.
 */
const ACCEPT = "image/jpeg,image/png";
const MAX_BYTES = 8 * 1024 * 1024;

export function PhotoUploader({
  listingId,
  photos,
  onChanged,
}: {
  listingId: string;
  photos: PublicListingPhoto[];
  onChanged: () => Promise<void>;
}): React.ReactNode {
  const { apiFetch } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function uploadOne(file: File): Promise<void> {
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      setError("Photos must be JPG or PNG.");
      return;
    }
    if (file.size === 0 || file.size > MAX_BYTES) {
      setError("Each photo must be under 8 MB.");
      return;
    }
    const form = new FormData();
    form.set("file", file);
    // The first-ever photo becomes the cover; keep upload order stable.
    form.set("isPrimary", String(photos.length === 0 && uploading === 0));
    form.set("sortOrder", String(photos.length + uploading));
    const res = await apiFetch(`/api/host/listings/${encodeURIComponent(listingId)}/photos/upload`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setError(body.message ?? "Could not upload a photo. Please try again.");
    }
  }

  async function handleFiles(files: FileList | File[]): Promise<void> {
    setError(null);
    const list = Array.from(files);
    setUploading(list.length);
    // Sequential so sortOrder + the primary pick stay deterministic.
    for (const file of list) {
      await uploadOne(file);
    }
    setUploading(0);
    await onChanged();
  }

  function onDrop(e: DragEvent<HTMLButtonElement>): void {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files);
  }

  const remaining = photosStillNeeded(photos.length);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-600">
          {photos.length} uploaded ·{" "}
          {remaining > 0 ? (
            <span className="font-semibold text-amber-700">{remaining} more needed</span>
          ) : (
            <span className="font-semibold text-green-700">minimum met ✓</span>
          )}
        </p>
        <p className="text-xs text-slate-400">At least {MIN_PUBLISH_PHOTOS} · JPG or PNG</p>
      </div>

      {photos.length > 0 && (
        <ul className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {photos.map((p) => (
            <li key={p.id} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              <img src={p.url} alt="" className="h-full w-full object-cover" />
              {p.isPrimary && (
                <span className="absolute left-1 top-1 rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  Cover
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        disabled={uploading > 0}
        className={`flex h-28 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 text-center text-sm transition ${
          dragging ? "border-teal-500 bg-teal-50" : "border-slate-300 bg-slate-50 text-slate-500 hover:border-teal-400"
        } disabled:opacity-60`}
      >
        {uploading > 0 ? (
          <span>Uploading {uploading} photo{uploading > 1 ? "s" : ""}…</span>
        ) : (
          <>
            <span className="font-medium">Drop photos or click to browse</span>
            <span className="mt-0.5 text-xs">You can add several at once</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
