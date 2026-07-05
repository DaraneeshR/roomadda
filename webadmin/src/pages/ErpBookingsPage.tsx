import { useState } from "react";
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  BOOKING_APPROVAL_STATUSES,
  formatPaise,
  type BookingApprovalStatus,
  type BookingLedgerEntry,
  type BookingLedgerResponse,
  type BookingLedgerSort,
  type BookingLedgerTotals,
} from "@roomadda/shared";
import { erpApi, type LedgerFilter } from "../api/erp";
import { CursorTable, type Column } from "../components/CursorTable";
import { usePaginatedQuery } from "../components/usePaginatedQuery";
import { AddHistoricalBookingDialog } from "../components/erp/AddHistoricalBookingDialog";
import { BookingDetailDialog } from "../components/erp/BookingDetailDialog";
import { formatSignedPaise } from "../lib/money";
import { pushToast } from "../lib/toastBus";

const short = (id: string): string => id.slice(0, 8);

const approvalColor: Record<BookingApprovalStatus, "warning" | "success" | "error" | "default"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "error",
  CANCELLED: "default",
};

const SORTS: Array<{ value: BookingLedgerSort; label: string }> = [
  { value: "createdAt", label: "Created" },
  { value: "confirmedAt", label: "Confirmed" },
  { value: "moveInDate", label: "Move-in" },
  { value: "monthlyRent", label: "Monthly rent" },
];

/**
 * Bookings Ledger (§15.3). Every booking, engine-priced per row, with the same
 * filter surface the export uses. The roll-up totals come straight from the API
 * response (Σ over the WHOLE filtered set, not just the page) so what's shown can
 * never disagree with the ledger. Row → the shared booking/KYC detail.
 */
export function ErpBookingsPage() {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [approval, setApproval] = useState<"" | BookingApprovalStatus>("");
  const [sort, setSort] = useState<BookingLedgerSort>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [openId, setOpenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const filter: LedgerFilter = {
    q: q || undefined,
    approval: approval || undefined,
    sort,
    order,
  };

  const key = ["erp", "bookings", filter];
  const page = usePaginatedQuery<BookingLedgerEntry, BookingLedgerResponse>(key, (cursor, limit) =>
    erpApi.bookingsLedger(filter, cursor, limit),
  );
  const totals = page.data?.totals;

  const [exporting, setExporting] = useState(false);
  const doExport = async (format: "csv" | "xlsx") => {
    setExporting(true);
    try {
      await erpApi.exportBookings(filter, format);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Export failed", "error");
    } finally {
      setExporting(false);
    }
  };

  const columns: Array<Column<BookingLedgerEntry>> = [
    { header: "Booking", cell: (r) => short(r.bookingId) },
    {
      header: "Approval",
      cell: (r) => (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Chip size="small" color={approvalColor[r.approval]} label={r.approval} />
          {r.historical && <Chip size="small" variant="outlined" label="HIST" />}
        </Stack>
      ),
    },
    { header: "Tenant", cell: (r) => r.tenantName },
    { header: "Property", cell: (r) => r.listingAlias },
    { header: "Agent", cell: (r) => r.agentName ?? "—" },
    { header: "Monthly rent", cell: (r) => formatPaise(r.monthlyRentPaise) },
    { header: "Commission", cell: (r) => (r.commission ? formatPaise(r.commission.commissionPaise) : "—") },
    { header: "Net", cell: (r) => (r.commission ? formatSignedPaise(r.commission.netPaise) : "—") },
    { header: "Created", cell: (r) => new Date(r.createdAt).toLocaleDateString() },
    {
      header: "",
      cell: (r) => (
        <Button size="small" variant="outlined" onClick={() => setOpenId(r.bookingId)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h4">Bookings ledger</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" disabled={exporting} onClick={() => void doExport("csv")}>
            Export CSV
          </Button>
          <Button variant="outlined" disabled={exporting} onClick={() => void doExport("xlsx")}>
            Export Excel
          </Button>
          <Button variant="contained" onClick={() => setAddOpen(true)}>
            Add historical booking
          </Button>
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
          <TextField
            size="small"
            label="Search tenant / property"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setQ(search.trim());
            }}
            sx={{ width: 260 }}
          />
          <Button size="small" onClick={() => setQ(search.trim())}>
            Search
          </Button>
          <TextField
            select
            size="small"
            label="Approval"
            value={approval}
            onChange={(e) => setApproval(e.target.value as "" | BookingApprovalStatus)}
            sx={{ width: 160 }}
          >
            <MenuItem value="">All</MenuItem>
            {BOOKING_APPROVAL_STATUSES.map((s) => (
              <MenuItem key={s} value={s}>
                {s}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Sort by"
            value={sort}
            onChange={(e) => setSort(e.target.value as BookingLedgerSort)}
            sx={{ width: 160 }}
          >
            {SORTS.map((s) => (
              <MenuItem key={s.value} value={s.value}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Order"
            value={order}
            onChange={(e) => setOrder(e.target.value as "asc" | "desc")}
            sx={{ width: 140 }}
          >
            <MenuItem value="desc">Newest first</MenuItem>
            <MenuItem value="asc">Oldest first</MenuItem>
          </TextField>
        </Stack>
      </Paper>

      {totals && <LedgerTotals totals={totals} />}

      <CursorTable
        columns={columns}
        rows={page.items}
        getRowKey={(r) => r.bookingId}
        loading={page.isFetching}
        hasNext={page.hasNext}
        hasPrev={page.hasPrev}
        onNext={page.next}
        onPrev={page.prev}
        emptyMessage="No bookings"
      />

      {openId && (
        <BookingDetailDialog bookingId={openId} onClose={() => setOpenId(null)} onChanged={() => void page.refetch()} />
      )}
      {addOpen && (
        <AddHistoricalBookingDialog onClose={() => setAddOpen(false)} onDone={() => void page.refetch()} />
      )}
    </>
  );
}

/** The Σ-over-filtered-set roll-up, straight from the API (never recomputed here). */
function LedgerTotals({ totals }: { totals: BookingLedgerTotals }) {
  const cells: Array<{ label: string; value: string }> = [
    { label: "Bookings", value: String(totals.bookingCount) },
    { label: "Pending", value: String(totals.pendingCount) },
    { label: "Approved", value: String(totals.approvedCount) },
    { label: "Commissioned", value: String(totals.commissionedBookingCount) },
    { label: "Commission", value: formatPaise(totals.commissionPaise) },
    { label: "Collected", value: formatPaise(totals.collectedPaise) },
    { label: "Paid to PG", value: formatPaise(totals.paidToPgPaise) },
    { label: "Net", value: formatSignedPaise(totals.netPaise) },
  ];
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mb: 2 }}>
      {cells.map((c) => (
        <Paper key={c.label} variant="outlined" sx={{ px: 2, py: 1, minWidth: 120, flex: "1 1 120px" }}>
          <Typography variant="caption" color="text.secondary">
            {c.label}
          </Typography>
          <Typography variant="h6" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {c.value}
          </Typography>
        </Paper>
      ))}
    </Box>
  );
}
