import type { UserRole } from "@prisma/client";
import { env, isProduction } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Real-time chat transport, behind an interface so it is stubbable in dev/tests
 * and swappable per environment — the same Live/Stub pattern as razorpay.ts /
 * sms.ts / storage.ts. Production delivers via Firebase (Firestore for the live
 * stream + offline queue, FCM for push), per the PRD.
 *
 * IMPORTANT: this is the DELIVERY layer only. Authorization (participants,
 * cancelled-booking gate), the NO-phone-numbers rule, and the durable AUDIT
 * MIRROR all happen in the chat service against Postgres BEFORE we publish here
 * (see /CLAUDE.md — the client is never trusted). Publishing is best-effort and
 * post-commit: a transport failure never loses the message (it is already
 * mirrored and re-fetchable via the history endpoint / Firestore offline sync).
 */
export interface ChatMessagePayload {
  conversationId: string;
  messageId: string;
  senderId: string;
  senderRole: UserRole;
  kind: "TEXT" | "PHOTO";
  /** Text body (null for a photo). NEVER contains a phone number (rejected upstream). */
  body: string | null;
  /** A short-lived viewable URL for a photo message (null for text). */
  photoUrl: string | null;
  createdAt: string;
}

export interface ChatRecipient {
  userId: string;
  fcmTokens: string[];
}

export interface ChatTransport {
  /** Stream a mirrored message to participants (Firestore) and push (FCM). */
  publishMessage(payload: ChatMessagePayload, recipients: ChatRecipient[]): Promise<void>;
  /** Ephemeral typing indicator (Firestore only — never mirrored/persisted). */
  publishTyping(conversationId: string, userId: string, isTyping: boolean): Promise<void>;
}

/** Dev/test transport: logs intent only (no Firebase). Messages still mirror to Postgres. */
class StubChatTransport implements ChatTransport {
  publishMessage(payload: ChatMessagePayload): Promise<void> {
    logger.info({ conversationId: payload.conversationId, messageId: payload.messageId, kind: payload.kind }, "chat publish (stub — Firebase not wired)");
    return Promise.resolve();
  }

  publishTyping(): Promise<void> {
    return Promise.resolve();
  }
}

// Minimal shape of the parts of firebase-admin we use. The real types come from
// the dependency in prod; kept loose here so the build never requires it.
/* eslint-disable @typescript-eslint/no-explicit-any -- firebase-admin handles are loaded dynamically; full types only ship in prod */
interface FirebaseAdminLike {
  apps: unknown[];
  app(): unknown;
  initializeApp(opts: unknown): unknown;
  credential: { cert(opts: unknown): unknown };
  firestore(app?: unknown): any;
  messaging(app?: unknown): any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Live transport: Firestore documents + FCM multicast. firebase-admin is
 * imported dynamically (the specifier is widened to `string` so the build does
 * NOT statically require the dependency); it is installed and used only in prod.
 */
class FirebaseChatTransport implements ChatTransport {
  private sdkPromise: Promise<{ admin: FirebaseAdminLike; app: unknown }> | null = null;

  private async sdk(): Promise<{ admin: FirebaseAdminLike; app: unknown }> {
    if (!this.sdkPromise) {
      this.sdkPromise = (async () => {
        const specifier = "firebase-admin" as string;
        const admin = (await import(specifier)) as FirebaseAdminLike;
        const app = admin.apps.length
          ? admin.app()
          : admin.initializeApp({
              credential: admin.credential.cert({
                projectId: env.FIREBASE_PROJECT_ID,
                clientEmail: env.FIREBASE_CLIENT_EMAIL,
                // Env-stored keys keep literal "\n"; restore real newlines.
                privateKey: env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
              }),
            });
        return { admin, app };
      })();
    }
    return this.sdkPromise;
  }

  async publishMessage(payload: ChatMessagePayload, recipients: ChatRecipient[]): Promise<void> {
    const { admin, app } = await this.sdk();
    await admin
      .firestore(app)
      .collection("conversations")
      .doc(payload.conversationId)
      .collection("messages")
      .doc(payload.messageId)
      .set(payload);

    const tokens = recipients.flatMap((r) => r.fcmTokens);
    if (tokens.length > 0) {
      await admin.messaging(app).sendEachForMulticast({
        tokens,
        notification: { title: "New message", body: payload.kind === "TEXT" ? (payload.body ?? "") : "Sent a photo" },
        data: { conversationId: payload.conversationId, messageId: payload.messageId },
      });
    }
  }

  async publishTyping(conversationId: string, userId: string, isTyping: boolean): Promise<void> {
    const { admin, app } = await this.sdk();
    await admin
      .firestore(app)
      .collection("conversations")
      .doc(conversationId)
      .collection("typing")
      .doc(userId)
      .set({ isTyping, at: Date.now() });
  }
}

const firebaseConfigured = Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);

export const chatTransport: ChatTransport =
  isProduction && firebaseConfigured ? new FirebaseChatTransport() : new StubChatTransport();
