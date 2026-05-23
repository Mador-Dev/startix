import { apiClient } from "./client";
import type { ChannelConnectivity, OnboardStatus, PortfolioResponse, PositionGuidance } from "../types/api";

export const fetchOnboardStatus = async (): Promise<OnboardStatus> =>
 (await apiClient.get<OnboardStatus>("/onboard/status")).data;

export const fetchPortfolio = async (): Promise<PortfolioResponse> =>
 (await apiClient.get<PortfolioResponse>("/portfolio")).data;

export async function connectTelegram(payload: {
  botToken: string;
  telegramChatId: string;
}): Promise<{ connected: boolean; channel: "telegram"; connectivity: ChannelConnectivity }> {
  return (await apiClient.post("/onboard/telegram", payload)).data;
}

export async function disconnectTelegram(): Promise<{
  connected: boolean;
  channel: "telegram";
  connectivity: ChannelConnectivity;
}> {
  return (await apiClient.delete("/onboard/telegram")).data;
}

export async function connectWhatsApp(payload: {
  accessToken: string;
  phoneNumberId: string;
  recipientPhone: string;
}): Promise<{ connected: boolean; channel: "whatsapp"; connectivity: ChannelConnectivity }> {
  return (await apiClient.put("/onboard/whatsapp", payload)).data;
}

export async function disconnectWhatsApp(): Promise<{
  connected: boolean;
  channel: "whatsapp";
  connectivity: ChannelConnectivity;
}> {
  return (await apiClient.delete("/onboard/whatsapp")).data;
}

export const checkNeedsOnboarding = async (): Promise<boolean> => {
  try {
    const status = await fetchOnboardStatus();
    return !status.portfolioLoaded || status.guidanceStepPending;
  } catch {
    return false; // fail open
  }
};

export interface OnboardInitPayload {
  userId: string;
  password?: string;
  displayName: string;
  telegramChatId: string;
  schedule: {
    dailyBriefTime: string;
    weeklyResearchDay: string;
    weeklyResearchTime: string;
    timezone: string;
  };
}

export const submitOnboardInit = async (
  payload: OnboardInitPayload,
  adminKey: string
): Promise<{ userId: string; created: boolean; nextStep: string }> =>
  (
    await apiClient.post("/onboard/init", payload, {
      headers: { "X-Admin-Key": adminKey },
    })
  ).data;

/** Create the backend workspace for the signed-in Clerk user (no admin key). */
export const provisionAccount = async (displayName?: string): Promise<{
  userId: string;
  created: boolean;
  nextStep: string;
}> =>
  (
    await apiClient.post("/onboard/provision", displayName ? { displayName } : {})
  ).data;

export interface PositionEntry {
  id: string;
  ticker: string;
  exchange: "NYSE" | "NASDAQ" | "TASE" | "LSE" | "XETRA" | "EURONEXT" | "OTHER";
  shares: string;
  avgPrice: string;
  currency: "USD" | "ILA" | "GBP" | "EUR";
  account: string; // account name, e.g. "Main", "IBI"
}

export interface PortfolioPosition {
  ticker: string;
  exchange: string;
  shares: number;
  unitAvgBuyPrice: number;
  unitCurrency: "USD" | "ILA" | "GBP" | "EUR";
}

export interface BootstrapStartPayload {
  userId: string;
  displayName?: string;
  accounts: Record<string, PortfolioPosition[]>;
  guidance: Record<string, PositionGuidance>;
  schedule: {
    dailyBriefTime: string;
    weeklyResearchDay: string;
    weeklyResearchTime: string;
    timezone: string;
  };
  currency: "ILS";
  transactionFeeILS: number;
  note: string;
}

export const submitPortfolio = async (payload: {
  meta: { currency: string; transactionFeeILS: number; note: string };
  accounts: Record<string, PortfolioPosition[]>;
  schedule?: {
    dailyBriefTime: string;
    weeklyResearchDay: string;
    weeklyResearchTime: string;
    timezone: string;
  };
}): Promise<{ state: string; nextStep: string; guidanceStepPending: boolean; message: string }> =>
  (await apiClient.post("/onboard/portfolio", payload)).data;

export async function fetchPositionGuidance(): Promise<{
  status: "not_started" | "pending" | "completed" | "skipped";
  tickers: string[];
  guidance: Record<string, PositionGuidance>;
}> {
  return (await apiClient.get("/onboard/position-guidance")).data;
}

export async function completePositionGuidance(payload: {
  skip?: boolean;
  guidance?: Record<string, PositionGuidance>;
}): Promise<{ state: string; jobId?: string; message: string; guidanceStepPending: boolean }> {
  return (await apiClient.post("/onboard/position-guidance/complete", payload)).data;
}

export async function startBootstrap(
  payload: BootstrapStartPayload
): Promise<{ jobId: string; status: string; totalTickers: number }> {
  return (await apiClient.post("/agents/bootstrap/start", payload)).data;
}
