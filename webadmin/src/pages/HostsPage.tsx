import { useState } from "react";
import {
  Button,
  Chip,
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
import type { AdminHostListItem, ModerateUserInput, UserStatus } from "@roomadda/shared";
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
 * Host Management (§7.4). List hosts with standing + open escalations, inspect a
 * host (escalation history + moderation flags), and suspend/ban/reinstate.
 */
export function HostsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const KEY = ["admin", "hosts", query];
  const page = usePaginatedQuery<AdminHostListItem>(KEY, (cursor, limit) =>
    adminApi.listHosts(cursor, limit, undefined, query || undefined),
  );
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin", "hosts"] });

  const columns: Array<Column<AdminHostListItem>> = [
    { header: "Host", cell: (r) => `${r.fullName} · ${r.phone}` },
    { header: "Status", cell: (r) => <Chip size="small" color={statusColor[r.status]} label={r.status} /> },
    { header: "Listings", cell: (r) => r.listingCount },
    {
      header: "Open escalations",
      cell: (r) => (r.openEscalations > 0 ? <Chip size="small" color="warning" label={r.openEscalations} /> : "0"),
    },
    { header: "Flags", cell: (r) => r.flagCount },
    {
      header: "",
      cell: (r) => (
        <Button size="small" variant="outlined" onClick={() => setOpenId(r.id)}>
          Manage
        </Button>
      ),
    },
  ];

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Hosts
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Search name / phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setQuery(search.trim())}
        />
        <Button variant="outlined" onClick={() => setQuery(search.trim())}>
          Search
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
        emptyMessage="No hosts"
      />
      {openId && <HostDialog id={openId} onClose={() => setOpenId(null)} onChanged={invalidate} />}
    </>
  );
}

function HostDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const detail = useQuery({ queryKey: ["admin", "host", id], queryFn: () => adminApi.getHost(id) });
  const host = detail.data?.host;
  const refresh = () => {
    void detail.refetch();
    onChanged();
  };

  const moderate = useMutation({
    mutationFn: (body: ModerateUserInput) => adminApi.moderateHost(id, body),
    onSuccess: () => {
      pushToast("Host updated", "success");
      refresh();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const takedown = useMutation({
    mutationFn: ({ listingId, reason }: { listingId: string; reason: string }) =>
      adminApi.takedownListing(listingId, reason),
    onSuccess: () => {
      pushToast("Listing taken down", "success");
      refresh();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{host ? host.fullName : "Loading…"}</DialogTitle>
      <DialogContent dividers>
        {host && (
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              {host.phone} · {host.email ?? "no email"}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" color={statusColor[host.status]} label={host.status} />
              {host.statusReason && <Typography variant="caption">({host.statusReason})</Typography>}
            </Stack>

            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2">Escalation history ({host.escalations.length})</Typography>
            {host.escalations.length === 0 && <Typography color="text.secondary">None</Typography>}
            {host.escalations.map((e) => (
              <Typography key={e.id} variant="body2">
                {e.ticketNumber} · {e.category} · {e.priority} · {e.status} · {e.listing.alias}
              </Typography>
            ))}

            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2">Flags ({host.flags.length})</Typography>
            {host.flags.length === 0 && <Typography color="text.secondary">None</Typography>}
            {host.flags.map((f) => (
              <Typography key={f.id} variant="body2">
                {new Date(f.createdAt).toLocaleDateString()}: {f.reason}
              </Typography>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        {host?.status === "ACTIVE" ? (
          <>
            <Button
              color="warning"
              onClick={() => {
                const reason = window.prompt("Reason to suspend?");
                if (reason) moderate.mutate({ action: "SUSPEND", reason });
              }}
            >
              Suspend
            </Button>
            <Button
              color="error"
              onClick={() => {
                const reason = window.prompt("Reason to ban?");
                if (reason) moderate.mutate({ action: "BAN", reason });
              }}
            >
              Ban
            </Button>
          </>
        ) : (
          host && (
            <Button color="success" onClick={() => moderate.mutate({ action: "REINSTATE" })}>
              Reinstate
            </Button>
          )
        )}
        <Button
          onClick={() => {
            const listingId = window.prompt("Listing ID to take down?");
            if (!listingId) return;
            const reason = window.prompt("Reason for take-down (required)?");
            if (reason) takedown.mutate({ listingId: listingId.trim(), reason });
          }}
        >
          Take down listing
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
