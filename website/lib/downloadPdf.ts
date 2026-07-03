/**
 * Fetch a PDF from a same-origin BFF route WITH the in-memory access token, then
 * trigger a browser download. A plain <a download> can't be used because the
 * bearer must be attached (the receipt endpoints are auth-gated), so we fetch the
 * blob and save it. Browser-only. Returns an error message, or null on success.
 */
export async function downloadPdf(
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>,
  url: string,
  filename: string,
): Promise<string | null> {
  try {
    const res = await apiFetch(url);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return body.message ?? "The document isn't ready yet.";
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
    return null;
  } catch {
    return "Could not download the document.";
  }
}
