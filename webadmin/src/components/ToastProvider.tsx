import { useEffect, useState, type ReactNode } from "react";
import { Alert, Snackbar } from "@mui/material";
import { subscribeToast, type ToastMessage } from "../lib/toastBus";

/** Renders global toasts (incl. query/mutation errors) from the toast bus. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(
    () =>
      subscribeToast((next) => {
        setToast(next);
        setOpen(true);
      }),
    [],
  );

  return (
    <>
      {children}
      {toast && (
        <Snackbar
          key={toast.id}
          open={open}
          autoHideDuration={5000}
          onClose={() => setOpen(false)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        >
          <Alert severity={toast.severity} variant="filled" onClose={() => setOpen(false)} sx={{ width: "100%" }}>
            {toast.message}
          </Alert>
        </Snackbar>
      )}
    </>
  );
}
