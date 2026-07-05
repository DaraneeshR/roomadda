import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
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
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { formatPaise, type ErpAgentScorecard, type ErpFinanceFilter as ErpFilter } from "@roomadda/shared";
import { erpApi } from "../api/erp";
import { ErpFinanceFilter, type FilterOption } from "../components/erp/ErpFinanceFilter";
import { useErpFilterOptions } from "../components/erp/useErpFilterOptions";
import { formatSignedPaise } from "../lib/money";
import { pushToast } from "../lib/toastBus";

const pct = (rate: number): string => `${Math.round(rate * 1000) / 10}%`;

const tierLabel = (t: ErpAgentScorecard["tier"]): string =>
  t.nextTierName ? `${t.name} · ${t.bookingsToNextTier} to ${t.nextTierName}` : t.name;

/**
 * Agents (finance) (§15.3). Per-agent scorecards — submitted / approved /
 * conversion, engine-earned commission + net, and the incentive tier — ranked into
 * the commission leaderboard, all under the one global filter. An admin can reassign
 * a booking to another agent; because commission is DERIVED from the booking's rent
 * and its agent link, the move recomputes commission, performance, and rank.
 */
export function ErpAgentsFinancePage() {
  const [filter, setFilter] = useState<ErpFilter>({});
  const [reassignOpen, setReassignOpen] = useState(false);
  const { propertyOptions, agentOptions } = useErpFilterOptions(filter.financialYear);

  const agents = useQuery({
    queryKey: ["erp", "agents-finance", filter],
    queryFn: () => erpApi.agentsFinance(filter),
    placeholderData: keepPreviousData,
  });
  const data = agents.data;

  return (
    <>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h4">Agents (finance)</Typography>
        <Button variant="contained" onClick={() => setReassignOpen(true)}>
          Reassign booking
        </Button>
      </Stack>

      <ErpFinanceFilter value={filter} onChange={setFilter} propertyOptions={propertyOptions} agentOptions={agentOptions} />

      {agents.isError && <Alert severity="error">Could not load agent performance. Please retry.</Alert>}
      {agents.isLoading && <CircularProgress />}

      {data && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {data.period.label}
          </Typography>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Commission leaderboard
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Agent</TableCell>
                  <TableCell>City</TableCell>
                  <TableCell align="right">Submitted</TableCell>
                  <TableCell align="right">Approved</TableCell>
                  <TableCell align="right">Conversion</TableCell>
                  <TableCell align="right">Commission</TableCell>
                  <TableCell align="right">Net</TableCell>
                  <TableCell>Tier</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.leaderboard.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <Typography color="text.secondary" sx={{ py: 1 }}>
                        No agent activity in this period
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  data.leaderboard.map((a, i) => (
                    <TableRow key={a.agentId} hover>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell>{a.agentName}</TableCell>
                      <TableCell>{a.assignedCity ?? "—"}</TableCell>
                      <TableCell align="right">{a.submitted}</TableCell>
                      <TableCell align="right">{a.approved}</TableCell>
                      <TableCell align="right">{pct(a.conversionRate)}</TableCell>
                      <TableCell align="right">{formatPaise(a.commissionPaise)}</TableCell>
                      <TableCell align="right">{formatSignedPaise(a.netPaise)}</TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" label={tierLabel(a.tier)} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Paper>
        </Stack>
      )}

      {reassignOpen && (
        <ReassignDialog
          agentOptions={agentOptions}
          onClose={() => setReassignOpen(false)}
          onDone={() => void agents.refetch()}
        />
      )}
    </>
  );
}

/** Move a booking's attribution to another agent → the engine recomputes its
 *  commission (shown back), and the leaderboard/performance re-rank on refetch. */
function ReassignDialog({
  agentOptions,
  onClose,
  onDone,
}: {
  agentOptions: FilterOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [bookingId, setBookingId] = useState("");
  const [agentId, setAgentId] = useState("");

  const reassign = useMutation({
    mutationFn: () => erpApi.reassignBooking(bookingId.trim(), agentId),
    onSuccess: ({ result }) => {
      const net = result.commission ? formatSignedPaise(result.commission.netPaise) : "—";
      pushToast(`Reassigned to ${result.agentName}; net commission recomputed to ${net}`, "success");
      onDone();
      onClose();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Reassign booking to an agent</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            size="small"
            label="Booking ID"
            value={bookingId}
            onChange={(e) => setBookingId(e.target.value)}
          />
          <TextField
            select
            size="small"
            label="New agent"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {agentOptions.length === 0 && <MenuItem disabled>No agents</MenuItem>}
            {agentOptions.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!bookingId || !agentId || reassign.isPending} onClick={() => reassign.mutate()}>
          Reassign
        </Button>
      </DialogActions>
    </Dialog>
  );
}
