import { useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { AGENT_BOOKING_CHANNELS, rupeesToPaise, type AgentBookingChannel } from "@roomadda/shared";
import { erpApi } from "../../api/erp";
import { pushToast } from "../../lib/toastBus";

/**
 * Add a HISTORICAL booking (§15.3): a back-dated, already-confirmed booking
 * attributed to an agent that flows into the ledger / dashboard / agent
 * performance like a live one. Money is entered in rupees and converted to
 * integer paise ONLY via the shared helper (never ad-hoc); the server re-validates
 * (move-in must be in the past, bed row-locked) and owns the truth.
 */
export function AddHistoricalBookingDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [bedId, setBedId] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [tenantPhone, setTenantPhone] = useState("");
  const [agentId, setAgentId] = useState("");
  const [agentChannel, setAgentChannel] = useState<AgentBookingChannel>("WALK_IN");
  const [moveInDate, setMoveInDate] = useState("");
  const [monthlyRent, setMonthlyRent] = useState("");
  const [token, setToken] = useState("");
  const [deposit, setDeposit] = useState("");

  const create = useMutation({
    mutationFn: () =>
      erpApi.addHistoricalBooking({
        bedId: bedId.trim(),
        tenantName: tenantName.trim(),
        tenantPhone: tenantPhone.trim(),
        agentId: agentId.trim(),
        agentChannel,
        moveInDate: new Date(moveInDate).toISOString(),
        monthlyRentPaise: rupeesToPaise(Number(monthlyRent)),
        tokenAmountPaise: rupeesToPaise(Number(token)),
        depositPaise: deposit ? rupeesToPaise(Number(deposit)) : 0,
      }),
    onSuccess: () => {
      pushToast("Historical booking added", "success");
      onDone();
      onClose();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });

  const canSubmit =
    Boolean(bedId && tenantName && tenantPhone && agentId && moveInDate && monthlyRent && token) &&
    !create.isPending;

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Add historical booking</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField size="small" label="Bed ID" value={bedId} onChange={(e) => setBedId(e.target.value)} />
          <TextField size="small" label="Tenant name" value={tenantName} onChange={(e) => setTenantName(e.target.value)} />
          <TextField size="small" label="Tenant phone (+91…)" value={tenantPhone} onChange={(e) => setTenantPhone(e.target.value)} />
          <TextField size="small" label="Agent ID" value={agentId} onChange={(e) => setAgentId(e.target.value)} />
          <TextField
            select
            size="small"
            label="Channel"
            value={agentChannel}
            onChange={(e) => setAgentChannel(e.target.value as AgentBookingChannel)}
          >
            {AGENT_BOOKING_CHANNELS.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="date"
            label="Move-in date (past)"
            InputLabelProps={{ shrink: true }}
            value={moveInDate}
            onChange={(e) => setMoveInDate(e.target.value)}
          />
          <TextField
            size="small"
            type="number"
            label="Monthly rent (₹)"
            value={monthlyRent}
            onChange={(e) => setMonthlyRent(e.target.value)}
          />
          <TextField size="small" type="number" label="Token (₹)" value={token} onChange={(e) => setToken(e.target.value)} />
          <TextField
            size="small"
            type="number"
            label="Deposit (₹, optional)"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!canSubmit} onClick={() => create.mutate()}>
          Add booking
        </Button>
      </DialogActions>
    </Dialog>
  );
}
