import axios from "axios";

const getClerkToken = async (): Promise<string | null> => {
  try {
    // @ts-expect-error — window.Clerk injected at runtime by @clerk/react
    return (await window.Clerk?.session?.getToken()) ?? null;
  } catch {
    return null;
  }
};

const baseURL =
  (import.meta.env.VITE_AGENTS_API_BASE_URL as string | undefined)?.trim() ||
  "http://localhost:8090/api";

export const agentsApiClient = axios.create({
  baseURL,
  timeout: 30000,
});

agentsApiClient.interceptors.request.use(async (config) => {
  const token = await getClerkToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

agentsApiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    // Don't redirect to /login on 401 from the agents service — it may not use Clerk auth.
    // Let callers handle the error gracefully.
    return Promise.reject(err);
  }
);
