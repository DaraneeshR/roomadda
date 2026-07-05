import { useState } from "react";
import { Button, Checkbox, Stack, Typography } from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatPaise, type BookingLedgerEntry } from "@roomadda/shared";
import { erpApi } from "../api/erp";
import { CursorTable, type Column } from "../components/CursorTable";
import { usePaginatedQuery } from "../components/usePaginatedQuery";
import { BookingDetailDialog } from "../components/erp/BookingDetailDialog";
import { pushToast } from "../lib/toastBus";

const short = (id: string): string => id.slice(0, 8);
const KEY = ["erp", "approvals"];

/**
 * Approvals (§15.3). The queue of bookings awaiting a decision. "Review" opens the
 * shared booking/KYC detail (customer + docs + invoice + net commission) where a
 * decision can be made; the row also offers a quick approve/reject and the toolbar
 * a bulk approve. Every action hits the audited /v1/erp/approvals endpoints.
 */
export function ErpApprovalsPage() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const page = usePaginatedQuery<BookingLedgerEntry>(KEY, (cursor, limit) => erpApi.approvals(cursor, limit));
  const refresh = () => {
    setSelected(new Set());
    void qc.invalidateQueries({ queryKey: KEY });
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const approve = useMutation({
    mutationFn: (id: string) => erpApi.approveBooking(id),
    onSuccess: () => {
      pushToast("Booking approved", "success");
      refresh();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => erpApi.rejectBooking(id, reason),
    onSuccess: () => {
      pushToast("Booking rejected", "success");
      refresh();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const bulk = useMutation({
    mutationFn: (ids: string[]) => erpApi.bulkApprove(ids),
    onSuccess: (res) => {
      pushToast(`Approved ${res.updated} booking(s)`, "success");
      refresh();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const busy = approve.isPending || reject.isPending || bulk.isPending;

  const pageIds = page.items.map((r) => r.bookingId);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleAll = () =>
    setSelected((prev) => {
      if (allSelected) return new Set();
      const next = new Set(prev);
      for (const id of pageIds) next.add(id);
      return next;
    });

  const columns: Array<Column<BookingLedgerEntry>> = [
    {
      header: "Select",
      cell: (r) => (
        <Checkbox size="small" checked={selected.has(r.bookingId)} onChange={() => toggle(r.bookingId)} />
      ),
    },
    { header: "Booking", cell: (r) => short(r.bookingId) },
    { header: "Tenant", cell: (r) => r.tenantName },
    { header: "Property", cell: (r) => r.listingAlias },
    { header: "Agent", cell: (r) => r.agentName ?? "—" },
    { header: "Monthly rent", cell: (r) => formatPaise(r.monthlyRentPaise) },
    { header: "Token", cell: (r) => formatPaise(r.tokenAmountPaise) },
    { header: "Created", cell: (r) => new Date(r.createdAt).toLocaleDateString() },
    {
      header: "Actions",
      cell: (r) => (
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" onClick={() => setOpenId(r.bookingId)}>
            Review
          </Button>
          <Button size="small" variant="contained" disabled={busy} onClick={() => approve.mutate(r.bookingId)}>
            Approve
          </Button>
          <Button
            size="small"
            color="error"
            disabled={busy}
            onClick={() => {
              const reason = window.prompt("Reason for rejection?");
              if (reason) reject.mutate({ id: r.bookingId, reason });
            }}
          >
            Reject
          </Button>
        </Stack>
      ),
    },
  ];

  return (
    <>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h4">Approvals</Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={toggleAll} disabled={pageIds.length === 0}>
            {allSelected ? "Clear page" : "Select page"}
          </Button>
          <Button
            variant="contained"
            disabled={selected.size === 0 || busy}
            onClick={() => bulk.mutate([...selected])}
          >
            Approve selected ({selected.size})
          </Button>
        </Stack>
      </Stack>

      <CursorTable
        columns={columns}
        rows={page.items}
        getRowKey={(r) => r.bookingId}
        loading={page.isFetching}
        hasNext={page.hasNext}
        hasPrev={page.hasPrev}
        onNext={page.next}
        onPrev={page.prev}
        emptyMessage="No bookings awaiting approval"
      />

      {openId && (
        <BookingDetailDialog bookingId={openId} onClose={() => setOpenId(null)} onChanged={refresh} />
      )}
    </>
  );
}
