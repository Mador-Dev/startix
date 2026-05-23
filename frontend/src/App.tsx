import { useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useAuthStore } from "./store/authStore";
import { BottomNav } from "./components/ui/BottomNav";
import { ToastContainer } from "./components/ui/Toast";
import { ImpersonationBanner } from "./components/ImpersonationBanner";
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
import { Portfolio } from "./pages/Portfolio";
import { Alerts } from "./pages/Alerts";
import { Reports } from "./pages/Reports";
import { Strategies } from "./pages/Strategies";
import { Controls } from "./pages/Controls";
import { Settings } from "./pages/Settings";
import { Admin } from "./pages/Admin";
import { Chat } from "./pages/Chat";
import { PointsBadge } from "./components/ui/PointsBadge";
import { fetchOnboardStatus } from "./api/onboarding";
import { fetchControlState } from "./api/control";
import { fetchNotifications, markNotificationsRead } from "./api/notifications";
import { ControlBanner } from "./components/ControlBanner";
import { SuspensionPage } from "./pages/SuspensionPage";
import { AppLoader } from "./components/ui/AppLoader";
import { useToastStore } from "./store/toastStore";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const showToast = useToastStore((s) => s.show);
  const seenNotificationIds = useRef<Set<string>>(new Set());

  const { data: onboardStatus, isLoading, error } = useQuery({
    queryKey: ["onboard-status"],
    queryFn: fetchOnboardStatus,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const { data: controlState } = useQuery({
    queryKey: ["control-state"],
    queryFn: fetchControlState,
    enabled: isAuthenticated,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: false,
  });

  const { data: notifications } = useQuery({
    queryKey: ["web-notifications"],
    queryFn: () => fetchNotifications({ channel: "web", unread: true, limit: 10 }),
    enabled: isAuthenticated,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!notifications?.items.length) return;
    const unseen = notifications.items.filter((item) => !seenNotificationIds.current.has(item.id));
    if (unseen.length === 0) return;
    const ids = unseen.map((item) => item.id);
    const grouped = new Map<string, typeof unseen[number]>();
    for (const item of unseen) {
      seenNotificationIds.current.add(item.id);
      const key = item.batchId ? `${item.category}:${item.batchId}` : item.id;
      if (!grouped.has(key)) grouped.set(key, item);
    }
    for (const item of grouped.values()) {
      const message = item.body ? `${item.title}: ${item.body}` : item.title;
      showToast(message, item.category === "daily_brief" ? "info" : "warning");
    }
    void markNotificationsRead(ids);
  }, [notifications?.items, showToast]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (isLoading) return <AppLoader />;

  if (error || !onboardStatus) return <>{children}</>;

  if (!onboardStatus.portfolioLoaded || onboardStatus.guidanceStepPending) {
    return <Navigate to="/onboarding" replace />;
  }

  if (controlState?.restriction === "suspended") {
    return <SuspensionPage reason={controlState.reason} />;
  }

  return (
    <>
      {controlState && <ControlBanner state={controlState} />}
      <PointsBadge />
      <div>{children}</div>
    </>
  );
}

function OnboardingRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const { data: onboardStatus } = useQuery({
    queryKey: ["onboard-status"],
    queryFn: fetchOnboardStatus,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (onboardStatus?.portfolioLoaded && !onboardStatus.guidanceStepPending) {
    return <Navigate to="/portfolio" replace />;
  }

  return <Onboarding />;
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isChatRoute = location.pathname === "/chat";

  return (
    <div className={isChatRoute ? "h-[100dvh] overflow-hidden bg-[var(--color-bg-base)]" : "bg-[var(--color-bg-base)] min-h-screen"}>
      <div className={isChatRoute ? "chat-page-content" : "page-content"}>{children}</div>
      <BottomNav />
    </div>
  );
}

function AuthGate() {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) return <AppLoader />;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/onboarding" element={<OnboardingRoute />} />
      <Route path="/" element={
        isSignedIn
          ? <Navigate to="/portfolio" replace />
          : <Navigate to="/login" replace />
      } />
      <Route path="/portfolio" element={
        <ProtectedRoute>
          <AppLayout><Portfolio /></AppLayout>
        </ProtectedRoute>
      } />
      <Route path="/alerts" element={
        <ProtectedRoute>
          <AppLayout><Alerts /></AppLayout>
        </ProtectedRoute>
      } />
      <Route path="/reports" element={
        <ProtectedRoute>
          <AppLayout><Reports /></AppLayout>
        </ProtectedRoute>
      } />
      <Route path="/strategies" element={
        <ProtectedRoute>
          <AppLayout><Strategies /></AppLayout>
        </ProtectedRoute>
      } />
      <Route path="/settings" element={
        <ProtectedRoute>
          <AppLayout><Settings /></AppLayout>
        </ProtectedRoute>
      } />
      <Route path="/controls" element={
        <ProtectedRoute>
          <AppLayout><Controls /></AppLayout>
        </ProtectedRoute>
      } />
      <Route path="/admin" element={<Admin />} />
      <Route path="/chat" element={
        <ProtectedRoute>
          <AppLayout><Chat /></AppLayout>
        </ProtectedRoute>
      } />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ImpersonationBanner />
        <AuthGate />
        <ToastContainer />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
