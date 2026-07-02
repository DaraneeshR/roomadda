"use client";

import { useEffect, useState, type FormEvent } from "react";
import { USER_GENDERS, e164Schema, type SelfUser, type UserGender } from "@roomadda/shared";
import { apiFetch, setAccessToken, type Session } from "../../lib/authClient";

/**
 * Non-blocking login/register modal. Discovery stays fully usable behind it — it
 * is only opened on demand (a "Log in" click or a gated action). Auth is the same
 * mobile-OTP flow the apps use, so a web login resolves to the SAME phone-keyed
 * account. Google Sign-In is intentionally deferred (see the disabled button).
 */
type Step = "phone" | "otp" | "profile";

interface Props {
  open: boolean;
  onClose: () => void;
  onAuthenticated: (session: Session) => void;
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500";

const GENDER_LABELS: Record<UserGender, string> = {
  MALE: "Male",
  FEMALE: "Female",
  UNDISCLOSED: "Prefer not to say",
};

export function AuthModal({ open, onClose, onAuthenticated }: Props): React.ReactNode {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("+91");
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState<UserGender>("UNDISCLOSED");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  // Session issued at OTP verify, held until the profile step completes.
  const [pending, setPending] = useState<Session | null>(null);

  // Reset to a clean state each time the modal opens.
  useEffect(() => {
    if (open) {
      setStep("phone");
      setPhone("+91");
      setCode("");
      setFullName("");
      setGender("UNDISCLOSED");
      setBusy(false);
      setError(null);
      setResendIn(0);
      setPending(null);
    }
  }, [open]);

  // Resend cooldown ticker (the backend enforces ~30s; this just guides the UI).
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  if (!open) return null;

  const phoneValid = e164Schema.safeParse(phone).success;

  async function requestOtp(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        setError(await messageFrom(res, "Could not send the code. Please try again."));
        return;
      }
      setStep("otp");
      setResendIn(30);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      if (!res.ok) {
        setError(await messageFrom(res, "That code is incorrect or has expired."));
        return;
      }
      const data = (await res.json()) as Session & { needsProfile: boolean };
      const session: Session = { accessToken: data.accessToken, user: data.user };
      if (data.needsProfile) {
        // Make the token usable for the PATCH /me profile call, then collect
        // name + gender. The user is already authenticated at this point.
        setAccessToken(session.accessToken);
        setPending(session);
        setStep("profile");
      } else {
        onAuthenticated(session);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(): Promise<void> {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: fullName.trim(), gender }),
      });
      if (!res.ok) {
        setError(await messageFrom(res, "Could not save your details. Please try again."));
        return;
      }
      const { user } = (await res.json()) as { user: SelfUser };
      onAuthenticated({ accessToken: pending.accessToken, user });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Closing during the profile step still finalizes the login (the account
  // exists); the user can complete their profile later from their account.
  function handleClose(): void {
    if (step === "profile" && pending) {
      onAuthenticated(pending);
      return;
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 id="auth-modal-title" className="text-lg font-semibold text-slate-900">
            {step === "profile" ? "Tell us about you" : "Log in or sign up"}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        {step === "phone" && (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (phoneValid && !busy) void requestOtp();
            }}
          >
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="auth-phone">
              Mobile number
            </label>
            <input
              id="auth-phone"
              className={inputClass}
              inputMode="tel"
              autoComplete="tel"
              placeholder="+91XXXXXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              We&apos;ll text you a 6-digit code. Same number as the RoomAdda app.
            </p>
            <button
              type="submit"
              disabled={!phoneValid || busy}
              className="mt-4 w-full rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send code"}
            </button>

            <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              or
              <span className="h-px flex-1 bg-slate-200" />
            </div>
            {/* TODO(auth): enable once a backend Firebase/Google token-exchange
                endpoint exists that resolves to the SAME phone-keyed account
                (Google identifies by email, not phone). Deferred by decision. */}
            <button
              type="button"
              disabled
              title="Coming soon"
              className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-400"
            >
              Continue with Google
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                Soon
              </span>
            </button>
          </form>
        )}

        {step === "otp" && (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (code.length === 6 && !busy) void verifyOtp();
            }}
          >
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="auth-otp">
              Enter the code sent to {phone}
            </label>
            <input
              id="auth-otp"
              className={`${inputClass} tracking-[0.4em]`}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <button
              type="submit"
              disabled={code.length !== 6 || busy}
              className="mt-4 w-full rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Verify & continue"}
            </button>
            <div className="mt-3 flex justify-between text-xs text-slate-500">
              <button
                type="button"
                onClick={() => setStep("phone")}
                className="hover:text-teal-700"
              >
                ← Change number
              </button>
              <button
                type="button"
                disabled={resendIn > 0 || busy}
                onClick={() => void requestOtp()}
                className="hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
              </button>
            </div>
          </form>
        )}

        {step === "profile" && (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (fullName.trim() && !busy) void saveProfile();
            }}
          >
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="auth-name">
              Full name
            </label>
            <input
              id="auth-name"
              className={inputClass}
              autoComplete="name"
              placeholder="Your name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <label className="mb-1 mt-4 block text-sm font-medium text-slate-700" htmlFor="auth-gender">
              Gender
            </label>
            <p className="mb-1 text-xs text-slate-500">Used to match you with suitable PGs.</p>
            <select
              id="auth-gender"
              className={inputClass}
              value={gender}
              onChange={(e) => setGender(e.target.value as UserGender)}
            >
              {USER_GENDERS.map((g) => (
                <option key={g} value={g}>
                  {GENDER_LABELS[g]}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={!fullName.trim() || busy}
              className="mt-4 w-full rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Saving…" : "Finish"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Pull the backend's safe error message out of a failed BFF response. */
async function messageFrom(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}
