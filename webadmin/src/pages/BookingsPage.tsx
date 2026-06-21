import { useState } from "react";
import { Chip, MenuItem, TextField, Typography } from "@mui/material";
import { BOOKING_STATUSES, formatPaise, type BookingItem } from "@roomadda/shared";
import { adminApi } from "../api/admin";
import { CursorTable, type Column } from "../components/CursorTable";
import { usePaginatedQuery } from "../components/usePaginatedQuery";

const short = (id: string): string => id.slice(0, 8);

export function BookingsPage() {
  const [status, setStatus] = useState<string>("");
  const key = ["admin", "bookings", status];
  const page = usePaginatedQuery<BookingItem>(key, (cursor, limit) =>
    adminApi.searchBookings(cursor, limit, status || undefined),
  );

  const columns: Array<Column<BookingItem>> = [
    { header: "Booking", cell: (r) => short(r.id) },
    { header: "Status", cell: (r) => <Chip size="small" label={r.status} /> },
    { header: "Listing", cell: (r) => short(r.listingId) },
    { header: "Tenant", cell: (r) => short(r.tenantId) },
    { header: "Token", cell: (r) => formatPaise(r.tokenAmountPaise) },
    { header: "Confirmed", cell: (r) => (r.confirmedAt ? new Date(r.confirmedAt).toLocaleString() : "—") },
    { header: "Created", cell: (r) => new Date(r.createdAt).toLocaleDateString() },
  ];

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Bookings
      </Typography>
      <TextField
        select
        size="small"
        label="Status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        sx={{ mb: 2, width: 220 }}
      >
        <MenuItem value="">All</MenuItem>
        {BOOKING_STATUSES.map((s) => (
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
        emptyMessage="No bookings"
      />
    </>
  );
}
