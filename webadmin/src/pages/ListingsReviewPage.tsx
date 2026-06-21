import { useState } from "react";
import { Button, Chip, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LISTING_STATUSES, type ListingReviewItem, type ListingStatus } from "@roomadda/shared";
import { adminApi } from "../api/admin";
import { CursorTable, type Column } from "../components/CursorTable";
import { usePaginatedQuery } from "../components/usePaginatedQuery";
import { pushToast } from "../lib/toastBus";

export function ListingsReviewPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<ListingStatus>("PENDING_REVIEW");
  const key = ["admin", "listings", status];
  const page = usePaginatedQuery<ListingReviewItem>(key, (cursor, limit) => adminApi.listListings(cursor, limit, status));

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin", "listings"] });
  const publish = useMutation({
    mutationFn: (id: string) => adminApi.publishListing(id),
    onSuccess: () => {
      pushToast("Listing published", "success");
      invalidate();
    },
  });
  const suspend = useMutation({
    mutationFn: (id: string) => adminApi.suspendListing(id),
    onSuccess: () => {
      pushToast("Listing suspended", "success");
      invalidate();
    },
  });

  const columns: Array<Column<ListingReviewItem>> = [
    { header: "Alias", cell: (r) => r.alias },
    { header: "Actual name", cell: (r) => r.actualName },
    { header: "City", cell: (r) => r.city },
    { header: "Status", cell: (r) => <Chip size="small" label={r.status} /> },
    { header: "Created", cell: (r) => new Date(r.createdAt).toLocaleDateString() },
    {
      header: "Actions",
      cell: (r) => (
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" disabled={publish.isPending} onClick={() => publish.mutate(r.id)}>
            Publish
          </Button>
          <Button size="small" color="error" disabled={suspend.isPending} onClick={() => suspend.mutate(r.id)}>
            Suspend
          </Button>
        </Stack>
      ),
    },
  ];

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Listings review
      </Typography>
      <TextField
        select
        size="small"
        label="Status"
        value={status}
        onChange={(e) => setStatus(e.target.value as ListingStatus)}
        sx={{ mb: 2, width: 220 }}
      >
        {LISTING_STATUSES.map((s) => (
          <MenuItem key={s} value={s}>
            {s}
          </MenuItem>
        ))}
      </TextField>
      <CursorTable
        columns={columns}
        rows={page.items}
        getRowKey={(r) => r.id}
        loading={page.isFetching}
        hasNext={page.hasNext}
        hasPrev={page.hasPrev}
        onNext={page.next}
        onPrev={page.prev}
        emptyMessage="No listings"
      />
    </>
  );
}
