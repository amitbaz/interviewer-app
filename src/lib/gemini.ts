const defaultModel = "gemini-3.6-flash";

/** Returns a normalized Gemini model ID and rejects unsafe path fragments. */
export function geminiModel(): string {
  const configured = process.env.GEMINI_MODEL?.trim();
  const normalized = (configured || defaultModel).replace(/^models\//, "");
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(normalized)) {
    throw new Error("GEMINI_MODEL must be a Gemini model ID such as gemini-3.6-flash.");
  }
  return normalized;
}

function sanitizedProviderMessage(message: string): string {
  let safe = message.replace(/\b(key|api[_-]?key)=([^\s&,]+)/gi, "$1=[redacted]");
  const configuredKey = process.env.GEMINI_API_KEY;
  if (configuredKey) safe = safe.replaceAll(configuredKey, "[redacted]");
  return safe.replace(/AIza[\w-]+/g, "[redacted]").slice(0, 280).trim();
}

async function providerMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: unknown } };
    return typeof body.error?.message === "string" ? sanitizedProviderMessage(body.error.message) : "";
  } catch {
    return "";
  }
}

/** Converts a failed Gemini response into an actionable error without exposing credentials. */
export async function geminiRequestError(
  response: Response,
  operation: string,
  model: string,
): Promise<Error> {
  const detail = await providerMessage(response);
  const suffix = detail ? `: ${detail}` : ".";
  if (response.status === 400) return new Error(`Gemini rejected ${operation} (400)${suffix}`);
  if (response.status === 401 || response.status === 403) {
    return new Error(`Gemini authentication failed for ${operation} (${response.status})${suffix} Check GEMINI_API_KEY and its API restrictions.`);
  }
  if (response.status === 404) {
    return new Error(`Gemini model "${model}" is unavailable for ${operation} (404)${suffix} Check GEMINI_MODEL.`);
  }
  if (response.status === 429) {
    return new Error(`Gemini rate limit reached for ${operation} (429)${suffix} Wait briefly and try again.`);
  }
  if (response.status >= 500) {
    return new Error(`Gemini is temporarily unavailable for ${operation} (${response.status})${suffix} Try again shortly.`);
  }
  return new Error(`Gemini request failed for ${operation} (${response.status})${suffix}`);
}
