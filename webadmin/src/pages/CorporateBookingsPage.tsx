import {
  Button,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatPaise, type CorporateBooking } from "@roomadda/shared";
import { corporateApi } from "../api/corporate";
import { CursorTable, type Column } from "../components/CursorTable";
import { usePaginatedQuery } from "../components/usePaginatedQuery";
import { pushToast } from "../lib/toastBus";

const TONE: Record<string, "success" | "warning" | "error" | "default"> = {
  CONFIRMED: "success",
  PENDING: "warning",
  CANCELLED: "error",
  COMPLETED: "default",
};

/** Corporate → Bookings (§15.3). CRM confirm (CREDIT/MVP path) + generate the
 *  company invoice. Money is engine-sourced; both actions are audited server-side. */
export function CorporateBookingsPage() {
  const qc = useQueryClient();
  const KEY = ["corporate", "bookings"];
  const page = usePaginatedQuery<CorporateBooking>(KEY, (cursor, limit) => corporateApi.listBookings(undefined, cursor, limit));
  const invalidate = () => void qc.invalidateQueries({ queryKey: KEY });

  const confirm = useMutation({
    mutationFn: (id: string) => corporateApi.confirmBooking(id),
    onSuccess: () => {
      pushToast("Booking confirmed", "success");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const invoice = useMutation({
    mutationFn: (id: string) => corporateApi.generateInvoice(id),
    onSuccess: () => pushToast("Invoice generated", "success"),
    onError: (e: Error) => pushToast(e.message, "error"),
  });

  const columns: Array<Column<CorporateBooking>> = [
    { header: "Booking", cell: (r) => r.id.slice(0, 8) },
    { header: "Total", cell: (r) => formatPaise(r.totalPaise) },
    { header: "Rooms", cell: (r) => `${r.reservations.length} (${r.allocations.filter((a) => a.status === "ALLOCATED").length} allocated)` },
    { header: "Status", cell: (r) => <Chip size="small" color={TONE[r.status] ?? "default"} label={r.status} /> },
    {
      header: "Actions",
      cell: (r) => (
        <Stack direction="row" spacing={1}>
          {r.status === "PENDING" ? (
            <Button size="small" variant="outlined" onClick={() => confirm.mutate(r.id)}>
              Confirm
            </Button>
          ) : null}
          <Button size="small" onClick={() => invoice.mutate(r.id)}>
            Generate invoice
          </Button>
        </Stack>
      ),
    },
  ];

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Corporate bookings</Typography>
      <CursorTable
        columns={columns}
        rows={page.items}
        getRowKey={(r) => r.id}
        loading={page.isFetching}
        hasNext={page.hasNext}
        hasPrev={page.hasPrev}
        onNext={page.next}
        onPrev={page.prev}
        emptyMessage="No corporate bookings yet"
      />
    </Stack>
  );
}
