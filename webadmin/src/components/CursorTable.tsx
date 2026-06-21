import type { ReactNode } from "react";
import {
  Box,
  Button,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
}

interface CursorTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  getRowKey: (row: T) => string;
  loading?: boolean;
  hasNext: boolean;
  hasPrev: boolean;
  onNext: () => void;
  onPrev: () => void;
  emptyMessage?: string;
}

/** Generic table with server-driven cursor pagination (Previous / Next). */
export function CursorTable<T>({
  columns,
  rows,
  getRowKey,
  loading = false,
  hasNext,
  hasPrev,
  onNext,
  onPrev,
  emptyMessage = "No records",
}: CursorTableProps<T>) {
  return (
    <Paper variant="outlined">
      <Box sx={{ height: 4 }}>{loading && <LinearProgress />}</Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              {columns.map((column) => (
                <TableCell key={column.header}>{column.header}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && !loading ? (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    {emptyMessage}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={getRowKey(row)} hover>
                  {columns.map((column) => (
                    <TableCell key={column.header}>{column.cell(row)}</TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, p: 1 }}>
        <Button size="small" variant="outlined" disabled={!hasPrev} onClick={onPrev}>
          Previous
        </Button>
        <Button size="small" variant="outlined" disabled={!hasNext} onClick={onNext}>
          Next
        </Button>
      </Box>
    </Paper>
  );
}
