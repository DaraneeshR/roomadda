# RoomAdda Mobile (Flutter)

Role-based app (TENANT / HOST / AGENT) on one codebase. Standalone — **not** part
of the pnpm/Turborepo workspace.

## Architecture

Feature-first, with cross-cutting concerns in `core/`:

```
lib/
├─ core/
│  ├─ config/      Env (--dart-define + flutter_dotenv, dev/prod base URLs)
│  ├─ money/       Paise — integer-only money + INR formatter (never double)
│  ├─ auth/        models, secure token store, session, repository, controller, state
│  ├─ network/     dio + auth interceptor (attach/refresh/logout) + error interceptor
│  ├─ error/       CrashReporter (Firebase Crashlytics, guarded) + AppErrorWidget
│  ├─ theme/       Material 3 theme
│  ├─ router/      go_router with auth-aware redirects + role shells
│  └─ providers.dart   Riverpod providers
└─ features/
   ├─ auth/        splash + OTP login
   ├─ tenant/ host/ agent/   per-role shells
   └─ booking/     {domain, data, presentation} — token payment (Razorpay)
```

## Auth & tokens

- Login is OTP (`/v1/auth/otp/request` → `/v1/auth/otp/verify` with `client: mobile`).
- Access **and** refresh tokens live ONLY in `flutter_secure_storage` (Keystore /
  Keychain) — never SharedPreferences.
- The dio interceptor attaches the access token, refreshes on 401 (single-flight)
  using the stored refresh token, retries once, and logs out on refresh failure.
- After login the app routes to the Tenant/Host/Agent shell based on the role
  from `/v1/me`.

## Payments (token leg)

The Razorpay SDK success callback is **UI-only**. The app moves to "awaiting
confirmation" and polls the backend for the real booking status — the server
**webhook** confirms the booking; the app never self-confirms.

## Run

```bash
flutter pub get

# Android emulator (10.0.2.2 = host localhost where the backend runs on :3001)
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001 --dart-define=APP_ENV=dev

flutter analyze
flutter test
```

Env can also come from a `.env` file (copy `.env.example`, then list it under
`flutter: assets:` in `pubspec.yaml`). No secrets are committed.

## Setup still required (platform config)

- **Firebase Crashlytics**: run `flutterfire configure` to generate
  `firebase_options.dart` + platform config. Until then `CrashReporter` runs in a
  guarded/disabled mode (errors are logged locally; the app still runs).
- **Razorpay**: Android needs `minSdkVersion 19+` and the proguard rules from the
  `razorpay_flutter` docs; iOS needs the usual pod setup.

## Backend dependency

The booking-status poll calls `GET /v1/boo

kings/:id` (tenant-scoped). The backend
service has `bookingService.getForTenant` but does not yet expose that route —
add it so the payment screen can read the webhook-confirmed status.
