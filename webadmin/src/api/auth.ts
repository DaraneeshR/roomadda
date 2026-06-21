import { sessionResponseSchema, type SessionResponse } from "@roomadda/shared";
import { api } from "../lib/api";

export const authApi = {
  requestOtp: (phone: string) =>
    api.post<{ status: string; expiresInSeconds: number }>("/v1/auth/otp/request", { phone }),

  /** Verify the OTP; the backend sets the httpOnly refresh cookie (web client). */
  verify: async (phone: string, code: string): Promise<SessionResponse> => {
    const data = await api.post<unknown>("/v1/auth/otp/verify", { phone, code, client: "web" });
    const session = sessionResponseSchema.parse(data);
    api.setAccessToken(session.accessToken);
    return session;
  },

  logout: async (): Promise<void> => {
    try {
      await api.post("/v1/auth/logout", {});
    } finally {
      api.setAccessToken(null);
    }
  },
};
