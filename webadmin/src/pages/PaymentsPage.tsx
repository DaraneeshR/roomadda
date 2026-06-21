import { useState } from "react";
import { Chip, MenuItem, TextField, Typography } from "@mui/material";
import { PAYMENT_STATUSES, formatPaise, type PaymentItem } from "@roomadda/shared";
import { adminApi } from "../api/admin";
import { CursorTable, type Column } from "../components/CursorTable";
import { usePaginatedQuery } from "../components/usePaginatedQuery";

const short = (id: string): string => id.slice(0, 8);

export function PaymentsPage() {
  const [status, setStatus] = useState<string>("");
  const key = ["admin", "payments", status];
  const page = usePaginatedQuery<PaymentItem>(key, (cursor, limit) =>
    adminApi.searchPayments(cursor, limit, status || undefined),
  );

  const columns: Array<Column<PaymentItem>> = [
    { header: "Payment", cell: (r) => short(r.id) },
    { header: "Booking", cell: (r) => short(r.bookingId) },
    { header: "Amount", cell: (r) => formatPaise(r.amountPaise) },
    { header: "Status", cell: (r) => <Chip size="small" label={r.status} /> },
    { header: "Method", cell: (r) => r.method },
    { header: "Order", cell: (r) => r.razorpayOrderId ?? "—" },
    { header: "Created", cell: (r) => new Date(r.createdAt).toLocaleDateString() },
  ];

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Payments
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
        {PAYMENT_STATUSES.map((s) => (
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
        emptyMessage="No payments"
      />
    </>
  );
}
