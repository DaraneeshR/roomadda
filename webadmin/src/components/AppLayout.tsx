import {
  AppBar,
  Box,
  Button,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  Toolbar,
  Typography,
} from "@mui/material";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

const DRAWER_WIDTH = 230;

const NAV_ITEMS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/kyc", label: "KYC review" },
  { to: "/listings", label: "Listings review" },
  { to: "/bookings", label: "Bookings" },
  { to: "/payments", label: "Payments" },
  { to: "/cash", label: "Cash reconciliation" },
  { to: "/ads", label: "Ads approval" },
  { to: "/ad-pricing", label: "Ad pricing" },
  { to: "/users", label: "Users & roles" },
  { to: "/hosts", label: "Hosts" },
  { to: "/agents", label: "Agents" },
  { to: "/service-requests", label: "Service requests" },
  { to: "/trust-featured", label: "Trust & Featured" },
  { to: "/cms", label: "CMS & SEO" },
  { to: "/broadcasts", label: "Broadcasts" },
];

export function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <Box sx={{ display: "flex" }}>
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            RoomAdda Admin
          </Typography>
          <Typography variant="body2" sx={{ mr: 2, opacity: 0.85 }}>
            {user?.phone}
          </Typography>
          <Button color="inherit" onClick={() => void logout()}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" },
        }}
      >
        <Toolbar />
        <List>
          {NAV_ITEMS.map((item) => (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              end={item.end}
              sx={{ "&.active": { bgcolor: "action.selected", fontWeight: 600 } }}
            >
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: 3, width: `calc(100% - ${DRAWER_WIDTH}px)` }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
