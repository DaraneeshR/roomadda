"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatPaise,
  type HostServiceRequest,
  type HostListing,
  type MealMenuDay,
  type MealTemplate,
  type RevenueSummary,
  type WeeklyMenu,
} from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { ErrorNote, Money, SectionCard, Skeleton, StatTile, useHostListings, ListingSelect } from "./shared";

/**
 * Meals, service queue & revenue — the "run the property" surface. The service
 * queue spans all the host's listings (escalated first); the meal menu and the
 * read-only revenue view are per-property. Money is server-owned: the revenue
 * figures come straight from each listing's RevenueSummary and are only rendered.
 */
export function OperationsPanel(): React.ReactNode {
  const { listings, state } = useHostListings();
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    if (!selected && listings.length > 0) setSelected(listings[0]!.id);
  }, [listings, selected]);

  if (state === "loading") return <Skeleton className="h-64" />;
  if (state === "error") return <ErrorNote>Could not load your properties. Please refresh.</ErrorNote>;

  const current = listings.find((l) => l.id === selected) ?? null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Meals, service &amp; revenue</h1>

      <ServiceQueue />

      {listings.length === 0 ? (
        <SectionCard title="Meals & revenue">
          <p className="text-sm text-slate-600">List a property to manage its menu and see revenue.</p>
        </SectionCard>
      ) : (
        <>
          <div className="flex justify-end">
            <ListingSelect listings={listings} value={selected} onChange={setSelected} />
          </div>
          {current && <MenuManager listing={current} />}
          {current && <RevenuePanel listingId={current.id} />}
        </>
      )}
    </div>
  );
}

// --- Service queue ----------------------------------------------------------

interface QueueStats {
  openCount: number;
  escalatedCount: number;
  avgResolutionHours: number | null;
}

function ServiceQueue(): React.ReactNode {
  const { apiFetch } = useAuth();
  const [items, setItems] = useState<HostServiceRequest[] | null>(null);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/host/service-requests?limit=50");
    if (res.ok) {
      const body = (await res.json()) as { items: HostServiceRequest[]; stats: QueueStats };
      setItems(body.items);
      setStats(body.stats);
    } else {
      setError("Could not load the service queue.");
    }
  }, [apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Open requests" value={stats.openCount} tone={stats.openCount > 0 ? "warn" : "default"} />
          <StatTile label="Escalated" value={stats.escalatedCount} tone={stats.escalatedCount > 0 ? "bad" : "default"} />
          <StatTile
            label="Avg resolution"
            value={stats.avgResolutionHours != null ? `${stats.avgResolutionHours.toFixed(1)}h` : "—"}
          />
        </div>
      )}

      <SectionCard title="Service queue">
        {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
        {!items ? (
          <Skeleton className="h-24" />
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500">No open requests. Tenant maintenance requests appear here.</p>
        ) : (
          <ul className="space-y-3">
            {items.map((req) => (
              <ServiceItem key={req.id} req={req} onChanged={load} />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

const SERVICE_PILL: Record<string, string> = {
  SUBMITTED: "bg-amber-100 text-amber-800",
  ACKNOWLEDGED: "bg-sky-100 text-sky-800",
  RESOLVED: "bg-green-100 text-green-800",
};

function ServiceItem({ req, onChanged }: { req: HostServiceRequest; onChanged: () => Promise<void> }): React.ReactNode {
  const { apiFetch } = useAuth();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);

  async function action(path: string, body?: unknown): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(path, {
        method: "POST",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? "Could not update the request.");
        return;
      }
      setNote("");
      setShowNote(false);
      await onChanged();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const base = `/api/host/service-requests/${encodeURIComponent(req.id)}`;

  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">
            #{req.ticketNumber} · {req.category.replace(/_/g, " ").toLowerCase()}
            {req.escalated && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Escalated</span>}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {req.tenantName}
            {req.roomName && <> · {req.roomName}</>} · priority {req.priority.toLowerCase()}
          </p>
          <p className="mt-1 text-sm text-slate-600">{req.description}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${SERVICE_PILL[req.status] ?? "bg-slate-100 text-slate-600"}`}>
          {req.status.toLowerCase()}
        </span>
      </div>

      {req.comments.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
          {req.comments.map((c) => (
            <li key={c.id} className="text-xs text-slate-500">
              <span className="font-medium text-slate-600">{c.authorName}:</span> {c.body}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {req.status === "SUBMITTED" && (
          <button type="button" onClick={() => void action(`${base}/acknowledge`)} disabled={busy} className={btnClass}>
            Acknowledge
          </button>
        )}
        {req.status !== "RESOLVED" && (
          <>
            <button type="button" onClick={() => setShowNote((v) => !v)} className={btnClass}>
              Note
            </button>
            <button type="button" onClick={() => void action(`${base}/resolve`)} disabled={busy} className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
              Resolve
            </button>
          </>
        )}
      </div>

      {showNote && (
        <div className="mt-2 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note the tenant will see…"
            className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => note.trim() && void action(`${base}/notes`, { note: note.trim() })}
            disabled={busy || !note.trim()}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      )}
    </li>
  );
}

const btnClass = "rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

// --- Menu manager (daily + templates) ---------------------------------------

const SLOTS = ["breakfast", "lunch", "dinner"] as const;
type Slot = (typeof SLOTS)[number];
const WEEKDAYS: Array<[keyof WeeklyMenu, string]> = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
];

function MenuManager({ listing }: { listing: HostListing }): React.ReactNode {
  const { apiFetch } = useAuth();
  const [days, setDays] = useState<MealMenuDay[] | null>(null);
  const [templates, setTemplates] = useState<MealTemplate[] | null>(null);

  const loadMenu = useCallback(async () => {
    const res = await apiFetch(`/api/host/listings/${encodeURIComponent(listing.id)}/menu`);
    if (res.ok) {
      const body = (await res.json()) as { days: MealMenuDay[] };
      setDays(body.days);
    }
  }, [apiFetch, listing.id]);

  const loadTemplates = useCallback(async () => {
    const res = await apiFetch(`/api/host/listings/${encodeURIComponent(listing.id)}/menu-templates`);
    if (res.ok) {
      const body = (await res.json()) as { items: MealTemplate[] };
      setTemplates(body.items);
    }
  }, [apiFetch, listing.id]);

  useEffect(() => {
    void loadMenu();
    void loadTemplates();
  }, [loadMenu, loadTemplates]);

  if (!listing.mealsOffered) {
    return (
      <SectionCard title="Meal menu">
        <p className="text-sm text-slate-500">
          Meals aren&apos;t offered at this property. Enable meals in the listing&apos;s edit form to publish a menu.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Meal menu">
      {!days ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {days.map((day) => (
            <DayEditor key={day.date} listingId={listing.id} day={day} onSaved={loadMenu} />
          ))}
        </div>
      )}

      <div className="mt-5 border-t border-slate-100 pt-4">
        <MenuTemplates listingId={listing.id} templates={templates} onChanged={loadTemplates} onApplied={loadMenu} />
      </div>
    </SectionCard>
  );
}

function DayEditor({ listingId, day, onSaved }: { listingId: string; day: MealMenuDay; onSaved: () => Promise<void> }): React.ReactNode {
  const { apiFetch } = useAuth();
  const [values, setValues] = useState<Record<Slot, string>>({
    breakfast: day.breakfast.text ?? "",
    lunch: day.lunch.text ?? "",
    dinner: day.dinner.text ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await apiFetch(`/api/host/listings/${encodeURIComponent(listingId)}/menu`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: day.date,
          breakfast: { text: values.breakfast.trim() || null },
          lunch: { text: values.lunch.trim() || null },
          dinner: { text: values.dinner.trim() || null },
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? "Could not save the menu.");
        return;
      }
      setSaved(true);
      await onSaved();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-700">
        {new Date(day.date).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}
      </p>
      <div className="mt-2 space-y-2">
        {SLOTS.map((slot) => (
          <label key={slot} className="block">
            <span className="mb-0.5 block text-[11px] font-medium capitalize text-slate-500">{slot}</span>
            <input
              value={values[slot]}
              onChange={(e) => {
                setValues((v) => ({ ...v, [slot]: e.target.value }));
                setSaved(false);
              }}
              placeholder="Not served"
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
            />
          </label>
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy}
        className="mt-2 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : saved ? "Saved ✓" : "Save day"}
      </button>
    </div>
  );
}

function MenuTemplates({
  listingId,
  templates,
  onChanged,
  onApplied,
}: {
  listingId: string;
  templates: MealTemplate[] | null;
  onChanged: () => Promise<void>;
  onApplied: () => Promise<void>;
}): React.ReactNode {
  const { apiFetch } = useAuth();
  const [showNew, setShowNew] = useState(false);
  const [weekStart, setWeekStart] = useState(nextMonday());
  const [error, setError] = useState<string | null>(null);

  async function apply(templateId: string): Promise<void> {
    setError(null);
    const res = await apiFetch(`/api/host/listings/${encodeURIComponent(listingId)}/menu-templates/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, weekStartDate: weekStart }),
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { message?: string };
      setError(b.message ?? "Could not apply the template.");
      return;
    }
    await onApplied();
  }

  async function remove(templateId: string): Promise<void> {
    const res = await apiFetch(`/api/host/listings/${encodeURIComponent(listingId)}/menu-templates/${encodeURIComponent(templateId)}`, {
      method: "DELETE",
    });
    if (res.ok) await onChanged();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">Weekly templates</p>
        <button type="button" onClick={() => setShowNew((v) => !v)} className={btnClass}>
          {showNew ? "Close" : "New template"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {showNew && <NewTemplateForm listingId={listingId} onCreated={async () => { setShowNew(false); await onChanged(); }} />}

      {templates && templates.length > 0 && (
        <div className="mt-3">
          <label className="mb-2 flex items-center gap-2 text-xs text-slate-600">
            Apply from week starting
            <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-teal-500 focus:outline-none" />
          </label>
          <ul className="divide-y divide-slate-100">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                <span className="text-sm text-slate-700">{t.name}</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void apply(t.id)} className={btnClass}>
                    Apply to week
                  </button>
                  <button type="button" onClick={() => void remove(t.id)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {templates && templates.length === 0 && !showNew && (
        <p className="mt-2 text-xs text-slate-500">No templates yet. Save a weekly plan to reuse it across weeks.</p>
      )}
    </div>
  );
}

function NewTemplateForm({ listingId, onCreated }: { listingId: string; onCreated: () => Promise<void> }): React.ReactNode {
  const { apiFetch } = useAuth();
  const [name, setName] = useState("");
  const [grid, setGrid] = useState<Record<string, Record<Slot, string>>>(() =>
    Object.fromEntries(WEEKDAYS.map(([key]) => [key, { breakfast: "", lunch: "", dinner: "" }])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setCell(dayKey: string, slot: Slot, value: string): void {
    setGrid((g) => ({ ...g, [dayKey]: { ...g[dayKey]!, [slot]: value } }));
  }

  async function submit(): Promise<void> {
    setError(null);
    if (!name.trim()) {
      setError("Give the template a name.");
      return;
    }
    const days = Object.fromEntries(
      WEEKDAYS.map(([key]) => {
        const cell = grid[key]!;
        return [
          key,
          {
            breakfast: { text: cell.breakfast.trim() || null, notAvailable: false },
            lunch: { text: cell.lunch.trim() || null, notAvailable: false },
            dinner: { text: cell.dinner.trim() || null, notAvailable: false },
          },
        ];
      }),
    ) as unknown as WeeklyMenu;

    setBusy(true);
    try {
      const res = await apiFetch(`/api/host/listings/${encodeURIComponent(listingId)}/menu-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), days }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? "Could not save the template.");
        return;
      }
      await onCreated();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Template name (e.g. Standard week)"
        className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none sm:max-w-xs"
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 pr-2 font-semibold">Day</th>
              {SLOTS.map((s) => (
                <th key={s} className="px-1 py-1 font-semibold capitalize">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAYS.map(([key, label]) => (
              <tr key={key}>
                <td className="py-1 pr-2 font-medium text-slate-600">{label}</td>
                {SLOTS.map((slot) => (
                  <td key={slot} className="px-1 py-1">
                    <input
                      value={grid[key]![slot]}
                      onChange={(e) => setCell(key, slot, e.target.value)}
                      className="w-full rounded border border-slate-300 px-2 py-1 focus:border-teal-500 focus:outline-none"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="mt-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save template"}
      </button>
    </div>
  );
}

function nextMonday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = (8 - day) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// --- Revenue ----------------------------------------------------------------

function RevenuePanel({ listingId }: { listingId: string }): React.ReactNode {
  const { apiFetch } = useAuth();
  const [rev, setRev] = useState<RevenueSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setRev(null);
    (async () => {
      const res = await apiFetch(`/api/host/listings/${encodeURIComponent(listingId)}/revenue`);
      if (!active) return;
      if (res.ok) setRev((await res.json()) as RevenueSummary);
      else setError("Could not load revenue.");
    })();
    return () => {
      active = false;
    };
  }, [apiFetch, listingId]);

  if (error) return <SectionCard title="Revenue"><ErrorNote>{error}</ErrorNote></SectionCard>;
  if (!rev) return <SectionCard title="Revenue"><Skeleton className="h-24" /></SectionCard>;

  const maxMonth = Math.max(1, ...rev.months.map((m) => m.expectedPaise));

  return (
    <SectionCard title="Revenue this month">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expected</p>
          <p className="mt-0.5 text-xl font-bold text-slate-900"><Money paise={rev.expectedPaise} /></p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Collected</p>
          <p className="mt-0.5 text-xl font-bold text-green-700"><Money paise={rev.collectedPaise} /></p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Overdue</p>
          <p className={`mt-0.5 text-xl font-bold ${rev.overduePaise > 0 ? "text-red-700" : "text-slate-900"}`}><Money paise={rev.overduePaise} /></p>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Occupancy: {rev.occupiedBeds} of {rev.totalBeds} beds filled ({rev.vacantBeds} vacant)
      </p>

      {rev.months.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Last 3 months</p>
          <div className="flex items-end gap-4">
            {rev.months.map((m) => (
              <div key={m.periodMonth} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-24 w-full items-end justify-center gap-1">
                  <div
                    className="w-1/2 rounded-t bg-slate-300"
                    style={{ height: `${Math.round((m.expectedPaise / maxMonth) * 100)}%` }}
                    title={`Expected ${formatPaise(m.expectedPaise)}`}
                  />
                  <div
                    className="w-1/2 rounded-t bg-teal-500"
                    style={{ height: `${Math.round((m.collectedPaise / maxMonth) * 100)}%` }}
                    title={`Collected ${formatPaise(m.collectedPaise)}`}
                  />
                </div>
                <span className="text-[11px] text-slate-500">{m.periodLabel}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-4 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-slate-300" /> Expected</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-teal-500" /> Collected</span>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
