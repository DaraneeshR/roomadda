import { useState, type FormEvent } from "react";
import {
  Button,
  Card,
  CardContent,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { AD_SLOT_TYPES, rupeesToPaise, type AdSlotType } from "@roomadda/shared";
import { adminApi } from "../api/admin";
import { pushToast } from "../lib/toastBus";

export function AdPricingPage() {
  const [slotType, setSlotType] = useState<AdSlotType>("DAY");
  const [rupees, setRupees] = useState("");
  const [isActive, setIsActive] = useState(true);

  const save = useMutation({
    mutationFn: (input: { slotType: AdSlotType; pricePaise: number; isActive: boolean }) =>
      adminApi.putAdPricing(input.slotType, input.pricePaise, input.isActive),
    onSuccess: () => pushToast("Ad pricing saved", "success"),
  });

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const value = Number(rupees);
    if (!Number.isFinite(value) || value <= 0) {
      pushToast("Enter a positive price in rupees");
      return;
    }
    save.mutate({ slotType, pricePaise: rupeesToPaise(value), isActive });
  };

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Ad pricing
      </Typography>
      <Card sx={{ maxWidth: 460 }}>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <TextField
                select
                label="Slot type"
                value={slotType}
                onChange={(e) => setSlotType(e.target.value as AdSlotType)}
              >
                {AD_SLOT_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Price (₹ rupees)"
                value={rupees}
                onChange={(e) => setRupees(e.target.value)}
                slotProps={{ htmlInput: { inputMode: "decimal" } }}
              />
              <FormControlLabel
                control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}
                label="Active"
              />
              <Button type="submit" variant="contained" disabled={save.isPending}>
                Save pricing
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
