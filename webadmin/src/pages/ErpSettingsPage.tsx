import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgSettings, UpdateOrgSettingsInput } from "@roomadda/shared";
import { erpApi } from "../api/erp";
import { financialYearOptions } from "../lib/erpPeriod";
import { pushToast } from "../lib/toastBus";

/**
 * ERP Settings (§15.7). The singleton company profile, the active financial year,
 * and the operating-mode flags — plus the back-office team roster and a
 * server-side "add team login" (name / email / temp password / role) that forces a
 * first-login password change. Every write is ADMIN-only and audited server-side.
 */
export function ErpSettingsPage() {
  const settings = useQuery({ queryKey: ["erp", "settings"], queryFn: () => erpApi.getSettings() });

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>
      {settings.isLoading && <CircularProgress />}
      {settings.isError && <Alert severity="error">Could not load settings.</Alert>}
      {settings.data && (
        <Stack spacing={3}>
          <SettingsForm settings={settings.data.settings} />
          <TeamSection />
        </Stack>
      )}
    </>
  );
}

type FormState = {
  legalName: string;
  displayName: string;
  gstin: string;
  pan: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  contactEmail: string;
  contactPhone: string;
  financialYear: number | "";
  onlineBookingsEnabled: boolean;
  walkInBookingsEnabled: boolean;
  maintenanceMode: boolean;
};

const seed = (s: OrgSettings): FormState => ({
  legalName: s.legalName,
  displayName: s.displayName,
  gstin: s.gstin ?? "",
  pan: s.pan ?? "",
  addressLine: s.addressLine ?? "",
  city: s.city ?? "",
  state: s.state ?? "",
  pincode: s.pincode ?? "",
  contactEmail: s.contactEmail ?? "",
  contactPhone: s.contactPhone ?? "",
  financialYear: s.financialYear ?? "",
  onlineBookingsEnabled: s.operatingModes.onlineBookingsEnabled,
  walkInBookingsEnabled: s.operatingModes.walkInBookingsEnabled,
  maintenanceMode: s.operatingModes.maintenanceMode,
});

/** Empty string → null for the nullable string fields (clears the value server-side). */
const orNull = (v: string): string | null => (v.trim() === "" ? null : v.trim());

function SettingsForm({ settings }: { settings: OrgSettings }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(() => seed(settings));
  useEffect(() => setForm(seed(settings)), [settings]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body: UpdateOrgSettingsInput = {
        legalName: form.legalName.trim(),
        displayName: form.displayName.trim(),
        gstin: orNull(form.gstin),
        pan: orNull(form.pan),
        addressLine: orNull(form.addressLine),
        city: orNull(form.city),
        state: orNull(form.state),
        pincode: orNull(form.pincode),
        contactEmail: orNull(form.contactEmail),
        contactPhone: orNull(form.contactPhone),
        financialYear: form.financialYear === "" ? null : form.financialYear,
        onlineBookingsEnabled: form.onlineBookingsEnabled,
        walkInBookingsEnabled: form.walkInBookingsEnabled,
        maintenanceMode: form.maintenanceMode,
      };
      return erpApi.updateSettings(body);
    },
    onSuccess: (r) => {
      qc.setQueryData(["erp", "settings"], { settings: r.settings });
      pushToast("Settings saved", "success");
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });

  const years = financialYearOptions();
  const fyOptions = form.financialYear !== "" && !years.includes(form.financialYear)
    ? [form.financialYear, ...years]
    : years;

  const text = (label: string, k: keyof FormState) => (
    <TextField
      size="small"
      label={label}
      value={form[k] as string}
      onChange={(e) => set(k, e.target.value as FormState[typeof k])}
      sx={{ flex: "1 1 240px", minWidth: 220 }}
    />
  );

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        Company details
      </Typography>
      <Stack spacing={2}>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          {text("Legal name", "legalName")}
          {text("Display name", "displayName")}
          {text("GSTIN", "gstin")}
          {text("PAN", "pan")}
          {text("Address", "addressLine")}
          {text("City", "city")}
          {text("State", "state")}
          {text("Pincode", "pincode")}
          {text("Contact email", "contactEmail")}
          {text("Contact phone", "contactPhone")}
          <TextField
            select
            size="small"
            label="Active financial year"
            value={form.financialYear === "" ? "" : String(form.financialYear)}
            onChange={(e) => set("financialYear", e.target.value === "" ? "" : Number(e.target.value))}
            sx={{ flex: "1 1 240px", minWidth: 220 }}
          >
            <MenuItem value="">FY of now (default)</MenuItem>
            {fyOptions.map((y) => (
              <MenuItem key={y} value={String(y)}>
                FY {y}–{String((y + 1) % 100).padStart(2, "0")}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <Divider />
        <Typography variant="subtitle2">Operating modes</Typography>
        <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
          <FormControlLabel
            control={<Switch checked={form.onlineBookingsEnabled} onChange={(e) => set("onlineBookingsEnabled", e.target.checked)} />}
            label="Online bookings enabled"
          />
          <FormControlLabel
            control={<Switch checked={form.walkInBookingsEnabled} onChange={(e) => set("walkInBookingsEnabled", e.target.checked)} />}
            label="Walk-in bookings enabled"
          />
          <FormControlLabel
            control={<Switch checked={form.maintenanceMode} onChange={(e) => set("maintenanceMode", e.target.checked)} />}
            label="Maintenance mode"
          />
        </Stack>

        <Button
          variant="contained"
          disabled={!form.legalName.trim() || !form.displayName.trim() || save.isPending}
          onClick={() => save.mutate()}
          sx={{ alignSelf: "flex-start" }}
        >
          Save settings
        </Button>
      </Stack>
    </Paper>
  );
}

function TeamSection() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const team = useQuery({ queryKey: ["erp", "team"], queryFn: () => erpApi.listTeam() });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["erp", "team"] });

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6">Team logins</Typography>
        <Button variant="contained" onClick={() => setAddOpen(true)}>
          Add team login
        </Button>
      </Stack>
      {team.isLoading && <CircularProgress />}
      {team.data && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>First login</TableCell>
              <TableCell>Created</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {team.data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography color="text.secondary" sx={{ py: 1 }}>
                    No team logins yet
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              team.data.items.map((m) => (
                <TableRow key={m.id} hover>
                  <TableCell>{m.fullName}</TableCell>
                  <TableCell>{m.email ?? "—"}</TableCell>
                  <TableCell>{m.role}</TableCell>
                  <TableCell>
                    <Chip size="small" label={m.status} />
                  </TableCell>
                  <TableCell>
                    {m.mustChangePassword ? (
                      <Chip size="small" color="warning" label="Password change pending" />
                    ) : (
                      "Done"
                    )}
                  </TableCell>
                  <TableCell>{new Date(m.createdAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
      {addOpen && <AddTeamDialog onClose={() => setAddOpen(false)} onDone={invalidate} />}
    </Paper>
  );
}

function AddTeamDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");

  const add = useMutation({
    mutationFn: () => erpApi.addTeamMember({ fullName: fullName.trim(), email: email.trim(), tempPassword, role: "ADMIN" }),
    onSuccess: () => {
      pushToast("Team login created (must change password on first login)", "success");
      onDone();
      onClose();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Add team login</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField size="small" label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <TextField size="small" type="email" label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextField
            size="small"
            type="password"
            label="Temp password (min 8 chars)"
            value={tempPassword}
            onChange={(e) => setTempPassword(e.target.value)}
          />
          <TextField select size="small" label="Role" value="ADMIN" disabled>
            <MenuItem value="ADMIN">ADMIN</MenuItem>
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!fullName.trim() || !email.trim() || tempPassword.length < 8 || add.isPending}
          onClick={() => add.mutate()}
        >
          Create login
        </Button>
      </DialogActions>
    </Dialog>
  );
}
