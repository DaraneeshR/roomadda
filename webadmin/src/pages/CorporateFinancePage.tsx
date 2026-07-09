import { Button, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatPaise, type CorporateInvoice } from "@roomadda/shared";
import { corporateApi } from "../api/corporate";
import { CursorTable, type Column } from "../components/CursorTable";
import { usePaginatedQuery } from "../components/usePaginatedQuery";
import { pushToast } from "../lib/toastBus";

const TONE: Record<string, "success" | "warning" | "error"> = { PAID: "success", DUE: "warning", OVERDUE: "error" };

/** Corporate → Finance (§15.3 corporate). Receivables roll-up + invoices, reusing
 *  the engine-sourced money. OFFLINE settle (bank transfer) is admin-marked +
 *  audited; ONLINE payments settle only via the verified webhook (never here). */
export function CorporateFinancePage() {
  const qc = useQueryClient();
  const KEY = ["corporate", "invoices"];
  const summary = useQuery({ queryKey: ["corporate", "finance"], queryFn: () => corporateApi.financeSummary() });
  const page = usePaginatedQuery<CorporateInvoice>(KEY, (cursor, limit) => corporateApi.listInvoices(undefined, cursor, limit));

  const settle = useMutation({
    mutationFn: ({ id, ref }: { id: string; ref: string }) => corporateApi.settleOffline(id, { settlementRef: ref }),
    onSuccess: () => {
      pushToast("Invoice settled (offline)", "success");
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ["corporate", "finance"] });
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });

  const s = summary.data?.summary;
  const stats: { label: string; value: string }[] = s
    ? [
        { label: "Invoiced", value: formatPaise(s.invoicedPaise) },
        { label: "Collected", value: formatPaise(s.collectedPaise) },
        { label: "Outstanding", value: formatPaise(s.outstandingPaise) },
        { label: "Overdue", value: String(s.overdueCount) },
      ]
    : [];

  const columns: Array<Column<CorporateInvoice>> = [
    { header: "Invoice", cell: (r) => r.id.slice(0, 8) },
    { header: "Total", cell: (r) => formatPaise(r.totalPaise) },
    { header: "Balance", cell: (r) => formatPaise(r.balancePaise) },
    { header: "Terms", cell: (r) => (r.billingMode === "CREDIT" ? "Credit" : "Prepaid") },
    { header: "Due", cell: (r) => r.dueDate?.slice(0, 10) ?? "—" },
    { header: "Status", cell: (r) => <Chip size="small" color={TONE[r.status] ?? "warning"} label={r.status} /> },
    {
      header: "Actions",
      cell: (r) =>
        r.status !== "PAID" ? (
          <Button
            size="small"
            onClick={() => {
              const ref = window.prompt("Settlement reference (NEFT/cheque no.):", "");
              if (ref && ref.trim()) settle.mutate({ id: r.id, ref: ref.trim() });
            }}
          >
            Settle offline
          </Button>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Corporate finance</Typography>
      <Stack direction="row" spacing={2} flexWrap="wrap">
        {stats.map((st) => (
          <Card key={st.label} variant="outlined" sx={{ minWidth: 160 }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary">
                {st.label}
              </Typography>
              <Typography variant="h6">{st.value}</Typography>
            </CardContent>
          </Card>
        ))}
      </Stack>
      <CursorTable
        columns={columns}
        rows={page.items}
        getRowKey={(r) => r.id}
        loading={page.isFetching}
        hasNext={page.hasNext}
        hasPrev={page.hasPrev}
        onNext={page.next}
        onPrev={page.prev}
        emptyMessage="No invoices yet"
      />
    </Stack>
  );
}
