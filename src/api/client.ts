export async function apiRequest<T>(
  url: string,
  userId: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user-id': userId,
    ...(options.headers as Record<string, string> | undefined),
  };

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { error: text };
  }

  if (!res.ok) {
    const errObj = parsed as {
      error?: string;
      code?: string;
      projectedBalance?: number;
      creditLimit?: number;
      attemptsRemaining?: number;
    } | null;
    const error = new Error(errObj?.error || `Request failed (${res.status})`) as Error & {
      status?: number;
      code?: string;
      projectedBalance?: number;
      creditLimit?: number;
      attemptsRemaining?: number;
      payload?: any;
    };
    error.status = res.status;
    error.code = errObj?.code;
    error.projectedBalance = errObj?.projectedBalance;
    error.creditLimit = errObj?.creditLimit;
    error.attemptsRemaining = errObj?.attemptsRemaining;
    error.payload = parsed;
    throw error;
  }

  return parsed as T;
}
