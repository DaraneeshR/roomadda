import { useState } from "react";
import {
  Box,
  Button,
  Divider,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { ErpReportKind } from "@roomadda/shared";
import { erpApi } from "../api/erp";
import { financialYearOptions } from "../lib/erpPeriod";
import { pushToast } from "../lib/toastBus";

const REPORTS: Array<{ kind: ErpReportKind; label: string }> = [
  { kind: "bookings-ledger", label: "Bookings ledger" },
  { kind: "commission-ledger", label: "Commission ledger" },
  { kind: "customer-invoices", label: "Customer invoices" },
  { kind: "commission-invoices", label: "Commission invoices" },
  { kind: "collections-settlements", label: "Collections & settlements" },
  { kind: "summary", label: "Summary" },
];

/**
 * CA & Compliance (§15.3/§15.7). Pick a financial year, then one-click download the
 * multi-sheet .xlsx compliance pack or any of the six individual report exports —
 * all engine-sourced and reconciling to the §15.3 dashboard for the same FY. Every
 * download goes through the authed blob path (getBlob), never an unauthenticated link.
 */
export function ErpCaPage() {
  // "" = the server's active FY (from settings, else the FY of now).
  const [fy, setFy] = useState<number | "">("");
  const [busy, setBusy] = useState<string | null>(null);
  const years = financialYearOptions();
  const financialYear = fy === "" ? undefined : fy;

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Download failed", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Typography variant="h4" gutterBottom>
        CA &amp; compliance
      </Typography>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            select
            size="small"
            label="Financial year"
            value={fy}
            onChange={(e) => setFy(e.target.value === "" ? "" : Number(e.target.value))}
            sx={{ width: 200 }}
          >
            <MenuItem value="">Active FY (from settings)</MenuItem>
            {years.map((y) => (
              <MenuItem key={y} value={y}>
                FY {y}–{String((y + 1) % 100).padStart(2, "0")}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            disabled={busy !== null}
            onClick={() => void run("ca-pack", () => erpApi.downloadCaPack(financialYear))}
          >
            Download CA pack (.xlsx)
          </Button>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Report exports
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          The six sheets of the pack, individually — as Excel or CSV.
        </Typography>
        <Divider sx={{ mb: 1 }} />
        <Stack divider={<Divider flexItem />} spacing={1}>
          {REPORTS.map((r) => (
            <Box
              key={r.kind}
              sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", py: 0.5 }}
            >
              <Typography variant="body2">{r.label}</Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy !== null}
                  onClick={() => void run(`${r.kind}-xlsx`, () => erpApi.downloadReport(r.kind, financialYear, "xlsx"))}
                >
                  XLSX
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy !== null}
                  onClick={() => void run(`${r.kind}-csv`, () => erpApi.downloadReport(r.kind, financialYear, "csv"))}
                >
                  CSV
                </Button>
              </Stack>
            </Box>
          ))}
        </Stack>
      </Paper>
    </>
  );
}
