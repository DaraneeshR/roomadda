import { useState, type FormEvent } from "react";
import { Alert, Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { USER_ROLES, type UserRole } from "@roomadda/shared";
import { adminApi } from "../api/admin";
import { pushToast } from "../lib/toastBus";

export function UsersRolesPage() {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<UserRole>("HOST");

  const change = useMutation({
    mutationFn: (input: { userId: string; role: UserRole }) => adminApi.changeUserRole(input.userId, input.role),
    onSuccess: () => pushToast("Role updated", "success"),
  });

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!userId.trim()) {
      pushToast("Enter a user id");
      return;
    }
    change.mutate({ userId: userId.trim(), role });
  };

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Users &amp; roles
      </Typography>
      <Alert severity="info" sx={{ mb: 2, maxWidth: 460 }}>
        Change a user&apos;s role by id. A searchable user directory needs a backend
        list endpoint (not yet available).
      </Alert>
      <Card sx={{ maxWidth: 460 }}>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <TextField label="User id (uuid)" value={userId} onChange={(e) => setUserId(e.target.value)} />
              <TextField select label="Role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                {USER_ROLES.map((r) => (
                  <MenuItem key={r} value={r}>
                    {r}
                  </MenuItem>
                ))}
              </TextField>
              <Button type="submit" variant="contained" disabled={change.isPending}>
                Change role
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
