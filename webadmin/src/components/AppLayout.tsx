import {
  AppBar,
  Box,
  Button,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Toolbar,
  Typography,
} from "@mui/material";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

const DRAWER_WIDTH = 230;

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

interface NavSection {
  heading: string;
  items: NavItem[];
}

/**
 * The sidebar as an ordered list of headed sections. Grouping (over one flat
 * list) keeps the growing surface navigable and gives each area a natural seam
 * to role-gate later — a section can be filtered out by role without touching
 * the pages it points at.
 */
const NAV_SECTIONS: NavSection[] = [
  {
    heading: "Overview",
    items: [{ to: "/", label: "Dashboard", end: true }],
  },
  {
    heading: "Governance",
    items: [
      { to: "/kyc", label: "KYC review" },
      { to: "/listings", label: "Listings review" },
      { to: "/users", label: "Users & roles" },
      { to: "/hosts", label: "Hosts" },
      { to: "/agents", label: "Agents" },
      { to: "/service-requests", label: "Service requests" },
      { to: "/trust-featured", label: "Trust & Featured" },
      { to: "/cms", label: "CMS & SEO" },
      { to: "/broadcasts", label: "Broadcasts" },
    ],
  },
  {
    heading: "Operations",
    items: [
      { to: "/bookings", label: "Bookings" },
      { to: "/payments", label: "Payments" },
      { to: "/cash", label: "Cash reconciliation" },
      { to: "/ads", label: "Ads approval" },
      { to: "/ad-pricing", label: "Ad pricing" },
    ],
  },
  {
    heading: "Finance / ERP",
    items: [
      { to: "/erp", label: "ERP dashboard", end: true },
      { to: "/erp/bookings", label: "Bookings ledger" },
      { to: "/erp/approvals", label: "Approvals" },
      { to: "/erp/invoices", label: "Invoice center" },
      { to: "/erp/money", label: "Money manager" },
      { to: "/erp/agents-finance", label: "Agents (finance)" },
      { to: "/erp/ca", label: "CA & compliance" },
      { to: "/erp/settings", label: "Settings" },
    ],
  },
  {
    heading: "Corporate",
    items: [
      { to: "/corporate", label: "Companies", end: true },
      { to: "/corporate/pipeline", label: "Sales pipeline" },
      { to: "/corporate/bookings", label: "Bookings" },
      { to: "/corporate/finance", label: "Finance" },
    ],
  },
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
        <Box sx={{ overflow: "auto" }}>
          {NAV_SECTIONS.map((section) => (
            <List
              key={section.heading}
              dense
              subheader={
                <ListSubheader disableSticky sx={{ bgcolor: "transparent", lineHeight: "2.2em" }}>
                  {section.heading}
                </ListSubheader>
              }
            >
              {section.items.map((item) => (
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
          ))}
        </Box>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: 3, width: `calc(100% - ${DRAWER_WIDTH}px)` }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
