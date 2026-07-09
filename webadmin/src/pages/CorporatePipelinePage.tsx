import { useState } from "react";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatPaise, rupeesToPaise, type CorporateEnquiry, type EnquiryStatus, type Quotation } from "@roomadda/shared";
import { corporateApi } from "../api/corporate";
import { pushToast } from "../lib/toastBus";

interface LineDraft {
  categoryId: string;
  description: string;
  priceRupees: number;
  quantity: number;
  nights: number;
}

const STATUS_FILTERS: (EnquiryStatus | "ALL")[] = ["ALL", "NEW", "QUOTED", "CONVERTED", "CANCELLED"];

/** Corporate → Sales pipeline (§15.3). Enquiry queue → quotation builder →
 *  send → convert. Money in the builder is entered in rupees and converted with the
 *  sanctioned shared helper (`rupeesToPaise`); every action is audited server-side. */
export function CorporatePipelinePage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<EnquiryStatus | "ALL">("NEW");
  const [builder, setBuilder] = useState<{ enquiry: CorporateEnquiry } | null>(null);

  const enquiries = useQuery({
    queryKey: ["corporate", "pipeline", status],
    queryFn: () => corporateApi.listPipeline(status === "ALL" ? undefined : status),
  });
  const quotations = useQuery({ queryKey: ["corporate", "quotations"], queryFn: () => corporateApi.listQuotations() });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["corporate", "pipeline"] });
    void qc.invalidateQueries({ queryKey: ["corporate", "quotations"] });
  };

  const send = useMutation({
    mutationFn: (id: string) => corporateApi.sendQuotation(id),
    onSuccess: () => {
      pushToast("Quotation sent", "success");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const convert = useMutation({
    mutationFn: (id: string) => corporateApi.convertQuotation(id),
    onSuccess: () => {
      pushToast("Booking created from quotation", "success");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });

  return (
    <Stack spacing={3}>
      <Typography variant="h5">Sales pipeline</Typography>

      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle1">Enquiries</Typography>
          <TextField select size="small" value={status} onChange={(e) => setStatus(e.target.value as EnquiryStatus | "ALL")} sx={{ minWidth: 160 }}>
            {STATUS_FILTERS.map((s) => (
              <MenuItem key={s} value={s}>
                {s}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>City</TableCell>
              <TableCell>Dates</TableCell>
              <TableCell>Guests</TableCell>
              <TableCell>Status</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {(enquiries.data?.items ?? []).map((e) => (
              <TableRow key={e.id}>
                <TableCell>{e.city}</TableCell>
                <TableCell>
                  {e.checkIn.slice(0, 10)} → {e.checkOut.slice(0, 10)}
                </TableCell>
                <TableCell>{e.headcount}</TableCell>
                <TableCell>
                  <Chip size="small" label={e.status} />
                </TableCell>
                <TableCell align="right">
                  <Button size="small" variant="outlined" onClick={() => setBuilder({ enquiry: e })}>
                    Build quote
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {(enquiries.data?.items.length ?? 0) === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>No enquiries</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Stack>

      <Stack spacing={1}>
        <Typography variant="subtitle1">Quotations</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Rev</TableCell>
              <TableCell>Total</TableCell>
              <TableCell>Status</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {(quotations.data?.items ?? []).map((q) => (
              <TableRow key={q.id}>
                <TableCell>#{q.currentRevision}</TableCell>
                <TableCell>{formatPaise(currentTotal(q))}</TableCell>
                <TableCell>
                  <Chip size="small" label={q.status} />
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    {["DRAFT", "NEGOTIATING"].includes(q.status) ? (
                      <Button size="small" onClick={() => send.mutate(q.id)}>
                        Send
                      </Button>
                    ) : null}
                    {q.status === "ACCEPTED" ? (
                      <Button size="small" variant="contained" onClick={() => convert.mutate(q.id)}>
                        Convert → booking
                      </Button>
                    ) : null}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
            {(quotations.data?.items.length ?? 0) === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>No quotations</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Stack>

      {builder ? <QuotationBuilder enquiry={builder.enquiry} onClose={() => setBuilder(null)} onDone={invalidate} /> : null}
    </Stack>
  );
}

/** The in-force revision's total (engine-sourced; read, never recomputed here). */
function currentTotal(q: Quotation): number {
  const rev = q.revisions.find((r) => r.revision === q.currentRevision) ?? q.revisions[q.revisions.length - 1];
  return rev?.totalPaise ?? 0;
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
}

function QuotationBuilder({ enquiry, onClose, onDone }: { enquiry: CorporateEnquiry; onClose: () => void; onDone: () => void }) {
  const nights = nightsBetween(enquiry.checkIn, enquiry.checkOut);
  const [lines, setLines] = useState<LineDraft[]>([
    { categoryId: "", description: "Rooms", priceRupees: 0, quantity: enquiry.headcount, nights },
  ]);

  const build = useMutation({
    mutationFn: () =>
      corporateApi.buildQuotation({
        enquiryId: enquiry.id,
        taxPaise: 0,
        lineItems: lines.map((l) => ({
          categoryId: l.categoryId || undefined,
          description: l.description,
          // rupees → integer paise via the sanctioned shared helper (no ad-hoc math).
          unitPricePaise: rupeesToPaise(l.priceRupees),
          quantity: l.quantity,
          nights: l.nights,
        })),
      }),
    onSuccess: () => {
      pushToast("Quotation drafted", "success");
      onClose();
      onDone();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });

  function update(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        Build quotation · {enquiry.city} · {nights} nights
      </DialogTitle>
      <DialogContent>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Category id (optional — draws corporate rooms)</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Price/night (₹)</TableCell>
              <TableCell>Qty</TableCell>
              <TableCell>Nights</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((l, i) => (
              <TableRow key={i}>
                <TableCell>
                  <TextField size="small" value={l.categoryId} onChange={(e) => update(i, { categoryId: e.target.value })} placeholder="uuid or blank" />
                </TableCell>
                <TableCell>
                  <TextField size="small" value={l.description} onChange={(e) => update(i, { description: e.target.value })} />
                </TableCell>
                <TableCell>
                  <TextField size="small" type="number" value={l.priceRupees} onChange={(e) => update(i, { priceRupees: Number(e.target.value) })} />
                </TableCell>
                <TableCell>
                  <TextField size="small" type="number" value={l.quantity} onChange={(e) => update(i, { quantity: Number(e.target.value) })} sx={{ width: 70 }} />
                </TableCell>
                <TableCell>
                  <TextField size="small" type="number" value={l.nights} onChange={(e) => update(i, { nights: Number(e.target.value) })} sx={{ width: 70 }} />
                </TableCell>
                <TableCell>
                  <IconButton size="small" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} disabled={lines.length === 1}>
                    ×
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2 }}>
          <Button size="small" onClick={() => setLines((prev) => [...prev, { categoryId: "", description: "", priceRupees: 0, quantity: 1, nights }])}>
            + line
          </Button>
          <Typography variant="caption" color="text.secondary">
            The total is computed server-side by the money engine when the draft is created.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={build.isPending} onClick={() => build.mutate()}>
          Create draft
        </Button>
      </DialogActions>
    </Dialog>
  );
}
