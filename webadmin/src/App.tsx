import { createTheme, CssBaseline, ThemeProvider } from "@mui/material";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ToastProvider } from "./components/ToastProvider";
import { AuthProvider } from "./auth/AuthProvider";
import { queryClient } from "./lib/queryClient";
import { AdPricingPage } from "./pages/AdPricingPage";
import { AdsApprovalPage } from "./pages/AdsApprovalPage";
import { AgentsPage } from "./pages/AgentsPage";
import { BookingsPage } from "./pages/BookingsPage";
import { BroadcastsPage } from "./pages/BroadcastsPage";
import { CashReconciliationPage } from "./pages/CashReconciliationPage";
import { CmsPage } from "./pages/CmsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ErpApprovalsPage } from "./pages/ErpApprovalsPage";
import { ErpBookingsPage } from "./pages/ErpBookingsPage";
import { ErpDashboardPage } from "./pages/ErpDashboardPage";
import { HostsPage } from "./pages/HostsPage";
import { KycReviewPage } from "./pages/KycReviewPage";
import { ListingsReviewPage } from "./pages/ListingsReviewPage";
import { LoginPage } from "./pages/LoginPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { ServiceRequestsPage } from "./pages/ServiceRequestsPage";
import { TrustFeaturedPage } from "./pages/TrustFeaturedPage";
import { UsersRolesPage } from "./pages/UsersRolesPage";

const theme = createTheme({ palette: { mode: "light" } });

export function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <ToastProvider>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route element={<ProtectedRoute />}>
                    <Route element={<AppLayout />}>
                      <Route path="/" element={<DashboardPage />} />
                      <Route path="/kyc" element={<KycReviewPage />} />
                      <Route path="/listings" element={<ListingsReviewPage />} />
                      <Route path="/bookings" element={<BookingsPage />} />
                      <Route path="/payments" element={<PaymentsPage />} />
                      <Route path="/cash" element={<CashReconciliationPage />} />
                      <Route path="/ads" element={<AdsApprovalPage />} />
                      <Route path="/ad-pricing" element={<AdPricingPage />} />
                      <Route path="/users" element={<UsersRolesPage />} />
                      <Route path="/hosts" element={<HostsPage />} />
                      <Route path="/agents" element={<AgentsPage />} />
                      <Route path="/service-requests" element={<ServiceRequestsPage />} />
                      <Route path="/trust-featured" element={<TrustFeaturedPage />} />
                      <Route path="/cms" element={<CmsPage />} />
                      <Route path="/broadcasts" element={<BroadcastsPage />} />
                      <Route path="/erp" element={<ErpDashboardPage />} />
                      <Route path="/erp/bookings" element={<ErpBookingsPage />} />
                      <Route path="/erp/approvals" element={<ErpApprovalsPage />} />
                    </Route>
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </ToastProvider>
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
