import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BROADCAST_AUDIENCES,
  BROADCAST_CHANNELS,
  BROADCAST_WEEKLY_CAP,
  type AdminBroadcastDTO,
  type BroadcastAudience,
  type BroadcastChannel,
} from "@roomadda/shared";
import { adminApi } from "../api/admin";
import { CursorTable, type Column } from "../components/CursorTable";
import { usePaginatedQuery } from "../components/usePaginatedQuery";
import { pushToast } from "../lib/toastBus";

/**
 * Notifications & WhatsApp Broadcast (§7.12). Compose a push/WhatsApp message to
 * a segment, schedule it now or later, and review history with open-rate. The
 * platform-wide weekly cap is enforced server-side; a 429 is surfaced here.
 */
export function BroadcastsPage() {
  const qc = useQueryClient();
  const KEY = ["admin", "broadcasts"];
  const page = usePaginatedQuery<AdminBroadcastDTO>(KEY, (cursor, limit) => adminApi.listBroadcasts(cursor, limit));
  const invalidate = () => void qc.invalidateQueries({ queryKey: KEY });

  const [channel, setChannel] = useState<BroadcastChannel>("PUSH");
  const [audience, setAudience] = useState<BroadcastAudience>("ALL_USERS");
  const [audienceValue, setAudienceValue] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [deepLink, setDeepLink] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  const needsValue = audience === "CITY" || audience === "BEHAVIOUR";

  const create = useMutation({
    mutationFn: () =>
      adminApi.createBroadcast({
        channel,
        audience,
        audienceValue: needsValue ? audienceValue : undefined,
        title,
        body,
        deepLink: deepLink || undefined,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      }),
    onSuccess: () => {
      pushToast("Broadcast queued", "success");
      setTitle("");
      setBody("");
      setDeepLink("");
      setScheduledAt("");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => adminApi.cancelBroadcast(id),
    onSuccess: () => {
      pushToast("Cancelled", "success");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const send = useMutation({
    mutationFn: (id: string) => adminApi.sendBroadcast(id),
    onSuccess: () => {
      pushToast("Sent", "success");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });

  const columns: Array<Column<AdminBroadcastDTO>> = [
    { header: "Channel", cell: (r) => r.channel },
    { header: "Audience", cell: (r) => (r.audienceValue ? `${r.audience}: ${r.audienceValue}` : r.audience) },
    { header: "Title", cell: (r) => r.title },
    { header: "Status", cell: (r) => <Chip size="small" label={r.status} /> },
    { header: "Recipients", cell: (r) => r.recipientCount },
    { header: "Open rate", cell: (r) => (r.openRate === null ? "—" : `${Math.round(r.openRate * 100)}%`) },
    { header: "Scheduled", cell: (r) => new Date(r.scheduledAt).toLocaleString() },
    {
      header: "",
      cell: (r) =>
        r.status === "SCHEDULED" ? (
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => send.mutate(r.id)}>
              Send
            </Button>
            <Button size="small" color="error" onClick={() => cancel.mutate(r.id)}>
              Cancel
            </Button>
          </Stack>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Broadcasts
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        Platform-wide cap: at most {BROADCAST_WEEKLY_CAP} broadcasts per rolling week. Recipient counts are estimates.
      </Alert>

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Compose
        </Typography>
        <Stack spacing={2}>
          <Stack direction="row" spacing={2}>
            <TextField select size="small" label="Channel" value={channel} onChange={(e) => setChannel(e.target.value as BroadcastChannel)} sx={{ width: 160 }}>
              {BROADCAST_CHANNELS.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Audience" value={audience} onChange={(e) => setAudience(e.target.value as BroadcastAudience)} sx={{ width: 200 }}>
              {BROADCAST_AUDIENCES.map((a) => (
                <MenuItem key={a} value={a}>
                  {a}
                </MenuItem>
              ))}
            </TextField>
            {needsValue && (
              <TextField
                size="small"
                label={audience === "CITY" ? "City" : "Behaviour key"}
                value={audienceValue}
                onChange={(e) => setAudienceValue(e.target.value)}
                helperText={audience === "BEHAVIOUR" ? "e.g. wishlisted_no_booking" : undefined}
              />
            )}
          </Stack>
          <TextField size="small" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <TextField size="small" label="Body" value={body} onChange={(e) => setBody(e.target.value)} multiline minRows={2} />
          <Stack direction="row" spacing={2}>
            <TextField size="small" label="Deep link (optional)" value={deepLink} onChange={(e) => setDeepLink(e.target.value)} sx={{ flexGrow: 1 }} />
            <TextField
              size="small"
              type="datetime-local"
              label="Schedule (empty = now)"
              InputLabelProps={{ shrink: true }}
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </Stack>
          <Stack direction="row" justifyContent="flex-end">
            <Button
              variant="contained"
              disabled={!title || !body || (needsValue && !audienceValue) || create.isPending}
              onClick={() => create.mutate()}
            >
              {scheduledAt ? "Schedule" : "Send now"}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Typography variant="h6" gutterBottom>
        History
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
        emptyMessage="No broadcasts yet"
      />
    </>
  );
}
