import { useState } from "react";
import {
  Box,
  Button,
  Chip,
  Paper,
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
import { adminApi } from "../api/admin";
import { pushToast } from "../lib/toastBus";

/**
 * Trust-tag & Featured control (§7.10). View which badges a listing holds + WHY
 * (from the badge engine), suspend/unsuspend a rule badge with a logged reason,
 * and grant/schedule a paid FEATURED placement. The UI exposes NO way to grant a
 * rule badge — only the engine earns those (the backend rejects any attempt).
 */
export function TrustFeaturedPage() {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [listingId, setListingId] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const badges = useQuery({
    queryKey: ["admin", "badges", listingId],
    queryFn: () => adminApi.listListingBadges(listingId!),
    enabled: Boolean(listingId),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin", "badges", listingId] });

  const suspend = useMutation({
    mutationFn: ({ kind, reason }: { kind: string; reason: string }) => adminApi.suspendBadge(listingId!, kind, reason),
    onSuccess: () => {
      pushToast("Badge suspended", "success");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const unsuspend = useMutation({
    mutationFn: (kind: string) => adminApi.unsuspendBadge(listingId!, kind),
    onSuccess: () => {
      pushToast("Suspension lifted", "success");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const grant = useMutation({
    mutationFn: () =>
      adminApi.grantFeatured(
        listingId!,
        start && end ? { startDate: new Date(start).toISOString(), endDate: new Date(end).toISOString() } : {},
      ),
    onSuccess: () => {
      pushToast(start && end ? "Featured scheduled" : "Featured granted (30 days)", "success");
      setStart("");
      setEnd("");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Trust &amp; Featured
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Listing ID"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          sx={{ width: 360 }}
        />
        <Button variant="contained" onClick={() => setListingId(input.trim() || null)} disabled={!input.trim()}>
          Load badges
        </Button>
      </Stack>

      {listingId && (
        <>
          <Paper variant="outlined" sx={{ mb: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Badge</TableCell>
                  <TableCell>Source</TableCell>
                  <TableCell>Standing</TableCell>
                  <TableCell>Why</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(badges.data?.badges ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography color="text.secondary" sx={{ py: 2 }}>
                        {badges.isFetching ? "Loading…" : "No badges on this listing"}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {(badges.data?.badges ?? []).map((b) => (
                  <TableRow key={b.kind} hover>
                    <TableCell>{b.kind}</TableCell>
                    <TableCell>
                      <Chip size="small" label={b.source} color={b.source === "ADMIN" ? "primary" : "default"} />
                    </TableCell>
                    <TableCell>
                      {b.suspended ? (
                        <Chip size="small" color="error" label="SUSPENDED" />
                      ) : b.active ? (
                        <Chip size="small" color="success" label="ACTIVE" />
                      ) : (
                        <Chip size="small" label="INACTIVE" />
                      )}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 320 }}>
                      <Typography variant="caption">{b.why}</Typography>
                      {b.suspendedReason && (
                        <Typography variant="caption" color="error" display="block">
                          Suspended: {b.suspendedReason}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {b.suspended ? (
                        <Button size="small" onClick={() => unsuspend.mutate(b.kind)}>
                          Unsuspend
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          color="error"
                          onClick={() => {
                            const reason = window.prompt(`Reason to suspend ${b.kind}?`);
                            if (reason) suspend.mutate({ kind: b.kind, reason });
                          }}
                        >
                          Suspend
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Grant / schedule Featured (paid)
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Leave dates empty for a 30-day placement starting now, or set a window to schedule ahead.
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                type="datetime-local"
                label="Start"
                InputLabelProps={{ shrink: true }}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
              <TextField
                size="small"
                type="datetime-local"
                label="End"
                InputLabelProps={{ shrink: true }}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
              <Box>
                <Button variant="contained" onClick={() => grant.mutate()} disabled={grant.isPending || Boolean(start) !== Boolean(end)}>
                  {start && end ? "Schedule Featured" : "Grant Featured (30d)"}
                </Button>
              </Box>
            </Stack>
          </Paper>
        </>
      )}
    </>
  );
}
