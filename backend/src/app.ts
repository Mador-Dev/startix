import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import cors from "cors";
import path from "path";
import { createProxyMiddleware } from "http-proxy-middleware";
import { clerkMiddleware } from "@clerk/express";
import { logger } from "./services/logger.js";
import { ZodError } from "zod";
import { WorkspaceViolationError } from "./middleware/userIsolation.js";
import { WorkspaceNotFoundError } from "./services/workspaceService.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { authMiddleware } from "./middleware/auth.js";
import { ensureUserProvisionedMiddleware } from "./middleware/ensureUserProvisioned.js";
import { userIsolationMiddleware } from "./middleware/userIsolation.js";
import { readOnlyGuard } from "./middleware/impersonation.js";
import authRoutes from "./routes/auth.js";
import portfolioRoutes from "./routes/portfolio.js";
import verdictsRoutes from "./routes/verdicts.js";
import conditionRoutes from "./routes/conditions.js";
import strategyRoutes from "./routes/strategies.js";
import reportsRoutes from "./routes/reports.js";
import onboardingRoutes from "./routes/onboarding.js";
import telegramRoutes from "./routes/telegram.js";
import adminRoutes from "./routes/admin.js";
import searchRoutes from "./routes/search.js";
import controlRoutes from "./routes/control.js";
import notificationsRoutes from "./routes/notifications.js";
import supportRoutes from "./routes/support.js";
import channelRoutes from "./routes/channels.js";
import whatsappRoutes from "./routes/whatsapp.js";
import verdictActionsRoutes from "./routes/verdictActions.js";
import analystConfigRoutes from "./routes/analystConfig.js";

export function createApp(): Express {
  const app = express();
  app.set("trust proxy", process.env["TRUST_PROXY"] ?? 1);

  app.use(helmet({
    hsts: false,
    contentSecurityPolicy: false,
  }));
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(clerkMiddleware());

  // Health — no auth
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Rate limiter on all API routes except /api/admin (which uses X-Admin-Key auth)
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/admin")) return next();
    return apiLimiter(req, res, next);
  });

  // Auth routes — login/logout/register (no JWT required)
  // Mounted BEFORE global authMiddleware so /api/auth/* bypasses auth
  app.use("/api/auth", authRoutes);

  // Admin routes — have their own X-Admin-Key auth, no JWT needed
  app.use("/api/admin", adminRoutes);

  // LLM proxy route removed; llmProxy.ts retains advisor routing helpers for advisorLlmService.ts.

  // Onboarding routes — init doesn't need JWT, portfolio/status do
  // Mounted here so it can have its own auth handling per-route
  app.use("/api/onboard", onboardingRoutes);
  app.use("/api", telegramRoutes); // POST /api/telegram/webhook — public webhook path
  app.use("/api", whatsappRoutes); // GET/POST /api/whatsapp/webhook — public webhook path

  // Agents proxy — auth-verified, forwards X-User-Id to the internal agents service
  const agentsTarget = process.env["AGENTS_INTERNAL_URL"] ?? "http://localhost:8090";
  app.use(
    "/api/agents",
    authMiddleware,
    ensureUserProvisionedMiddleware,
    createProxyMiddleware({
      target: agentsTarget,
      changeOrigin: true,
      pathRewrite: { "^/api/agents": "/api" },
      on: {
        proxyReq(proxyReq, _req, res) {
          const userId = res.locals["userId"] as string | undefined;
          if (userId) proxyReq.setHeader("x-user-id", userId);
        },
      },
    })
  );

  // Protected routes — JWT + user isolation for everything else
  app.use(
    "/api",
    authMiddleware,
    ensureUserProvisionedMiddleware,
    userIsolationMiddleware,
    readOnlyGuard
  );

  // Route mounts
  app.use("/api/me", controlRoutes); // GET /api/me/control
  app.use("/api", portfolioRoutes); // GET /api/portfolio
  app.use("/api", verdictsRoutes); // GET /api/verdicts
  app.use("/api", reportsRoutes); // GET /api/reports/*
  app.use("/api", notificationsRoutes); // GET/POST /api/notifications*
  app.use("/api", supportRoutes); // POST /api/support/messages
  app.use("/api", conditionRoutes); // GET /api/conditions/*
  app.use("/api", strategyRoutes); // GET /api/strategies/*
  app.use("/api", searchRoutes); // GET /api/search/ticker — no user workspace needed
  app.use("/api", channelRoutes); // POST /api/channels/binding-codes
  app.use("/api", verdictActionsRoutes); // POST /api/verdict-actions, POST /api/snoozes
  app.use("/api", analystConfigRoutes); // GET/PATCH /api/analyst-config

  // ── Serve React frontend (SPA fallback) ──────────────────────────────────
  const frontendDist = process.env.FRONTEND_DIST ?? path.resolve(process.cwd(), "../frontend/dist");
  app.use(express.static(frontendDist));
  app.get("/{*path}", (_req: Request, res: Response) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });


  // Global error handler
  app.use(
    (
      err: Error,
      _req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      if (err instanceof ZodError) {
        logger.warn(`Validation error: ${err.message}`);
        res
          .status(400)
          .json({ error: "Validation failed", details: err.errors });
        return;
      }

      if (err instanceof WorkspaceViolationError) {
        logger.warn(
          `Workspace violation: user=${err.userId} path=${err.attemptedPath}`
        );
        res.status(403).json({ error: "access denied" });
        return;
      }

      if (err instanceof WorkspaceNotFoundError) {
        res.status(404).json({ error: "user workspace not found" });
        return;
      }

      logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
      res.status(500).json({ error: "Internal server error" });
    }
  );

  return app;
}
