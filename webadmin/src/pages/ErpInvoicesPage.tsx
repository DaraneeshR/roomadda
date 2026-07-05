import { useState } from "react";
import {
  Button,
  Checkbox,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { INVOICE_STATUSES, type InvoiceListEntry, type InvoiceStatus, type InvoiceType } from "@roomadda/shared";
import { erpApi, type InvoiceFilter } from "../api/erp";
import { CursorTable, type Column } from "../components/CursorTable";
import { usePaginatedQuery } from "../components/usePaginatedQuery";
import { InvoiceReviewDialog } from "../components/erp/InvoiceReviewDialog";
import { formatSignedPaise } from "../lib/money";
import { pushToast } from "../lib/toastBus";

const short = (id: string): string => id.slice(0, 8);

/**
 * Invoice Center (§15.6/§15.7). Two invoices come off one booking — CUSTOMER and
 * COMMISSION — both engine-priced. This is the list; "Review" opens the invoice
 * where the manual figures are edited (engine lines stay display-only) and PDF /
 * send / mark-sent / "Comm" happen. Money is engine-sourced integer paise.
 */
export function ErpInvoicesPage() {
  const qc = useQueryClient();
  const [type, setType] = useState<InvoiceType>("CUSTOMER");
  const [status, setStatus] = useState<"" | InvoiceStatus>("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filter: InvoiceFilter = { type, status: status || undefined, q: q || undefined };
  const KEY = ["erp", "invoices", filter];
  const page = usePaginatedQuery<InvoiceListEntry>(KEY, (cursor, limit) => erpApi.listInvoices(filter, cursor, limit));
  const refresh = () => {
    setSelected(new Set());
    void qc.invalidateQueries({ queryKey: ["erp", "invoices"] });
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pageIds = page.items.map((r) => r.bookingId);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const bulkSend = useMutation({
    mutationFn: (ids: string[]) => erpApi.bulkSendInvoices(type, ids),
    onSuccess: (res) => {
      pushToast(`Sent ${res.sent} invoice(s)`, "success");
      refresh();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });

  const columns: Array<Column<InvoiceListEntry>> = [
    {
      header: "Select",
      cell: (r) => <Checkbox size="small" checked={selected.has(r.bookingId)} onChange={() => toggle(r.bookingId)} />,
    },
    { header: "Recipient", cell: (r) => r.recipientName },
    { header: "Number", cell: (r) => r.recipientPhone },
    { header: "Property", cell: (r) => r.listingAlias },
    { header: "Total", cell: (r) => formatSignedPaise(r.totalPaise) },
    { header: "Balance", cell: (r) => formatSignedPaise(r.balancePaise) },
    { header: "Status", cell: (r) => r.status },
    { header: "Sent", cell: (r) => (r.sentAt ? new Date(r.sentAt).toLocaleDateString() : "—") },
    { header: "Booking", cell: (r) => short(r.bookingId) },
    {
      header: "",
      cell: (r) => (
        <Button size="small" variant="outlined" onClick={() => setOpen(r.bookingId)}>
          Review
        </Button>
      ),
    },
  ];

  return (
    <>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h4">Invoice center</Typography>
        <Button
          variant="contained"
          disabled={selected.size === 0 || bulkSend.isPending}
          onClick={() => bulkSend.mutate([...selected])}
        >
          Send selected ({selected.size})
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
          <ToggleButtonGroup
            size="small"
            exclusive
            value={type}
            onChange={(_, v: InvoiceType | null) => v && setType(v)}
          >
            <ToggleButton value="CUSTOMER">Customer</ToggleButton>
            <ToggleButton value="COMMISSION">Commission</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            select
            size="small"
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | InvoiceStatus)}
            sx={{ width: 150 }}
          >
            <MenuItem value="">All</MenuItem>
            {INVOICE_STATUSES.map((s) => (
              <MenuItem key={s} value={s}>
                {s}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Search recipient / property"
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
          <Button
            size="small"
            disabled={pageIds.length === 0}
            onClick={() => setSelected(allSelected ? new Set() : new Set(pageIds))}
          >
            {allSelected ? "Clear page" : "Select page"}
          </Button>
        </Stack>
      </Paper>

      <CursorTable
        columns={columns}
        rows={page.items}
        getRowKey={(r) => r.bookingId}
        loading={page.isFetching}
        hasNext={page.hasNext}
        hasPrev={page.hasPrev}
        onNext={page.next}
        onPrev={page.prev}
        emptyMessage="No invoices"
      />

      {open && (
        <InvoiceReviewDialog bookingId={open} type={type} onClose={() => setOpen(null)} onChanged={refresh} />
      )}
    </>
  );
}
