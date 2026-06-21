import { Button, Typography } from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatPaise, type CashInHandItem, type CashQueueItem } from "@roomadda/shared";
import { adminApi } from "../api/admin";
import { CursorTable, type Column } from "../components/CursorTable";
import { usePaginatedQuery } from "../components/usePaginatedQuery";
import { pushToast } from "../lib/toastBus";

export function CashReconciliationPage() {
  const qc = useQueryClient();
  const inHand = usePaginatedQuery<CashInHandItem>(["admin", "cash-in-hand"], (c, l) => adminApi.cashInHand(c, l));
  const queue = usePaginatedQuery<CashQueueItem>(["admin", "cash-queue"], (c, l) => adminApi.reconciliationQueue(c, l));

  const reconcile = useMutation({
    mutationFn: (id: string) => adminApi.reconcile(id),
    onSuccess: () => {
      pushToast("Cash reconciled", "success");
      void qc.invalidateQueries({ queryKey: ["admin", "cash-queue"] });
      void qc.invalidateQueries({ queryKey: ["admin", "cash-in-hand"] });
    },
  });

  const inHandCols: Array<Column<CashInHandItem>> = [
    { header: "Agent", cell: (r) => (r.agentName ? `${r.agentName} · ${r.agentPhone ?? ""}` : r.agentId.slice(0, 8)) },
    { header: "Cash in hand", cell: (r) => formatPaise(r.cashInHandPaise) },
  ];

  const queueCols: Array<Column<CashQueueItem>> = [
    { header: "Collection", cell: (r) => r.id.slice(0, 8) },
    { header: "Agent", cell: (r) => `${r.agent.fullName} · ${r.agent.phone}` },
    { header: "Booking", cell: (r) => r.booking.id.slice(0, 8) },
    { header: "Amount", cell: (r) => formatPaise(r.amountPaise) },
    { header: "Collected", cell: (r) => (r.collectedAt ? new Date(r.collectedAt).toLocaleString() : "—") },
    {
      header: "Actions",
      cell: (r) => (
        <Button size="small" variant="contained" disabled={reconcile.isPending} onClick={() => reconcile.mutate(r.id)}>
          Reconcile
        </Button>
      ),
    },
  ];

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Cash reconciliation
      </Typography>

      <Typography variant="h6" sx={{ mb: 1 }}>
        Cash in hand (by agent)
      </Typography>
      <CursorTable
        columns={inHandCols}
        rows={inHand.items}
        getRowKey={(r) => r.agentId}
        loading={inHand.isFetching}
        hasNext={inHand.hasNext}
        hasPrev={inHand.hasPrev}
        onNext={inHand.next}
        onPrev={inHand.prev}
        emptyMessage="No outstanding cash"
      />

      <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>
        Reconciliation queue (collected)
      </Typography>
      <CursorTable
        columns={queueCols}
        rows={queue.items}
        getRowKey={(r) => r.id}
        loading={queue.isFetching}
        hasNext={queue.hasNext}
        hasPrev={queue.hasPrev}
        onNext={queue.next}
        onPrev={queue.prev}
        emptyMessage="Nothing to reconcile"
      />
    </>
  );
}
