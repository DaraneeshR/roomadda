import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  paiseToRupees,
  rupeesToPaise,
  type Invoice,
  type InvoiceLineItem,
  type InvoiceType,
} from "@roomadda/shared";
import { erpApi } from "../../api/erp";
import { formatSignedPaise } from "../../lib/money";
import { pushToast } from "../../lib/toastBus";

interface Props {
  bookingId: string;
  type: InvoiceType;
  onClose: () => void;
  /** Called after any change (edit/send/mark-sent) so the parent list can refetch. */
  onChanged?: () => void;
}

const lineAmount = (inv: Invoice, code: string): number =>
  inv.lineItems.find((l) => l.code === code)?.amountPaise ?? 0;

/**
 * Review / edit ONE invoice (§15.7). Only a CUSTOMER invoice's NON-DERIVABLE
 * figures are editable — maintenance, electricity, and the amount-paid override;
 * the ENGINE lines (deposit, pro-rata rent, commission, net, …) render display-only
 * with NO input, so an edit can never touch an engine figure. On save the SERVER
 * recomputes and returns the authoritative invoice — the balance is never summed
 * here (see /CLAUDE.md money rule). PDF / send / mark-sent / "Comm" live here too.
 */
export function InvoiceReviewDialog({ bookingId, type, onClose, onChanged }: Props) {
  const qc = useQueryClient();
  const key = ["erp", "invoice", bookingId, type];
  const q = useQuery({ queryKey: key, queryFn: () => erpApi.reviewInvoice(bookingId, type) });
  const invoice = q.data?.invoice;
  const editable = type === "CUSTOMER";

  const [maintenance, setMaintenance] = useState("");
  const [electricity, setElectricity] = useState("");
  const [paid, setPaid] = useState("");

  // Seed the editable rupee inputs from the authoritative invoice on every (re)load.
  useEffect(() => {
    if (!invoice) return;
    setMaintenance(String(paiseToRupees(lineAmount(invoice, "MAINTENANCE"))));
    setElectricity(String(paiseToRupees(lineAmount(invoice, "ELECTRICITY"))));
    // Only a CUSTOMER invoice's paid is a non-negative override we edit.
    setPaid(editable ? String(paiseToRupees(Math.max(invoice.paidPaise, 0))) : "");
  }, [invoice, editable]);

  const onSaved = (inv: Invoice) => {
    qc.setQueryData(key, { invoice: inv }); // authoritative figures back → inputs reseed
    onChanged?.();
  };

  const save = useMutation({
    mutationFn: () =>
      erpApi.updateInvoice(bookingId, "CUSTOMER", {
        maintenancePaise: rupeesToPaise(Number(maintenance || 0)),
        electricityPaise: rupeesToPaise(Number(electricity || 0)),
        paidPaise: rupeesToPaise(Number(paid || 0)),
      }),
    onSuccess: (r) => {
      pushToast("Invoice updated", "success");
      onSaved(r.invoice);
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const send = useMutation({
    mutationFn: () => erpApi.sendInvoice(bookingId, type),
    onSuccess: (r) => {
      pushToast("Invoice sent", "success");
      onSaved(r.invoice);
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const markSent = useMutation({
    mutationFn: () => erpApi.markInvoiceSent(bookingId, type),
    onSuccess: (r) => {
      pushToast("Marked sent", "success");
      onSaved(r.invoice);
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const comm = useMutation({
    mutationFn: () => erpApi.sendCommissionInvoice(bookingId),
    onSuccess: () => {
      pushToast("Commission invoice sent to PG owner", "success");
      onChanged?.();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const busy = save.isPending || send.isPending || markSent.isPending || comm.isPending;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {type === "CUSTOMER" ? "Customer invoice" : "Commission invoice"}
        {invoice && <Chip size="small" sx={{ ml: 1 }} label={invoice.status} color={invoice.status === "SENT" ? "success" : "default"} />}
      </DialogTitle>
      <DialogContent dividers>
        {q.isLoading && <CircularProgress />}
        {q.isError && <Alert severity="error">Could not load the invoice.</Alert>}
        {invoice && (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {invoice.recipient.name} · {invoice.recipient.phone} · {invoice.listingAlias}
            </Typography>
            <Divider />

            {invoice.lineItems.map((line) => (
              <LineRow
                key={line.code}
                line={line}
                editable={editable && line.source === "MANUAL"}
                value={line.code === "MAINTENANCE" ? maintenance : line.code === "ELECTRICITY" ? electricity : ""}
                onChange={line.code === "MAINTENANCE" ? setMaintenance : line.code === "ELECTRICITY" ? setElectricity : () => {}}
              />
            ))}

            <Divider />
            <SummaryRow label="Total" value={formatSignedPaise(invoice.totalPaise)} />
            {editable ? (
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Amount paid
                </Typography>
                <TextField
                  size="small"
                  type="number"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                  sx={{ width: 140 }}
                  InputProps={{ startAdornment: <Typography sx={{ mr: 0.5 }}>₹</Typography> }}
                />
              </Stack>
            ) : (
              <SummaryRow label="Amount paid" value={formatSignedPaise(invoice.paidPaise)} />
            )}
            <SummaryRow label="Balance" value={formatSignedPaise(invoice.balancePaise)} strong />

            {editable && (
              <Button variant="contained" disabled={busy} onClick={() => save.mutate()} sx={{ alignSelf: "flex-start" }}>
                Save &amp; recompute balance
              </Button>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        <Button disabled={!invoice || busy} onClick={() => void erpApi.downloadInvoicePdf(bookingId, type)}>
          Download PDF
        </Button>
        <Button disabled={!invoice || busy} onClick={() => markSent.mutate()}>
          Mark sent
        </Button>
        <Button disabled={!invoice || busy} onClick={() => comm.mutate()}>
          Comm → PG owner
        </Button>
        <Button variant="contained" disabled={!invoice || busy} onClick={() => send.mutate()}>
          Send
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

/** One line item. ENGINE lines are display-only (NO input); a MANUAL line on an
 *  editable invoice gets a rupee input. */
function LineRow({
  line,
  editable,
  value,
  onChange,
}: {
  line: InvoiceLineItem;
  editable: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" data-testid={`invoice-line-${line.code}`}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="body2">{line.label}</Typography>
        <Chip size="small" variant="outlined" label={line.source} />
      </Stack>
      {editable ? (
        <TextField
          size="small"
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          sx={{ width: 140 }}
          inputProps={{ "aria-label": `${line.label} amount` }}
          InputProps={{ startAdornment: <Typography sx={{ mr: 0.5 }}>₹</Typography> }}
        />
      ) : (
        <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
          {formatSignedPaise(line.amountPaise)}
        </Typography>
      )}
    </Stack>
  );
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
      <Typography variant="body2" color="text.secondary" fontWeight={strong ? 700 : 400}>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={strong ? 700 : 400} sx={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
    </Box>
  );
}
