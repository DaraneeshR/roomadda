import { createApiClient } from "./apiClient";
import { env } from "./env";

/** The single API client instance for the app. */
export const api = createApiClient(env.apiUrl);
