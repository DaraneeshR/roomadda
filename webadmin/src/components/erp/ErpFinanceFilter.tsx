import { Button, MenuItem, Paper, Stack, TextField } from "@mui/material";
import type { ErpFinanceFilter as ErpFilter } from "@roomadda/shared";
import { financialYearOptions, MONTH_OPTIONS, QUARTER_OPTIONS } from "../../lib/erpPeriod";

export interface FilterOption {
  id: string;
  label: string;
}

interface Props {
  value: ErpFilter;
  onChange: (next: ErpFilter) => void;
  /** Properties with activity in the current period (property scope dropdown). */
  propertyOptions: FilterOption[];
  /** Agents (agent scope dropdown). */
  agentOptions: FilterOption[];
}

const ALL = "";

/**
 * The ONE §15.3 global finance filter (FY / quarter / month / property / agent).
 * `quarter` and `month` are mutually exclusive — picking one clears the other, as
 * the server requires. Owned by the page; this component is pure presentation.
 */
export function ErpFinanceFilter({ value, onChange, propertyOptions, agentOptions }: Props) {
  const years = financialYearOptions();
  const fyOptions = value.financialYear && !years.includes(value.financialYear)
    ? [value.financialYear, ...years]
    : years;

  const set = (patch: Partial<ErpFilter>) => onChange({ ...value, ...patch });

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <TextField
          select
          size="small"
          label="Financial year"
          value={value.financialYear ?? ""}
          onChange={(e) => set({ financialYear: e.target.value === ALL ? undefined : Number(e.target.value) })}
          sx={{ width: 170 }}
        >
          <MenuItem value={ALL}>Current FY</MenuItem>
          {fyOptions.map((y) => (
            <MenuItem key={y} value={y}>
              FY {y}–{String((y + 1) % 100).padStart(2, "0")}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Quarter"
          value={value.quarter ?? ""}
          onChange={(e) =>
            set({
              quarter: e.target.value === ALL ? undefined : Number(e.target.value),
              month: undefined, // mutually exclusive with month
            })
          }
          sx={{ width: 160 }}
        >
          <MenuItem value={ALL}>All quarters</MenuItem>
          {QUARTER_OPTIONS.map((q) => (
            <MenuItem key={q.value} value={q.value}>
              {q.label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Month"
          value={value.month ?? ""}
          onChange={(e) =>
            set({
              month: e.target.value === ALL ? undefined : Number(e.target.value),
              quarter: undefined, // mutually exclusive with quarter
            })
          }
          sx={{ width: 150 }}
        >
          <MenuItem value={ALL}>All months</MenuItem>
          {MONTH_OPTIONS.map((m) => (
            <MenuItem key={m.value} value={m.value}>
              {m.label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Property"
          value={value.listingId ?? ""}
          onChange={(e) => set({ listingId: e.target.value === ALL ? undefined : e.target.value })}
          sx={{ width: 200 }}
        >
          <MenuItem value={ALL}>All properties</MenuItem>
          {propertyOptions.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Agent"
          value={value.agentId ?? ""}
          onChange={(e) => set({ agentId: e.target.value === ALL ? undefined : e.target.value })}
          sx={{ width: 200 }}
        >
          <MenuItem value={ALL}>All agents</MenuItem>
          {agentOptions.map((a) => (
            <MenuItem key={a.id} value={a.id}>
              {a.label}
            </MenuItem>
          ))}
        </TextField>

        <Button size="small" onClick={() => onChange({})} disabled={Object.keys(value).length === 0}>
          Reset
        </Button>
      </Stack>
    </Paper>
  );
}
