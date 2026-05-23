import axios from "axios";
import { getImpersonationToken, clearImpersonationState } from "../store/impersonationStore";

const getClerkToken = async (): Promise<string | null> => {
  try {
    // @ts-expect-error — window.Clerk is injected by @clerk/react at runtime
    return (await window.Clerk?.session?.getToken()) ?? null;
  } catch {
    return null;
  }
};

export const apiClient = axios.create({
  baseURL: "/api",
  timeout: 15000,
});

apiClient.interceptors.request.use(async (config) => {
  const impersonationToken = getImpersonationToken();
  const token = impersonationToken ?? await getClerkToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const url = err.config?.url ?? "(unknown)";
    const method = (err.config?.method ?? "GET").toUpperCase();
    const body = err.response?.data;
    console.error(
      `[API] ${method} ${url} → ${status ?? "network error"}`,
      body ?? err.message,
      err
    );

    if (
      err.response?.status === 403 &&
      err.response?.data?.error === "readonly_impersonation"
    ) {
      return Promise.reject(err);
    }

    if (err.response?.status === 401) {
      if (getImpersonationToken()) {
        clearImpersonationState();
        window.location.reload();
        return Promise.reject(err);
      }
      // Only redirect to /login if Clerk has no active session.
      // If Clerk is still signed in, the 401 is a transient backend issue — don't loop.
      // @ts-expect-error — window.Clerk injected at runtime
      const hasClerkSession = !!window.Clerk?.session;
      if (!hasClerkSession) {
        window.location.href = "/login";
      }
    }

    if (
      err.response?.status === 404 &&
      err.response?.data?.error === "user workspace not found"
    ) {
      // @ts-expect-error — window.Clerk injected at runtime
      const hasClerkSession = !!window.Clerk?.session;
      if (!hasClerkSession) window.location.href = "/login";
    }

    return Promise.reject(err);
  }
);
