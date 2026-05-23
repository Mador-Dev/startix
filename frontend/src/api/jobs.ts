import { apiClient } from "./client";
import type { Job, JobsResponse, TriggerResponse, JobAction } from "../types/api";

export const fetchJobs = async (): Promise<JobsResponse> =>
  (await apiClient.get<JobsResponse>("/agents/jobs")).data;

export const fetchJob = async (jobId: string): Promise<Job> =>
  (await apiClient.get<Job>(`/agents/jobs/${jobId}`)).data;

export const triggerJob = async (
  action: JobAction,
  ticker?: string
): Promise<TriggerResponse> =>
  (await apiClient.post<TriggerResponse>("/agents/jobs/trigger", { action, ticker })).data;

export const cancelJob = async (jobId: string): Promise<{ cancelled: true; job: Job }> =>
  (await apiClient.delete<{ cancelled: true; job: Job }>(`/agents/jobs/${jobId}`)).data;

export const resumeJob = async (jobId: string): Promise<{ resumed: true; job: Job }> =>
  (await apiClient.post<{ resumed: true; job: Job }>(`/agents/jobs/${jobId}/resume`)).data;
