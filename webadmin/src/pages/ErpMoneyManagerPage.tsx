import { useState } from "react";
import {
  Alert,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableFooter,
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

/**
 * Money Manager (§15.3). The month-by-month view of the SAME engine-priced set the
 * dashboard rolls up, obeying the one global filter: collection, commission,
 * payouts, settled vs pending net, and the running balance — plus a customer
 * drill-down. Every figure is server-owned integer paise (read, never computed).
 */
export function ErpMoneyManagerPage() {
  const [filter, setFilter] = useState<ErpFilter>({});
  const { propertyOptions, agentOptions } = useErpFilterOptions(filter.financialYear);

  const money = useQuery({
    queryKey: ["erp", "money-manager", filter],
    queryFn: () => erpApi.moneyManager(filter),
    placeholderData: keepPreviousData,
  });
  const data = money.data;

  const collectionBars: BarDatum[] = (data?.months ?? []).map((m) => ({
    key: m.month,
    label: m.label,
    value: m.collectionPaise,
    display: formatPaise(m.collectionPaise),
  }));

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Money manager
      </Typography>

      <ErpFinanceFilter value={filter} onChange={setFilter} propertyOptions={propertyOptions} agentOptions={agentOptions} />

      {money.isError && <Alert severity="error">Could not load the money manager. Please retry.</Alert>}
      {money.isLoading && <CircularProgress />}

      {data && (
        <Stack spacing={3}>
          <Typography variant="body2" color="text.secondary">
            {data.period.label}
          </Typography>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Month by month
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Month</TableCell>
                  <TableCell align="right">Bookings</TableCell>
                  <TableCell align="right">Collection</TableCell>
                  <TableCell align="right">Commission</TableCell>
                  <TableCell align="right">Payouts</TableCell>
                  <TableCell align="right">Net</TableCell>
                  <TableCell align="right">Settled</TableCell>
                  <TableCell align="right">Pending</TableCell>
                  <TableCell align="right">Running balance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.months.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <Typography color="text.secondary" sx={{ py: 1 }}>
                        No activity in this period
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  data.months.map((m) => (
                    <TableRow key={m.month} hover>
                      <TableCell>{m.label}</TableCell>
                      <TableCell align="right">{m.bookingCount}</TableCell>
                      <TableCell align="right">{formatPaise(m.collectionPaise)}</TableCell>
                      <TableCell align="right">{formatPaise(m.commissionPaise)}</TableCell>
                      <TableCell align="right">{formatPaise(m.payoutPaise)}</TableCell>
                      <TableCell align="right">{formatSignedPaise(m.netPaise)}</TableCell>
                      <TableCell align="right">{formatSignedPaise(m.settledNetPaise)}</TableCell>
                      <TableCell align="right">{formatSignedPaise(m.pendingNetPaise)}</TableCell>
                      <TableCell align="right">{formatSignedPaise(m.runningBalancePaise)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, color: "text.primary" }}>Total</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: "text.primary" }}>
                    {data.totals.bookingCount}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: "text.primary" }}>
                    {formatPaise(data.totals.collectionPaise)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: "text.primary" }}>
                    {formatPaise(data.totals.commissionPaise)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: "text.primary" }}>
                    {formatPaise(data.totals.payoutPaise)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: "text.primary" }}>
                    {formatSignedPaise(data.totals.netPaise)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: "text.primary" }}>
                    {formatSignedPaise(data.totals.settledNetPaise)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: "text.primary" }}>
                    {formatSignedPaise(data.totals.pendingNetPaise)}
                  </TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableFooter>
            </Table>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Collection by month
            </Typography>
            <BarList data={collectionBars} emptyMessage="No collection in this period" />
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Customers
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Customer</TableCell>
                  <TableCell align="right">Bookings</TableCell>
                  <TableCell align="right">Collection</TableCell>
                  <TableCell align="right">Commission</TableCell>
                  <TableCell align="right">Net</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.customers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography color="text.secondary" sx={{ py: 1 }}>
                        No customers in this period
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  data.customers.map((c) => (
                    <TableRow key={c.tenantId} hover>
                      <TableCell>{c.tenantName}</TableCell>
                      <TableCell align="right">{c.bookingCount}</TableCell>
                      <TableCell align="right">{formatPaise(c.collectionPaise)}</TableCell>
                      <TableCell align="right">{formatPaise(c.commissionPaise)}</TableCell>
                      <TableCell align="right">{formatSignedPaise(c.netPaise)}</TableCell>
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
