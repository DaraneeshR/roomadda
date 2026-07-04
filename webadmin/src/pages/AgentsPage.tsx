import { useState } from "react";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AdminAgentListItem, ModerateUserInput, UserStatus } from "@roomadda/shared";
import { adminApi } from "../api/admin";
import { CursorTable, type Column } from "../components/CursorTable";
import { usePaginatedQuery } from "../components/usePaginatedQuery";
import { pushToast } from "../lib/toastBus";

const statusColor: Record<UserStatus, "success" | "warning" | "error"> = {
  ACTIVE: "success",
  SUSPENDED: "warning",
  BANNED: "error",
};

/**
 * Agent Management (§7.5). List agents with zone + open visits, create an agent,
 * retune territory, suspend/ban/reinstate, and assign a property-inspection visit.
 */
export function AgentsPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const KEY = ["admin", "agents"];
  const page = usePaginatedQuery<AdminAgentListItem>(KEY, (cursor, limit) => adminApi.listAgents(cursor, limit));
  const invalidate = () => void qc.invalidateQueries({ queryKey: KEY });

  const moderate = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ModerateUserInput }) => adminApi.moderateAgent(id, body),
    onSuccess: () => {
      pushToast("Agent updated", "success");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const territory = useMutation({
    mutationFn: ({ id, city }: { id: string; city: string }) => adminApi.updateAgentTerritory(id, city),
    onSuccess: () => {
      pushToast("Territory updated", "success");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });

  const columns: Array<Column<AdminAgentListItem>> = [
    { header: "Agent", cell: (r) => `${r.fullName} · ${r.phone}` },
    { header: "Territory", cell: (r) => r.assignedCity ?? "—" },
    { header: "Status", cell: (r) => <Chip size="small" color={statusColor[r.status]} label={r.status} /> },
    { header: "Open visits", cell: (r) => r.openVisits },
    {
      header: "Actions",
      cell: (r) => (
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            onClick={() => {
              const city = window.prompt("New territory (city)?", r.assignedCity ?? "");
              if (city) territory.mutate({ id: r.id, city: city.trim() });
            }}
          >
            Territory
          </Button>
          {r.status === "ACTIVE" ? (
            <Button
              size="small"
              color="warning"
              onClick={() => {
                const reason = window.prompt("Reason to suspend?");
                if (reason) moderate.mutate({ id: r.id, body: { action: "SUSPEND", reason } });
              }}
            >
              Suspend
            </Button>
          ) : (
            <Button size="small" color="success" onClick={() => moderate.mutate({ id: r.id, body: { action: "REINSTATE" } })}>
              Reinstate
            </Button>
          )}
        </Stack>
      ),
    },
  ];

  return (
    <>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h4">Agents</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={() => setAssignOpen(true)}>
            Assign visit
          </Button>
          <Button variant="contained" onClick={() => setCreateOpen(true)}>
            Create agent
          </Button>
        </Stack>
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
        emptyMessage="No agents"
      />
      {createOpen && <CreateAgentDialog onClose={() => setCreateOpen(false)} onDone={invalidate} />}
      {assignOpen && <AssignVisitDialog onClose={() => setAssignOpen(false)} onDone={invalidate} />}
    </>
  );
}

function CreateAgentDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [assignedCity, setAssignedCity] = useState("");
  const [email, setEmail] = useState("");
  const create = useMutation({
    mutationFn: () => adminApi.createAgent({ fullName, phone, assignedCity, email: email || undefined }),
    onSuccess: () => {
      pushToast("Agent created", "success");
      onDone();
      onClose();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Create agent</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField size="small" label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <TextField size="small" label="Phone (+91…)" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <TextField size="small" label="Territory (city)" value={assignedCity} onChange={(e) => setAssignedCity(e.target.value)} />
          <TextField size="small" label="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!fullName || !phone || !assignedCity || create.isPending}
          onClick={() => create.mutate()}
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AssignVisitDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [listingId, setListingId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const assign = useMutation({
    mutationFn: () => adminApi.assignVisit({ listingId, agentId, scheduledAt: new Date(scheduledAt).toISOString() }),
    onSuccess: () => {
      pushToast("Visit assigned", "success");
      onDone();
      onClose();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Assign inspection visit</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField size="small" label="Listing ID" value={listingId} onChange={(e) => setListingId(e.target.value)} />
          <TextField size="small" label="Agent ID" value={agentId} onChange={(e) => setAgentId(e.target.value)} />
          <TextField
            size="small"
            type="datetime-local"
            label="Scheduled at"
            InputLabelProps={{ shrink: true }}
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!listingId || !agentId || !scheduledAt || assign.isPending}
          onClick={() => assign.mutate()}
        >
          Assign
        </Button>
      </DialogActions>
    </Dialog>
  );
}
