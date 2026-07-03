"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GENDER_POLICIES,
  paiseToRupees,
  rupeesToPaise,
  type GenderPolicy,
  type HostListing,
} from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import {
  genderPolicyLabel,
  hasPricedRoom,
  listingEditWillRequeue,
  MIN_PUBLISH_PHOTOS,
  missingSubmitGates,
  photosStillNeeded,
} from "../../lib/host";
import { ErrorNote, SectionCard, Skeleton } from "./shared";
import { RoomsEditor } from "./RoomsEditor";
import { PhotoUploader } from "./PhotoUploader";

/**
 * The multi-step create / edit listing form. A new listing is created as a DRAFT
 * on the backend and never goes live from here — the final step submits it to the
 * ADMIN review queue (see /CLAUDE.md: the client is untrusted; going live is the
 * admin's call). Once a draft exists, edits auto-save. In edit mode, changing the
 * address (or a room's rent > 20%) re-queues a LIVE listing for approval; the
 * form warns before saving and confirms from the server's response.
 */
const STEPS = ["Basics", "Rooms & pricing", "Amenities & rules", "Photos", "Review"] as const;

interface Basics {
  actualName: string;
  alias: string;
  areaLabel: string;
  city: string;
  pincode: string;
  fullAddress: string;
  latitude: string;
  longitude: string;
  gender: GenderPolicy;
  instantBook: boolean;
  tokenRupees: string;
}

interface Details {
  amenities: string[];
  houseRules: string[];
  mealsOffered: boolean;
  mealChargesRupees: string;
}

const emptyBasics: Basics = {
  actualName: "",
  alias: "",
  areaLabel: "",
  city: "",
  pincode: "",
  fullAddress: "",
  latitude: "",
  longitude: "",
  gender: "COED",
  instantBook: true,
  tokenRupees: "",
};

const emptyDetails: Details = { amenities: [], houseRules: [], mealsOffered: false, mealChargesRupees: "" };

export function ListingForm({ listingId: initialId }: { listingId?: string }): React.ReactNode {
  const { apiFetch } = useAuth();
  const router = useRouter();

  const [listingId, setListingId] = useState<string | null>(initialId ?? null);
  const [listing, setListing] = useState<HostListing | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(initialId ? "loading" : "ready");
  const [step, setStep] = useState(0);

  const [basics, setBasics] = useState<Basics>(emptyBasics);
  const [details, setDetails] = useState<Details>(emptyDetails);

  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [requeuedNotice, setRequeuedNotice] = useState(false);

  // Guard so the form is hydrated from a loaded listing only once (a later reload
  // after adding rooms/photos must not clobber unsaved basics/details edits).
  const hydratedFor = useRef<string | null>(null);
  const lastSaved = useRef<string>("");

  const loadListing = useCallback(
    async (id: string) => {
      const res = await apiFetch(`/api/host/listings/${encodeURIComponent(id)}`);
      if (!res.ok) {
        setLoadState("error");
        return null;
      }
      const body = (await res.json()) as { listing: HostListing };
      setListing(body.listing);
      setLoadState("ready");
      return body.listing;
    },
    [apiFetch],
  );

  useEffect(() => {
    if (initialId) void loadListing(initialId);
  }, [initialId, loadListing]);

  // Hydrate the editable form from the loaded listing exactly once.
  useEffect(() => {
    if (!listing || hydratedFor.current === listing.id) return;
    hydratedFor.current = listing.id;
    const b: Basics = {
      actualName: listing.actualName,
      alias: listing.alias,
      areaLabel: listing.areaLabel,
      city: listing.city,
      pincode: listing.pincode,
      fullAddress: listing.fullAddress,
      latitude: String(listing.location.lat),
      longitude: String(listing.location.lng),
      gender: listing.gender,
      instantBook: listing.instantBook,
      tokenRupees: listing.tokenAmountPaise != null ? String(paiseToRupees(listing.tokenAmountPaise)) : "",
    };
    const d: Details = {
      amenities: listing.amenities,
      houseRules: listing.houseRules,
      mealsOffered: listing.mealsOffered,
      mealChargesRupees: listing.mealChargesPaise != null ? String(paiseToRupees(listing.mealChargesPaise)) : "",
    };
    setBasics(b);
    setDetails(d);
    lastSaved.current = JSON.stringify(editableFields(b, d));
  }, [listing]);

  const isPublished = listing?.status === "PUBLISHED";

  // Predict the re-queue so the host is warned BEFORE saving a live listing.
  const willRequeue = useMemo(() => {
    if (!listing || !isPublished) return false;
    return listingEditWillRequeue(
      {
        fullAddress: listing.fullAddress,
        pincode: listing.pincode,
        latitude: listing.location.lat,
        longitude: listing.location.lng,
      },
      {
        fullAddress: basics.fullAddress,
        pincode: basics.pincode,
        latitude: Number(basics.latitude),
        longitude: Number(basics.longitude),
      },
    );
  }, [listing, isPublished, basics]);

  // Debounced auto-save once a draft exists and the basics are valid.
  useEffect(() => {
    if (!listingId) return;
    const fields = editableFields(basics, details);
    if (!fields) return; // incomplete/invalid — don't persist a partial
    const serialized = JSON.stringify(fields);
    if (serialized === lastSaved.current) return;
    const t = setTimeout(() => void patchFields(fields, serialized), 900);
    return () => clearTimeout(t);
  }, [basics, details, listingId]);

  async function patchFields(fields: EditableFields, serialized: string): Promise<boolean> {
    setSaveState("saving");
    setError(null);
    try {
      const res = await apiFetch(`/api/host/listings/${encodeURIComponent(listingId as string)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (res.status === 422) {
        // NO_EFFECTIVE_CHANGE — nothing actually differed; treat as saved.
        lastSaved.current = serialized;
        setSaveState("saved");
        return true;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "Could not save your changes.");
        setSaveState("error");
        return false;
      }
      const body = (await res.json()) as { requeued: boolean };
      if (body.requeued) setRequeuedNotice(true);
      lastSaved.current = serialized;
      setSaveState("saved");
      await loadListing(listingId as string);
      return true;
    } catch {
      setError("Network error while saving.");
      setSaveState("error");
      return false;
    }
  }

  // Create the draft from the basics (step 1 of a brand-new listing).
  async function createDraft(): Promise<string | null> {
    const payload = createPayload(basics, details);
    if (!payload) {
      setError("Fill in the property name, address, area, city, 6-digit pincode and map pin.");
      return null;
    }
    setSaveState("saving");
    setError(null);
    try {
      const res = await apiFetch("/api/host/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "Could not create the listing.");
        setSaveState("error");
        return null;
      }
      const body = (await res.json()) as { listing: { id: string } };
      const id = body.listing.id;
      setListingId(id);
      const loaded = await loadListing(id);
      // Mark the just-created values as saved so auto-save doesn't immediately re-PATCH.
      if (loaded) lastSaved.current = JSON.stringify(editableFields(basics, details));
      setSaveState("saved");
      return id;
    } catch {
      setError("Network error. Please try again.");
      setSaveState("error");
      return null;
    }
  }

  async function goNext(): Promise<void> {
    setError(null);
    if (step === 0 && !listingId) {
      const id = await createDraft();
      if (!id) return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function submitForReview(): Promise<void> {
    if (!listingId) return;
    setError(null);
    setSaveState("saving");
    try {
      const res = await apiFetch(`/api/host/listings/${encodeURIComponent(listingId)}/submit`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "Could not submit for review.");
        setSaveState("error");
        return;
      }
      router.push("/host/listings");
    } catch {
      setError("Network error. Please try again.");
      setSaveState("error");
    }
  }

  if (loadState === "loading") return <Skeleton className="h-96" />;
  if (loadState === "error") return <ErrorNote>Could not load this listing. It may not be yours.</ErrorNote>;

  const photoCount = listing?.photos.length ?? 0;
  const priced = listing ? hasPricedRoom(listing) : false;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{initialId ? "Edit listing" : "List a property"}</h1>
        <SaveIndicator state={saveState} hasDraft={listingId !== null} />
      </header>

      <Stepper current={step} onJump={(i) => listingId && setStep(i)} canJump={listingId !== null} />

      {requeuedNotice && (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          Your changes re-queued this listing for approval. It stays visible until our team reviews the update.
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      {step === 0 && (
        <BasicsStep basics={basics} setBasics={setBasics} willRequeue={willRequeue} />
      )}

      {step === 1 && (
        <SectionCard title="Rooms, beds & pricing">
          {listingId && listing ? (
            <RoomsEditor listingId={listingId} rooms={listing.rooms} onChanged={async () => void (await loadListing(listingId))} />
          ) : (
            <p className="text-sm text-slate-500">Save the basics first to add rooms.</p>
          )}
        </SectionCard>
      )}

      {step === 2 && <DetailsStep details={details} setDetails={setDetails} />}

      {step === 3 && (
        <SectionCard title="Photos">
          {listingId && listing ? (
            <PhotoUploader listingId={listingId} photos={listing.photos} onChanged={async () => void (await loadListing(listingId))} />
          ) : (
            <p className="text-sm text-slate-500">Save the basics first to add photos.</p>
          )}
        </SectionCard>
      )}

      {step === 4 && (
        <ReviewStep
          photoCount={photoCount}
          hasPricedRoom={priced}
          isPublished={isPublished}
          onSubmit={submitForReview}
          submitting={saveState === "saving"}
        />
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => void goNext()}
            disabled={saveState === "saving"}
            className="rounded-md bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {step === 0 && !listingId ? "Save & continue" : "Continue"}
          </button>
        ) : (
          <span className="text-xs text-slate-400">Submit above when ready</span>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Steps
// ===========================================================================

function BasicsStep({
  basics,
  setBasics,
  willRequeue,
}: {
  basics: Basics;
  setBasics: React.Dispatch<React.SetStateAction<Basics>>;
  willRequeue: boolean;
}): React.ReactNode {
  const set = <K extends keyof Basics>(key: K, value: Basics[K]): void => setBasics((b) => ({ ...b, [key]: value }));
  const lat = Number(basics.latitude);
  const lng = Number(basics.longitude);
  const showMap = Number.isFinite(lat) && Number.isFinite(lng) && basics.latitude !== "" && basics.longitude !== "";

  return (
    <SectionCard title="Property basics">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Property name (private)" hint="Shown to you and confirmed tenants only.">
          <input value={basics.actualName} onChange={(e) => set("actualName", e.target.value)} className={inputClass} placeholder="Sunrise Residency" />
        </Field>
        <Field label="Public name / alias" hint="What browsers see before booking.">
          <input value={basics.alias} onChange={(e) => set("alias", e.target.value)} className={inputClass} placeholder="Cosy PG near Metro" />
        </Field>
        <Field label="Area label" hint="Coarse area shown publicly.">
          <input value={basics.areaLabel} onChange={(e) => set("areaLabel", e.target.value)} className={inputClass} placeholder="Koramangala" />
        </Field>
        <Field label="City">
          <input value={basics.city} onChange={(e) => set("city", e.target.value)} className={inputClass} placeholder="Bengaluru" />
        </Field>
        <Field label="Pincode">
          <input value={basics.pincode} onChange={(e) => set("pincode", e.target.value)} inputMode="numeric" maxLength={6} className={inputClass} placeholder="560095" />
        </Field>
        <Field label="Gender policy">
          <select value={basics.gender} onChange={(e) => set("gender", e.target.value as GenderPolicy)} className={inputClass}>
            {GENDER_POLICIES.map((g) => (
              <option key={g} value={g}>
                {genderPolicyLabel(g)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Full address (private)" hint="Revealed only to a confirmed tenant, host and admin.">
          <textarea value={basics.fullAddress} onChange={(e) => set("fullAddress", e.target.value)} rows={2} className={inputClass} placeholder="Street, landmark, area" />
        </Field>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Latitude" hint="Map pin — used for nearby search.">
          <input value={basics.latitude} onChange={(e) => set("latitude", e.target.value)} inputMode="decimal" className={inputClass} placeholder="12.9352" />
        </Field>
        <Field label="Longitude">
          <input value={basics.longitude} onChange={(e) => set("longitude", e.target.value)} inputMode="decimal" className={inputClass} placeholder="77.6245" />
        </Field>
      </div>

      {showMap && (
        <div className="mt-3">
          <iframe
            title="Map pin preview"
            className="h-56 w-full rounded-lg border border-slate-200"
            loading="lazy"
            referrerPolicy="no-referrer"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${[lng - 0.008, lat - 0.008, lng + 0.008, lat + 0.008]
              .map((n) => n.toFixed(5))
              .join("%2C")}&layer=mapnik&marker=${lat.toFixed(5)}%2C${lng.toFixed(5)}`}
          />
          <p className="mt-1 text-xs text-slate-500">Drag isn&apos;t supported here — fine-tune the pin with the lat/long fields.</p>
        </div>
      )}

      <div className="mt-4 rounded-lg bg-slate-50 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Booking type</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <BookingTypeOption
            active={basics.instantBook}
            onClick={() => set("instantBook", true)}
            title="Instant Book"
            desc="Tenants confirm instantly on payment."
          />
          <BookingTypeOption
            active={!basics.instantBook}
            onClick={() => set("instantBook", false)}
            title="Request to Book"
            desc="You accept each request within 24h before payment."
          />
        </div>
      </div>

      <div className="mt-3">
        <Field label="Token amount (₹, optional)" hint="What a tenant pays now to secure a bed. Leave blank to use the deposit / first month's rent.">
          <input value={basics.tokenRupees} onChange={(e) => set("tokenRupees", e.target.value)} inputMode="numeric" className={`${inputClass} sm:max-w-xs`} placeholder="2000" />
        </Field>
      </div>

      {willRequeue && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Changing the address will re-queue this live listing for approval.
        </p>
      )}
    </SectionCard>
  );
}

function BookingTypeOption({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}): React.ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg border p-3 text-left transition ${
        active ? "border-teal-500 bg-teal-50 ring-1 ring-teal-500" : "border-slate-300 bg-white hover:border-slate-400"
      }`}
    >
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="mt-0.5 text-xs text-slate-500">{desc}</p>
    </button>
  );
}

function DetailsStep({
  details,
  setDetails,
}: {
  details: Details;
  setDetails: React.Dispatch<React.SetStateAction<Details>>;
}): React.ReactNode {
  return (
    <SectionCard title="Amenities, meals & house rules">
      <ChipList
        label="Amenities"
        placeholder="e.g. WiFi, AC, Laundry"
        items={details.amenities}
        onChange={(amenities) => setDetails((d) => ({ ...d, amenities }))}
      />

      <div className="mt-4 rounded-lg bg-slate-50 p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={details.mealsOffered}
            onChange={(e) => setDetails((d) => ({ ...d, mealsOffered: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          Meals offered
        </label>
        {details.mealsOffered && (
          <div className="mt-2">
            <Field label="Monthly meal charges (₹, optional)">
              <input
                value={details.mealChargesRupees}
                onChange={(e) => setDetails((d) => ({ ...d, mealChargesRupees: e.target.value }))}
                inputMode="numeric"
                className={`${inputClass} sm:max-w-xs`}
                placeholder="3000"
              />
            </Field>
          </div>
        )}
      </div>

      <div className="mt-4">
        <ChipList
          label="House rules"
          placeholder="e.g. No smoking, Gates close 11pm"
          items={details.houseRules}
          onChange={(houseRules) => setDetails((d) => ({ ...d, houseRules }))}
        />
      </div>
    </SectionCard>
  );
}

function ChipList({
  label,
  placeholder,
  items,
  onChange,
}: {
  label: string;
  placeholder: string;
  items: string[];
  onChange: (items: string[]) => void;
}): React.ReactNode {
  const [draft, setDraft] = useState("");
  function add(): void {
    const v = draft.trim();
    if (v && !items.includes(v)) onChange([...items, v]);
    setDraft("");
  }
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {items.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li key={item} className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
              {item}
              <button type="button" onClick={() => onChange(items.filter((i) => i !== item))} className="text-slate-400 hover:text-slate-700" aria-label={`Remove ${item}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className={inputClass}
        />
        <button type="button" onClick={add} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Add
        </button>
      </div>
    </div>
  );
}

function ReviewStep({
  photoCount,
  hasPricedRoom: priced,
  isPublished,
  onSubmit,
  submitting,
}: {
  photoCount: number;
  hasPricedRoom: boolean;
  isPublished: boolean;
  onSubmit: () => void;
  submitting: boolean;
}): React.ReactNode {
  const missing = missingSubmitGates({ photoCount, hasPricedRoom: priced });
  const ready = missing.length === 0;
  const stillNeeded = photosStillNeeded(photoCount);

  return (
    <SectionCard title="Review & submit">
      {isPublished ? (
        <p className="text-sm text-slate-600">
          This listing is already live. Your edits save automatically; there&apos;s nothing to submit unless a change
          re-queued it for approval.
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            When you submit, your listing goes to our team for a quick review — it never goes live automatically.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            <GateRow ok={photoCount >= MIN_PUBLISH_PHOTOS} label={`At least ${MIN_PUBLISH_PHOTOS} photos`} detail={photoCount >= MIN_PUBLISH_PHOTOS ? `${photoCount} added` : `${stillNeeded} more needed`} />
            <GateRow ok={priced} label="At least one priced room" detail={priced ? "Ready" : "Add a room with rent"} />
          </ul>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!ready || submitting}
            className="mt-4 rounded-md bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit for review"}
          </button>
          {!ready && <p className="mt-2 text-xs text-slate-500">Complete the checklist above to submit.</p>}
        </>
      )}
    </SectionCard>
  );
}

function GateRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }): React.ReactNode {
  return (
    <li className="flex items-center gap-2">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ok ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
        {ok ? "✓" : "!"}
      </span>
      <span className="font-medium text-slate-700">{label}</span>
      <span className="text-slate-400">— {detail}</span>
    </li>
  );
}

// ===========================================================================
// Small shared bits + payload builders
// ===========================================================================

function Stepper({ current, onJump, canJump }: { current: number; onJump: (i: number) => void; canJump: boolean }): React.ReactNode {
  return (
    <ol className="flex flex-wrap gap-1 text-xs">
      {STEPS.map((label, i) => {
        const active = i === current;
        const done = i < current;
        return (
          <li key={label}>
            <button
              type="button"
              onClick={() => onJump(i)}
              disabled={!canJump && i > 0}
              className={`rounded-full px-3 py-1 font-medium transition ${
                active
                  ? "bg-teal-600 text-white"
                  : done
                    ? "bg-teal-50 text-teal-700"
                    : "bg-slate-100 text-slate-500"
              } disabled:cursor-not-allowed`}
            >
              {i + 1}. {label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function SaveIndicator({ state, hasDraft }: { state: "idle" | "saving" | "saved" | "error"; hasDraft: boolean }): React.ReactNode {
  if (!hasDraft) return <span className="text-xs text-slate-400">Not saved yet</span>;
  const map = {
    idle: <span className="text-xs text-slate-400">Draft saved</span>,
    saving: <span className="text-xs text-slate-500">Saving…</span>,
    saved: <span className="text-xs text-green-600">Draft saved ✓</span>,
    error: <span className="text-xs text-red-600">Save failed</span>,
  };
  return map[state];
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.ReactNode {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

const inputClass = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none";

interface EditableFields {
  actualName: string;
  alias: string;
  areaLabel: string;
  city: string;
  pincode: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
  gender: GenderPolicy;
  instantBook: boolean;
  amenities: string[];
  houseRules: string[];
  mealsOffered: boolean;
  mealChargesPaise: number | null;
  tokenAmountPaise: number | null;
}

/** Convert a rupee string to paise via the shared helper; null if blank/invalid. */
function rupeesFieldToPaise(rupees: string): number | null {
  const trimmed = rupees.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  try {
    return rupeesToPaise(n);
  } catch {
    return null;
  }
}

/** The full editable field set for auto-save, or null when basics are incomplete. */
function editableFields(basics: Basics, details: Details): EditableFields | null {
  const lat = Number(basics.latitude);
  const lng = Number(basics.longitude);
  const complete =
    basics.actualName.trim() &&
    basics.alias.trim() &&
    basics.areaLabel.trim() &&
    basics.city.trim() &&
    /^\d{6}$/.test(basics.pincode.trim()) &&
    basics.fullAddress.trim() &&
    Number.isFinite(lat) &&
    basics.latitude.trim() !== "" &&
    Number.isFinite(lng) &&
    basics.longitude.trim() !== "";
  if (!complete) return null;
  return {
    actualName: basics.actualName.trim(),
    alias: basics.alias.trim(),
    areaLabel: basics.areaLabel.trim(),
    city: basics.city.trim(),
    pincode: basics.pincode.trim(),
    fullAddress: basics.fullAddress.trim(),
    latitude: lat,
    longitude: lng,
    gender: basics.gender,
    instantBook: basics.instantBook,
    amenities: details.amenities,
    houseRules: details.houseRules,
    mealsOffered: details.mealsOffered,
    mealChargesPaise: details.mealsOffered ? rupeesFieldToPaise(details.mealChargesRupees) : null,
    tokenAmountPaise: rupeesFieldToPaise(basics.tokenRupees),
  };
}

/** The create body (createListingSchema shape); null when basics are incomplete. */
function createPayload(basics: Basics, details: Details): Record<string, unknown> | null {
  const fields = editableFields(basics, details);
  if (!fields) return null;
  const payload: Record<string, unknown> = {
    alias: fields.alias,
    actualName: fields.actualName,
    areaLabel: fields.areaLabel,
    city: fields.city,
    pincode: fields.pincode,
    fullAddress: fields.fullAddress,
    latitude: fields.latitude,
    longitude: fields.longitude,
    gender: fields.gender,
    instantBook: fields.instantBook,
    amenities: fields.amenities,
    houseRules: fields.houseRules,
    mealsOffered: fields.mealsOffered,
  };
  // createListingSchema: token must be positive; meal charges omitted unless set.
  if (fields.tokenAmountPaise != null && fields.tokenAmountPaise > 0) payload.tokenAmountPaise = fields.tokenAmountPaise;
  if (fields.mealsOffered && fields.mealChargesPaise != null) payload.mealChargesPaise = fields.mealChargesPaise;
  return payload;
}
