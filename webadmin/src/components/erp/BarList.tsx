import { Box, Stack, Typography } from "@mui/material";

export interface BarDatum {
  key: string;
  label: string;
  /** The magnitude that sizes the bar (non-negative). */
  value: number;
  /** Pre-formatted value shown at the end of the row (e.g. money via the shared formatter). */
  display: string;
}

/**
 * A minimal horizontal bar chart built from MUI primitives — no chart dependency
 * (the webadmin ships none, and the existing dashboard renders its charts the same
 * plain way). Bars are sized relative to the largest value in the set.
 */
export function BarList({ data, emptyMessage = "No data" }: { data: BarDatum[]; emptyMessage?: string }) {
  if (data.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }}>
        {emptyMessage}
      </Typography>
    );
  }
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <Stack spacing={1.25}>
      {data.map((d) => (
        <Box key={d.key}>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.25 }}>
            <Typography variant="body2" noWrap sx={{ maxWidth: "60%" }} title={d.label}>
              {d.label}
            </Typography>
            <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {d.display}
            </Typography>
          </Box>
          <Box sx={{ height: 8, borderRadius: 1, bgcolor: "action.hover" }}>
            <Box
              sx={{
                height: 8,
                borderRadius: 1,
                bgcolor: "primary.main",
                width: `${Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0)}%`,
              }}
            />
          </Box>
        </Box>
      ))}
    </Stack>
  );
}
