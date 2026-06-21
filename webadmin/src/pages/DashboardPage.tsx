import { Alert, Box, Card, CardActionArea, CardContent, CircularProgress, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { BOOKING_STATUSES, formatPaise, type MetricsDTO } from "@roomadda/shared";
import { adminApi } from "../api/admin";

/** Refetch the snapshot a little after the backend's 30s cache turns over. */
const REFETCH_MS = 30_000;

interface MetricCard {
  title: string;
  value: string;
  to: string;
}

function buildCards(m: MetricsDTO): MetricCard[] {
  return [
    { title: "KYC awaiting review", value: String(m.kycPending), to: "/kyc" },
    { title: "Listings published / total", value: `${m.listings.published} / ${m.listings.total}`, to: "/listings" },
    { title: "Agent cash in hand", value: formatPaise(m.agentCashInHandPaise), to: "/cash" },
    { title: "Ads awaiting approval", value: String(m.adsPendingApproval), to: "/ads" },
    {
      title: "Settled today",
      value: `${m.payments.settledCountToday} · ${formatPaise(m.payments.settledPaiseToday)}`,
      to: "/payments",
    },
  ];
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["metrics"],
    queryFn: adminApi.getMetrics,
    refetchInterval: REFETCH_MS,
  });

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Dashboard
      </Typography>

      {isLoading && <CircularProgress />}
      {isError && <Alert severity="error">Could not load dashboard metrics. Please retry.</Alert>}

      {data && (
        <>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
            {buildCards(data).map((card) => (
              <Card key={card.title} sx={{ flex: "1 1 220px", minWidth: 220 }}>
                <CardActionArea onClick={() => navigate(card.to)}>
                  <CardContent>
                    <Typography color="text.secondary" variant="body2" gutterBottom>
                      {card.title}
                    </Typography>
                    <Typography variant="h3">{card.value}</Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>

          <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
            Bookings by status
          </Typography>
          <Card sx={{ maxWidth: 480 }}>
            <CardActionArea onClick={() => navigate("/bookings")}>
              <CardContent sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                {BOOKING_STATUSES.map((status) => (
                  <Box key={status} sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2" color="text.secondary">
                      {status}
                    </Typography>
                    <Typography variant="body2">{data.bookings[status] ?? 0}</Typography>
                  </Box>
                ))}
              </CardContent>
            </CardActionArea>
          </Card>
        </>
      )}
    </>
  );
}
