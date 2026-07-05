import type { ReactNode } from "react";
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
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatPaise, type BookingApprovalStatus, type ErpBookingDetailResponse } from "@roomadda/shared";
import { erpApi } from "../../api/erp";
import { formatSignedPaise } from "../../lib/money";
import { pushToast } from "../../lib/toastBus";

const approvalColor: Record<BookingApprovalStatus, "warning" | "success" | "error" | "default"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "error",
  CANCELLED: "default",
};

interface Props {
  bookingId: string;
  onClose: () => void;
  /** Called after an approve/reject so the parent list can refetch. */
  onChanged?: () => void;
}

/**
 * The §15.3 booking / KYC detail: customer, listing (admin sees the real name),
 * the money-engine invoice breakdown, the net commission (ERP-1), and the KYC
 * documents behind short-lived signed URLs. When the booking is PENDING an admin
 * can approve/reject here — the same audited endpoints the approvals queue uses.
 * All money is engine-sourced integer paise, only formatted here.
 */
export function BookingDetailDialog({ bookingId, onClose, onChanged }: Props) {
  const detail = useQuery({
    queryKey: ["erp", "booking", bookingId],
    queryFn: () => erpApi.getBooking(bookingId),
  });
  const booking = detail.data;

  const afterDecision = () => {
    onChanged?.();
    onClose();
  };
  const approve = useMutation({
    mutationFn: () => erpApi.approveBooking(bookingId),
    onSuccess: () => {
      pushToast("Booking approved", "success");
      afterDecision();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const reject = useMutation({
    mutationFn: (reason: string) => erpApi.rejectBooking(bookingId, reason),
    onSuccess: () => {
      pushToast("Booking rejected", "success");
      afterDecision();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const deciding = approve.isPending || reject.isPending;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Booking {bookingId.slice(0, 8)}
        {booking && (
          <Chip size="small" sx={{ ml: 1 }} color={approvalColor[booking.approval]} label={booking.approval} />
        )}
        {booking?.historical && <Chip size="small" sx={{ ml: 1 }} variant="outlined" label="HISTORICAL" />}
      </DialogTitle>
      <DialogContent dividers>
        {detail.isLoading && <CircularProgress />}
        {detail.isError && <Alert severity="error">Could not load the booking detail.</Alert>}
        {booking && <DetailBody booking={booking} />}
      </DialogContent>
      <DialogActions>
        {booking?.approval === "PENDING" && (
          <>
            <Button
              color="error"
              disabled={deciding}
              onClick={() => {
                const reason = window.prompt("Reason for rejection?");
                if (reason) reject.mutate(reason);
              }}
            >
              Reject
            </Button>
            <Button variant="contained" disabled={deciding} onClick={() => approve.mutate()}>
              Approve
            </Button>
          </>
        )}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between">
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
    </Stack>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={0.75}>
      <Typography variant="subtitle2">{title}</Typography>
      {children}
    </Stack>
  );
}

const orDash = (v: number | null): string => (v === null ? "—" : formatPaise(v));

function DetailBody({ booking }: { booking: ErpBookingDetailResponse }) {
  const { customer, listing, agent, invoice, commission, kyc } = booking;
  return (
    <Stack spacing={2} sx={{ pt: 1 }}>
      <Stack direction="row" spacing={4} flexWrap="wrap" useFlexGap>
        <Section title="Customer">
          <Row label="Name" value={customer.fullName} />
          <Row label="Phone" value={customer.phone} />
          <Row label="Email" value={customer.email ?? "—"} />
          <Row label="Gender" value={customer.gender ?? "—"} />
          <Row label="Occupation" value={customer.occupationType ?? "—"} />
          <Row label="College" value={customer.college ?? "—"} />
          <Row label="Company" value={customer.company ?? "—"} />
        </Section>

        <Section title="Property">
          <Row label="Alias" value={listing.alias} />
          <Row label="Actual name" value={listing.actualName} />
          <Row label="Area" value={listing.areaLabel} />
          <Row label="City" value={listing.city} />
          <Row label="Agent" value={agent?.agentName ?? "—"} />
          <Row label="Channel" value={agent?.agentChannel ?? "—"} />
          <Row label="Move-in" value={booking.moveInDate ? new Date(booking.moveInDate).toLocaleDateString() : "—"} />
        </Section>
      </Stack>

      <Divider />

      <Stack direction="row" spacing={4} flexWrap="wrap" useFlexGap>
        <Section title="Invoice (money engine)">
          <Row label="Monthly rent" value={formatPaise(invoice.monthlyRentPaise)} />
          <Row label="Deposit" value={formatPaise(invoice.depositPaise)} />
          <Row label="Token" value={formatPaise(invoice.tokenAmountPaise)} />
          <Row label="Pro-rata 1st month" value={orDash(invoice.proRataFirstMonthRentPaise)} />
          <Row label="Move-in total" value={orDash(invoice.moveInTotalPaise)} />
          <Row label="Balance due" value={orDash(invoice.balanceDuePaise)} />
        </Section>

        <Section title="Net commission (ERP-1)">
          {commission ? (
            <>
              <Row label="Commission" value={formatPaise(commission.commissionPaise)} />
              <Row label="Paid to PG" value={formatPaise(commission.paidToPgPaise)} />
              <Row label="Collected" value={formatPaise(commission.collectedPaise)} />
              <Row label="Net" value={formatSignedPaise(commission.netPaise)} />
              <Chip
                size="small"
                sx={{ alignSelf: "flex-start", mt: 0.5 }}
                color={commission.status === "RECEIVED" ? "success" : "warning"}
                label={commission.status}
              />
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No earned commission until the booking is confirmed-paid.
            </Typography>
          )}
        </Section>
      </Stack>

      <Divider />

      <Section title="KYC">
        {kyc ? (
          <Stack spacing={0.75}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" label={kyc.status} />
              {kyc.submittedAt && (
                <Typography variant="caption" color="text.secondary">
                  Submitted {new Date(kyc.submittedAt).toLocaleDateString()}
                </Typography>
              )}
            </Stack>
            {kyc.rejectReason && (
              <Typography variant="body2" color="error">
                Rejected: {kyc.rejectReason}
              </Typography>
            )}
            {kyc.documents.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No documents.
              </Typography>
            ) : (
              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                {kyc.documents.map((doc) => (
                  <Link key={doc.slot} href={doc.url} target="_blank" rel="noopener" variant="body2">
                    {doc.slot}
                  </Link>
                ))}
              </Stack>
            )}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No KYC record for this customer.
          </Typography>
        )}
      </Section>
    </Stack>
  );
}
