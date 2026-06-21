import { Button, Chip, Stack, Typography } from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { KycReviewItem } from "@roomadda/shared";
import { adminApi } from "../api/admin";
import { CursorTable, type Column } from "../components/CursorTable";
import { usePaginatedQuery } from "../components/usePaginatedQuery";
import { pushToast } from "../lib/toastBus";

const KEY = ["admin", "kyc"];

export function KycReviewPage() {
  const qc = useQueryClient();
  const page = usePaginatedQuery<KycReviewItem>(KEY, (cursor, limit) => adminApi.listKyc(cursor, limit, "PENDING"));

  const invalidate = () => void qc.invalidateQueries({ queryKey: KEY });
  const approve = useMutation({
    mutationFn: (id: string) => adminApi.approveKyc(id),
    onSuccess: () => {
      pushToast("KYC approved", "success");
      invalidate();
    },
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminApi.rejectKyc(id, reason),
    onSuccess: () => {
      pushToast("KYC rejected", "success");
      invalidate();
    },
  });

  const columns: Array<Column<KycReviewItem>> = [
    { header: "User", cell: (r) => `${r.user.fullName} · ${r.user.phone}` },
    { header: "Role", cell: (r) => r.user.role },
    { header: "Document", cell: (r) => r.docType },
    { header: "Status", cell: (r) => <Chip size="small" label={r.status} /> },
    { header: "Requested", cell: (r) => new Date(r.createdAt).toLocaleString() },
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
        KYC review
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
        emptyMessage="No pending KYC records"
      />
    </>
  );
}
