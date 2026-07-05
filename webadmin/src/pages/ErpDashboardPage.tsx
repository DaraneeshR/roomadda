import { useState } from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatPaise, type ErpFinanceFilter as ErpFilter } from "@roomadda/shared";
import { erpApi } from "../api/erp";
import { BarList, type BarDatum } from "../components/erp/BarList";
import { ErpFinanceFilter } from "../components/erp/ErpFinanceFilter";
import { useErpFilterOptions } from "../components/erp/useErpFilterOptions";
import { formatSignedPaise } from "../lib/money";

interface Headline {
  title: string;
  value: string;
  sub?: string;
}

/**
 * ERP Dashboard (§15.3). The ONE global finance filter (FY / quarter / month /
 * property / agent) scopes the whole screen: headline numbers, the two charts,
 * and the top-agents leaderboard all re-fetch when it changes. Every figure is
 * engine-sourced integer paise — this page only formats it, never computes it.
 */
export function ErpDashboardPage() {
  const [filter, setFilter] = useState<ErpFilter>({});

  const dashboard = useQuery({
    queryKey: ["erp", "dashboard", filter],
    queryFn: () => erpApi.dashboard(filter),
    placeholderData: keepPreviousData,
  });

  const { propertyOptions, agentOptions } = useErpFilterOptions(filter.financialYear);

  const d = dashboard.data;
  const headlines: Headline[] = d
    ? [
        { title: "Net commission", value: formatSignedPaise(d.headline.netCommissionPaise), sub: `${d.headline.bookingCount} bookings` },
        { title: "Total collection", value: formatPaise(d.headline.totalCollectionPaise) },
        {
          title: "Pending",
          value: formatSignedPaise(d.headline.pendingNetPaise),
          sub: `${d.headline.pendingBookingCount} awaiting settlement`,
        },
        {
          title: "Received",
          value: formatSignedPaise(d.headline.receivedNetPaise),
          sub: `${d.headline.receivedBookingCount} settled`,
        },
      ]
    : [];

  const propertyBars: BarDatum[] = (d?.commissionByProperty ?? []).map((p) => ({
    key: p.listingId,
    label: p.listingAlias,
    value: p.commissionPaise,
    display: formatPaise(p.commissionPaise),
  }));
  const monthBars: BarDatum[] = (d?.bookingsByMonth ?? []).map((m) => ({
    key: m.month,
    label: m.label,
    value: m.bookingCount,
    display: String(m.bookingCount),
  }));

  return (
    <>
      <Typography variant="h4" gutterBottom>
        ERP dashboard
      </Typography>

      <ErpFinanceFilter
        value={filter}
        onChange={setFilter}
        propertyOptions={propertyOptions}
        agentOptions={agentOptions}
      />

      {dashboard.isError && <Alert severity="error">Could not load the ERP dashboard. Please retry.</Alert>}
      {dashboard.isLoading && <CircularProgress />}

      {d && (
        <Stack spacing={3}>
          <Typography variant="body2" color="text.secondary">
            {d.period.label}
            {d.headline.amc.supported === false && ` · AMC revenue: ${d.headline.amc.note}`}
          </Typography>

          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
            {headlines.map((h) => (
              <Card key={h.title} sx={{ flex: "1 1 220px", minWidth: 220 }}>
                <CardContent>
                  <Typography color="text.secondary" variant="body2" gutterBottom>
                    {h.title}
                  </Typography>
                  <Typography variant="h4" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {h.value}
                  </Typography>
                  {h.sub && (
                    <Typography variant="caption" color="text.secondary">
                      {h.sub}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            ))}
          </Box>

          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "flex-start" }}>
            <Paper variant="outlined" sx={{ p: 2, flex: "1 1 360px", minWidth: 320 }}>
              <Typography variant="h6" gutterBottom>
                Commission by property
              </Typography>
              <BarList data={propertyBars} emptyMessage="No commission in this period" />
            </Paper>
            <Paper variant="outlined" sx={{ p: 2, flex: "1 1 360px", minWidth: 320 }}>
              <Typography variant="h6" gutterBottom>
                Bookings by month
              </Typography>
              <BarList data={monthBars} emptyMessage="No bookings in this period" />
            </Paper>
          </Box>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Top agents
            </Typography>
            <Divider sx={{ mb: 1 }} />
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Agent</TableCell>
                  <TableCell align="right">Bookings</TableCell>
                  <TableCell align="right">Commission</TableCell>
                  <TableCell align="right">Net</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {d.topAgents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography color="text.secondary" sx={{ py: 1 }}>
                        No agent activity in this period
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  d.topAgents.map((a) => (
                    <TableRow key={a.agentId} hover>
                      <TableCell>{a.agentName ?? a.agentId.slice(0, 8)}</TableCell>
                      <TableCell align="right">{a.bookingCount}</TableCell>
                      <TableCell align="right">{formatPaise(a.commissionPaise)}</TableCell>
                      <TableCell align="right">{formatSignedPaise(a.netPaise)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Paper>
        </Stack>
      )}
    </>
  );
}
