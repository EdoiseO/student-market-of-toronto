export const MESSAGE_SEND_RPC_MAX_ATTEMPTS = 2;

export function isAmbiguousMessageMutationError(error) {
  if (!error) {
    return false;
  }

  const status = Number(error.status ?? error.statusCode ?? 0);
  const code = String(error.code ?? "").toUpperCase();
  const name = String(error.name ?? "").toLowerCase();
  const message = String(error.message ?? "").toLowerCase();

  if (status >= 500 || status === 0 && (name === "typeerror" || !code)) {
    return true;
  }

  return (
    code === "PGRST000" ||
    code === "PGRST001" ||
    code === "FETCH_ERROR" ||
    message.includes("failed to fetch") ||
    message.includes("network request failed") ||
    message.includes("load failed")
  );
}

export function isStorageObjectAlreadyPresent(error) {
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  const message = String(error?.message ?? "").toLowerCase();

  return (
    status === 409 ||
    message.includes("already exists") ||
    message.includes("duplicate") ||
    message.includes("resource already exists")
  );
}

export async function callMessageMutationWithReplay(
  call,
  { maxAttempts = MESSAGE_SEND_RPC_MAX_ATTEMPTS } = {},
) {
  let latest = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      latest = await call();
    } catch (error) {
      latest = { data: null, error };
    }

    if (!latest?.error || !isAmbiguousMessageMutationError(latest.error)) {
      return {
        data: latest?.data ?? null,
        error: latest?.error ?? null,
        ambiguous: false,
        attempts: attempt,
      };
    }
  }

  return {
    data: latest?.data ?? null,
    error: latest?.error ?? new Error("Message operation response was unavailable."),
    ambiguous: true,
    attempts: maxAttempts,
  };
}

export function getMessageOperationOutcome(data) {
  const value = Array.isArray(data) ? data[0] : data;

  if (value?.status === "completed") {
    return { status: "completed", message: value.result ?? null };
  }

  if (value?.status === "aborted") {
    return {
      status: "aborted",
      message: null,
      storagePaths: value.result?.storage_paths ?? value.storage_paths ?? [],
    };
  }

  return { status: "completed", message: value ?? null };
}

export function createMessageSendOperationId(randomUUID = () => crypto.randomUUID()) {
  return randomUUID();
}

