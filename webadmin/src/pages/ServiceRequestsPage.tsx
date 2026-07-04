import { useState } from "react";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ServiceRequestAdminItem } from "@roomadda/shared";
import { adminApi } from "../api/admin";
import { CursorTable, type Column } from "../components/CursorTable";
import { usePaginatedQuery } from "../components/usePaginatedQuery";
import { pushToast } from "../lib/toastBus";

/**
 * Service Request Oversight & Escalations (§7.9). Lists escalated / urgent
 * requests, opens the full ticket, and lets an admin contact the host (no phone
 * sharing), resolve on the host's behalf, or flag the host for poor response.
 */
export function ServiceRequestsPage() {
  const qc = useQueryClient();
  const [escalatedOnly, setEscalatedOnly] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const KEY = ["admin", "service-requests", escalatedOnly];
  const page = usePaginatedQuery<ServiceRequestAdminItem>(KEY, (cursor, limit) =>
    adminApi.listServiceRequests(cursor, limit, escalatedOnly ? true : undefined),
  );
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin", "service-requests"] });

  const columns: Array<Column<ServiceRequestAdminItem>> = [
    { header: "Ticket", cell: (r) => r.ticketNumber },
    { header: "Category", cell: (r) => r.category },
    {
      header: "Priority",
      cell: (r) => <Chip size="small" color={r.priority === "URGENT" ? "error" : "default"} label={r.priority} />,
    },
    { header: "Status", cell: (r) => <Chip size="small" label={r.status} /> },
    { header: "Escalated", cell: (r) => (r.escalated ? <Chip size="small" color="warning" label="ESCALATED" /> : "—") },
    { header: "Tenant", cell: (r) => r.tenant.fullName },
    { header: "PG", cell: (r) => `${r.listing.alias} · ${r.listing.city}` },
    { header: "Raised", cell: (r) => new Date(r.createdAt).toLocaleDateString() },
    {
      header: "",
      cell: (r) => (
        <Button size="small" variant="outlined" onClick={() => setOpenId(r.id)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h4">Service requests</Typography>
        <FormControlLabel
          control={<Switch checked={escalatedOnly} onChange={(e) => setEscalatedOnly(e.target.checked)} />}
          label="Escalated only"
        />
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
        emptyMessage="No service requests"
      />
      {openId && <TicketDialog id={openId} onClose={() => setOpenId(null)} onChanged={invalidate} />}
    </>
  );
}

function TicketDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const detail = useQuery({
    queryKey: ["admin", "service-request", id],
    queryFn: () => adminApi.getServiceRequest(id),
  });
  const req = detail.data?.request;
  const refresh = () => {
    void detail.refetch();
    onChanged();
  };

  const resolve = useMutation({
    mutationFn: (reason: string) => adminApi.resolveServiceRequest(id, reason),
    onSuccess: () => {
      pushToast("Marked resolved", "success");
      refresh();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const contact = useMutation({
    mutationFn: (message: string) => adminApi.contactHost(id, message),
    onSuccess: () => {
      pushToast("Message sent to host", "success");
      refresh();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const flag = useMutation({
    mutationFn: (reason: string) => adminApi.flagHost(req!.host.id, reason, id),
    onSuccess: () => {
      pushToast("Host flagged", "success");
      refresh();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{req ? `${req.ticketNumber} — ${req.category}` : "Loading…"}</DialogTitle>
      <DialogContent dividers>
        {req && (
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              {req.listing.alias} · {req.listing.city} · Host: {req.host.fullName}
            </Typography>
            <Typography>{req.description}</Typography>
            <Stack direction="row" spacing={1}>
              <Chip size="small" label={req.status} />
              <Chip size="small" color={req.priority === "URGENT" ? "error" : "default"} label={req.priority} />
              {req.escalated && <Chip size="small" color="warning" label="ESCALATED" />}
              <Chip size="small" variant="outlined" label={`${req.photoCount} photo(s)`} />
            </Stack>
            <Typography variant="subtitle2" sx={{ mt: 1 }}>
              Thread
            </Typography>
            {req.comments.length === 0 && <Typography color="text.secondary">No comments yet</Typography>}
            {req.comments.map((c) => (
              <Typography key={c.id} variant="body2">
                <strong>{c.authorRole}</strong> ({c.authorName}): {c.body}
              </Typography>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        <Button
          onClick={() => {
            const m = window.prompt("Message to host (no phone is shared):");
            if (m) contact.mutate(m);
          }}
          disabled={!req || contact.isPending}
        >
          Contact host
        </Button>
        <Button
          color="warning"
          onClick={() => {
            const r = window.prompt("Reason to flag this host?");
            if (r) flag.mutate(r);
          }}
          disabled={!req || flag.isPending}
        >
          Flag host
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            const r = window.prompt("Resolution note (logged)?");
            if (r) resolve.mutate(r);
          }}
          disabled={!req || req.status === "RESOLVED" || resolve.isPending}
        >
          Mark resolved
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
