# RoomAdda — SOS Safety-Alert Verification Runbook

A **manual** runbook a human follows on a **real device** against a **staging**
backend with **live MSG91 keys**. SOS is a safety feature: "the unit tests pass"
is **not** proof. This drill proves the only thing that matters in an emergency —

> Triggering SOS delivers a **real SMS to a real trusted-contact phone** carrying
> the user's **live GPS location**, **and** raises a **real alert on the ops
> channel** the on-call team actually watches.

The endpoint's JSON response (`{"contactsNotified":N,"adminAlerted":true}`) only
says the code *ran* — it is **not** evidence of delivery. This runbook is
"passed" only when a human **sees the SMS arrive on a handset** and **sees the
ops alert land** in the ops channel. Record every step in the
[Sign-off checklist](#6-sign-off-checklist).

Reference code: [safety.service.ts](../../backend/src/modules/safety/safety.service.ts),
[safety-notify.ts](../../backend/src/lib/safety-notify.ts),
[sms.ts](../../backend/src/lib/sms.ts),
[env.ts](../../backend/src/config/env.ts),
[safety.route.ts](../../backend/src/modules/safety/safety.route.ts).

---

## 0. The configuration trap — read this first

The backend swaps real gateways for in-process stubs based on `NODE_ENV`. In
dev/test, **nothing is actually sent** — it is a logged no-op by design:

| Component | `NODE_ENV=production` | otherwise (`development`/`test`) |
|---|---|---|
| Contact SMS ([sms.ts](../../backend/src/lib/sms.ts)) | **Msg91SmsSender** — real SMS to each trusted contact | `DevSmsSender` — logs `DEV_SOS …`, **no SMS** |
| Ops alert ([safety-notify.ts](../../backend/src/lib/safety-notify.ts)) | **LiveSafetyNotifier** — real ops SMS list + ops webhook | `StubSafetyNotifier` — logs `SOS admin alert (stub …)`, **no send** |

**Consequence:** this drill is meaningful **only** with `NODE_ENV=production`.
Running staging in `development` to read logs proves nothing about delivery.

**Boot guard.** With `NODE_ENV=production`, the server **refuses to start**
unless at least one ops channel is configured (`SOS_OPS_SMS_NUMBERS` and/or
`SOS_OPS_WEBHOOK_URL`) — see the `superRefine` in
[env.ts](../../backend/src/config/env.ts). A safety feature must not boot
silently un-wired.

---

## 1. Backend on staging (live keys)

**Goal:** a public HTTPS staging backend with `NODE_ENV=production`, real MSG91,
and a real ops channel, readiness green.

### 1.1 Environment

Set these (validated at boot — a missing/invalid var aborts the process):

```
NODE_ENV=production
DATABASE_URL=postgres://…
REDIS_URL=redis://…
JWT_ACCESS_SECRET=…                # ≥ 32 chars
JWT_REFRESH_SECRET=…               # ≥ 32 chars
RAZORPAY_KEY_ID=…                  # any valid pair (boot only; not used by SOS)
RAZORPAY_KEY_SECRET=…
RAZORPAY_WEBHOOK_SECRET=…

# ---- Contact SMS path (trusted contacts) ----
MSG91_AUTH_KEY=…                   # live authkey
MSG91_SOS_TEMPLATE_ID=…            # approved SOS-to-contact template (vars: name,user,location)
MSG91_SENDER_ID=…                  # if your template requires it

# ---- Ops alert path (at least ONE; both for redundancy) ----
SOS_OPS_SMS_NUMBERS=+9198xxxxxxxx,+9197xxxxxxxx   # on-call distribution list (E.164, comma-separated)
MSG91_SOS_OPS_TEMPLATE_ID=…        # required when SOS_OPS_SMS_NUMBERS is set (vars: user,phone,location)
SOS_OPS_WEBHOOK_URL=https://hooks.slack.com/…     # Slack/Teams/PagerDuty incoming webhook
```

> **[MANUAL]** `SOS_OPS_SMS_NUMBERS` / `SOS_OPS_WEBHOOK_URL` are the real ops
> destinations — fill them per environment. Use numbers/channel the on-call team
> actually monitors. The webhook may embed a secret token; the backend never
> logs it.

The two MSG91 templates must be **approved** in the MSG91 panel and their
variable names must match what the sender posts:
- Contact SOS (`sendSos`): `name`, `user`, `location`.
- Ops SOS (`sendOpsSos`): `user`, `phone`, `location`.

### 1.2 Boot + health

- **PASS:** the process boots (proves an ops channel is configured — the guard
  passed), and `/health/ready` → **200** with all checks ok over HTTPS.
- **FAIL:** boot aborts with
  `SOS_OPS_SMS_NUMBERS: In production set SOS_OPS_SMS_NUMBERS and/or
  SOS_OPS_WEBHOOK_URL …` → you have no ops channel; set one and redeploy.

### 1.3 Pre-flight: open the delivery logs you will read

- **MSG91 panel → Reports / Logs** (you will confirm the contact SMS *and* the
  ops SMS were accepted + delivered here, not just "API 200").
- **Ops webhook target** (the Slack/Teams channel or PagerDuty service) open in
  front of you.

---

## 2. Arrange a real trusted contact

Log in on the device as the test tenant (OTP via real SMS, since
`NODE_ENV=production`). Then add **a second real phone you control** as a trusted
contact — this is the handset that must receive the SOS SMS.

On device: **Safety → Trusted contacts → Add**, or at the server boundary:

```bash
curl -s -X POST https://<staging-host>/v1/trusted-contacts \
  -H "Authorization: Bearer <tenant-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Other Phone","phone":"+9198XXXXXXXX"}'

curl -s https://<staging-host>/v1/trusted-contacts \
  -H "Authorization: Bearer <tenant-access-token>" | jq .
```

- **PASS:** the contact is listed (max 3 enforced). The phone is one you can read
  SMS on right now.
- **FAIL:** add returns non-201, or you don't physically have the contact handset.

---

## 3. Trigger a real SOS from the device (with live GPS)

On the device, **grant location permission**, then press the **SOS** button in
the tenant app's Safety feature
([mobile/tenant/lib/features/safety/](../../mobile/tenant/lib/features/safety/)).
The app sends the device's live coordinates. Equivalent at the server boundary
(use the **real** coordinates of where you are standing):

```bash
curl -s -X POST https://<staging-host>/v1/sos \
  -H "Authorization: Bearer <tenant-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"lat":12.9716,"lng":77.5946,"accuracyMeters":12}' -w '\nHTTP %{http_code}\n'
```

- **PASS (endpoint):** HTTP **200**, body `{"contactsNotified":1,"adminAlerted":true}`
  (count = number of trusted contacts). An audit row `action="sos.triggered"`
  exists. **This is necessary, not sufficient — keep going.**
- **FAIL:** non-200, or `contactsNotified` is 0 when you have a contact.

---

## 4. Verify REAL delivery (the actual test)

### 4.1 The trusted-contact handset receives the SMS — with live coords

- **PASS:** within seconds the contact phone gets an SMS that names the user and
  contains a **Google Maps link** `https://maps.google.com/?q=<lat>,<lng>` whose
  coordinates match where you triggered from. Tapping it opens your real
  location. MSG91 Reports shows the message **Delivered** to that number.
- **FAIL:** no SMS on the handset, or the link's coordinates are wrong/absent,
  or MSG91 shows Failed/Rejected (template or sender-id issue).

### 4.2 The ops channel raises a real alert

Confirm **every** configured ops channel fired (one SOS → one alert per channel):

- **Ops SMS list** (`SOS_OPS_SMS_NUMBERS`): each on-call number receives an SMS
  with the user's **name**, **callback number**, and **location**. MSG91 Reports
  shows Delivered.
- **Ops webhook** (`SOS_OPS_WEBHOOK_URL`): a message appears in the Slack/Teams
  channel / a PagerDuty incident is created, reading
  `🚨 SOS from <name> (<phone>). Location: <maps link>. Trusted contacts
  notified: N.`

- **PASS:** at least one ops channel (every configured one) shows a real,
  human-visible alert tied to this trigger, with a working callback number and
  location.
- **FAIL:** nothing reaches ops; or only the endpoint 200 came back with no
  channel firing (re-check §1.1 ops env + MSG91 ops template).

### 4.3 Masking / PII holds (no over-collection)

- **PASS:** the contact SMS carries only contact name + user name + location
  link. The ops alert carries only user name, callback phone, location, and the
  notified-contact count — **nothing else** (no email, no listing data, no raw
  PII beyond what ops needs to respond). Backend **logs** show only ids/counts —
  no phone numbers, no maps link, and **never** the webhook URL.
- **FAIL:** any extra personal data in the message bodies, or PII/secret leaking
  into logs.

---

## 5. Failure drills

### 5.1 No GPS fix → alert still goes out (poor-connectivity safety net)

Deny location on the device (or `POST /v1/sos` with `{}`), then trigger.

- **PASS:** the contact still receives an SMS, with **"Location unavailable"** in
  place of the maps link; the ops alert still fires with `hasLocation=false`. The
  emergency is never dropped just because GPS was missing
  ([safety.service.ts](../../backend/src/modules/safety/safety.service.ts)).
- **FAIL:** no SMS / no ops alert when coordinates are absent.

### 5.2 SMS is the channel (not push)

- **PASS:** delivery to contacts is over **SMS** (works with the screen locked /
  app killed / data off but cellular up). Push is **not** relied upon for the
  contact path.
- **FAIL:** contacts only get a push / in-app notification and no SMS.

### 5.3 One bad contact number doesn't sink the rest *(optional)*

Add a second trusted contact with a deliverable number and trigger.

- **PASS:** a failure delivering to one contact does not stop the others or the
  ops alert (best-effort per leg — [safety.service.ts](../../backend/src/modules/safety/safety.service.ts),
  [safety-notify.ts](../../backend/src/lib/safety-notify.ts)).
- **FAIL:** one failure aborts the whole SOS.

---

## 6. Sign-off checklist

SOS is **verified for launch** only when **every** box is checked on a real
device with live keys.

| # | Step | PASS condition | Result |
|---|---|---|---|
| 1.2 | Boot guard | prod boots only with an ops channel set; readiness 200 | ☐ |
| 2 | Trusted contact | a real handset you control is registered | ☐ |
| 3 | Trigger | `/v1/sos` → 200; `sos.triggered` audited | ☐ |
| 4.1 | Contact SMS | real SMS on the handset with correct live coords; MSG91 Delivered | ☐ |
| 4.2 | Ops alert | every configured ops channel raises a real, human-visible alert | ☐ |
| 4.3 | Masking / logs | only needed fields in messages; no PII/secret in logs | ☐ |
| 5.1 | No-GPS net | contact SMS + ops alert still fire ("Location unavailable") | ☐ |
| 5.2 | SMS channel | contact path delivered via SMS, not push | ☐ |
| 5.3 | Best-effort *(opt)* | one bad contact doesn't block others or ops | ☐ |

**Tester:** ____________  **Date:** ____________  **Staging build / commit:** ____________
