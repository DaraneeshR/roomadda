import { Box, CircularProgress } from "@mui/material";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

/** Gate: every child route requires an authenticated ADMIN, else -> /login. */
export function ProtectedRoute() {
  const { status, user } = useAuth();

  if (status === "loading") {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (status !== "authenticated" || user?.role !== "ADMIN") {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
