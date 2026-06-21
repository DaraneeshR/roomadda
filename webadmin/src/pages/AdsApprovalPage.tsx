import { Button, Chip, Stack, Typography } from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatPaise, type AdPendingItem } from "@roomadda/shared";
import { adminApi } from "../api/admin";
import { CursorTable, type Column } from "../components/CursorTable";
import { usePaginatedQuery } from "../components/usePaginatedQuery";
import { pushToast } from "../lib/toastBus";

const KEY = ["admin", "ads-pending"];

export function AdsApprovalPage() {
  const qc = useQueryClient();
  const page = usePaginatedQuery<AdPendingItem>(KEY, (cursor, limit) => adminApi.pendingAds(cursor, limit));
  const invalidate = () => void qc.invalidateQueries({ queryKey: KEY });

  const approve = useMutation({
    mutationFn: (id: string) => adminApi.approveAd(id),
    onSuccess: () => {
      pushToast("Ad approved", "success");
      invalidate();
    },
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminApi.rejectAd(id, reason),
    onSuccess: () => {
      pushToast("Ad rejected", "success");
      invalidate();
    },
  });

  const columns: Array<Column<AdPendingItem>> = [
    { header: "Listing", cell: (r) => `${r.listing.alias} · ${r.listing.city}` },
    { header: "Slot", cell: (r) => r.slotType },
    {
      header: "Window",
      cell: (r) => `${new Date(r.startDate).toLocaleDateString()} – ${new Date(r.endDate).toLocaleDateString()}`,
    },
    { header: "Price", cell: (r) => formatPaise(r.pricePaise) },
    { header: "Status", cell: (r) => <Chip size="small" label={r.status} /> },
    {
      header: "Actions",
      cell: (r) => (
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" disabled={approve.isPending} onClick={() => approve.mutate(r.id)}>
            Approve
          </Button>
          <Button
            size="small"
            color="error"
            disabled={reject.isPending}
            onClick={() => {
              const reason = window.prompt("Reason for rejection?");
              if (reason) reject.mutate({ id: r.id, reason });
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
      <Typography variant="h4" gutterBottom>
        Ads approval
      </Typography>
      <CursorTable
        columns={columns}
        rows={page.items}
        getRowKey={(r) => r.id}
        loading={page.isFetching}
        hasNext={page.hasNext}
        hasPrev={page.hasPrev}
        onNext={page.next}
        onPrev={page.prev}
        emptyMessage="No ads awaiting approval"
      />
    </>
  );
}
