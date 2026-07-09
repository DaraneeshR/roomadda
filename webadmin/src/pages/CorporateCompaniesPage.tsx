import { useState } from "react";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CorporateCompany } from "@roomadda/shared";
import { corporateApi } from "../api/corporate";
import { CursorTable, type Column } from "../components/CursorTable";
import { usePaginatedQuery } from "../components/usePaginatedQuery";
import { pushToast } from "../lib/toastBus";

/** Corporate → Companies (§15.3 corporate). Directory + account-manager assignment.
 *  Every mutation is audited server-side. */
export function CorporateCompaniesPage() {
  const qc = useQueryClient();
  const KEY = ["corporate", "companies"];
  const page = usePaginatedQuery<CorporateCompany>(KEY, (cursor, limit) => corporateApi.listCompanies(cursor, limit));
  const invalidate = () => void qc.invalidateQueries({ queryKey: KEY });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", gstin: "", billingMode: "CREDIT" as "CREDIT" | "PREPAY", creditDays: 30 });

  const create = useMutation({
    mutationFn: () =>
      corporateApi.createCompany({
        name: form.name,
        gstin: form.gstin || undefined,
        billingMode: form.billingMode,
        creditDays: form.creditDays,
      }),
    onSuccess: () => {
      pushToast("Company created", "success");
      setOpen(false);
      setForm({ name: "", gstin: "", billingMode: "CREDIT", creditDays: 30 });
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });

  const assign = useMutation({
    mutationFn: ({ id, managerId }: { id: string; managerId: string | null }) => corporateApi.assignAccountManager(id, managerId),
    onSuccess: () => {
      pushToast("Account manager updated", "success");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });

  const columns: Array<Column<CorporateCompany>> = [
    { header: "Company", cell: (r) => r.name },
    { header: "GSTIN", cell: (r) => r.gstin ?? "—" },
    { header: "Billing", cell: (r) => <Chip size="small" label={r.billingMode === "CREDIT" ? `Credit ${r.creditDays}d` : "Prepaid"} /> },
    { header: "Status", cell: (r) => <Chip size="small" color={r.status === "ACTIVE" ? "success" : "warning"} label={r.status} /> },
    { header: "Account manager", cell: (r) => r.accountManagerId ?? "—" },
    {
      header: "Actions",
      cell: (r) => (
        <Button
          size="small"
          onClick={() => {
            const managerId = window.prompt("Account manager user id (blank to clear):", r.accountManagerId ?? "");
            if (managerId !== null) assign.mutate({ id: r.id, managerId: managerId.trim() || null });
          }}
        >
          Assign manager
        </Button>
      ),
    },
  ];

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">Companies</Typography>
        <Button variant="contained" onClick={() => setOpen(true)}>
          New company
        </Button>
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
        emptyMessage="No companies yet"
      />

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New company</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <TextField label="GSTIN (optional)" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
            <TextField
              select
              label="Billing mode"
              value={form.billingMode}
              onChange={(e) => setForm({ ...form, billingMode: e.target.value as "CREDIT" | "PREPAY" })}
            >
              <MenuItem value="CREDIT">Credit (net days)</MenuItem>
              <MenuItem value="PREPAY">Prepaid (webhook-settled)</MenuItem>
            </TextField>
            {form.billingMode === "CREDIT" ? (
              <TextField
                type="number"
                label="Credit days"
                value={form.creditDays}
                onChange={(e) => setForm({ ...form, creditDays: Number(e.target.value) })}
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!form.name || create.isPending} onClick={() => create.mutate()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
