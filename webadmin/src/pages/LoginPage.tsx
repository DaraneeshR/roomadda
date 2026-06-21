import { useState, type FormEvent } from "react";
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from "@mui/material";
import { Navigate } from "react-router-dom";
import { e164Schema } from "@roomadda/shared";
import { useAuth } from "../auth/AuthProvider";
import { authApi } from "../api/auth";
import { ApiError } from "../lib/apiClient";

export function LoginPage() {
  const { status, login } = useAuth();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "authenticated") return <Navigate to="/" replace />;

  const handleRequest = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const parsed = e164Schema.safeParse(phone);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid phone");
      return;
    }
    setBusy(true);
    try {
      await authApi.requestOtp(phone);
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send code");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(phone, code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <Card sx={{ width: 380 }}>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            RoomAdda Admin
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Sign in with your administrator phone number.
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {step === "phone" ? (
            <form onSubmit={handleRequest}>
              <Stack spacing={2}>
                <TextField
                  label="Phone (E.164)"
                  placeholder="+919876543210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  fullWidth
                  autoFocus
                />
                <Button type="submit" variant="contained" disabled={busy}>
                  Send code
                </Button>
              </Stack>
            </form>
          ) : (
            <form onSubmit={handleVerify}>
              <Stack spacing={2}>
                <TextField
                  label="6-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  fullWidth
                  autoFocus
                  slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 6 } }}
                />
                <Button type="submit" variant="contained" disabled={busy}>
                  Verify &amp; sign in
                </Button>
                <Button onClick={() => setStep("phone")} disabled={busy}>
                  Use a different number
                </Button>
              </Stack>
            </form>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
