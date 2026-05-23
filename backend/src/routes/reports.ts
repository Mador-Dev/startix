import { Router, type Response, type NextFunction } from "express";
import path from "path";
import { readWorkspaceJson } from "../services/workspaceDataIO.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import { guardPath } from "../middleware/userIsolation.js";
import { readFeedPage } from "../services/feedService.js";
import { getReportMeta, listBatchesPage } from "../services/reportIndexStore.js";
import { loadUserStrategy } from "../services/strategyAccess.js";

const router = Router();

type AsyncHandler = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Promise<void>;

function handler(fn: AsyncHandler) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const VALID_REPORT_TYPES = [
  "fundamentals",
  "technical",
  "sentiment",
  "macro",
  "risk",
  "bull",
  "bear",
  "bull_case",
  "bear_case",
  "strategy",
  "quick_check",
];

const BATCH_ID_REGEX = /^[a-zA-Z0-9_]{1,60}$/;
const TICKER_REGEX = /^[A-Z0-9.]{1,12}$/;

router.get(
  "/reports/meta",
  handler(async (_req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    res.json(await getReportMeta(ws.userId));
  })
);

router.get(
  "/reports/page/:pageNum",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const pageNum = parseInt(String(req.params["pageNum"] ?? "0"), 10);
    if (!Number.isInteger(pageNum) || pageNum < 1) {
      res.status(400).json({ error: "pageNum must be positive integer" });
      return;
    }

    const page = await listBatchesPage(ws.userId, pageNum);
    res.json({
      page: page.page,
      totalPages: page.totalPages,
      batches: page.batches.map((batch) => ({
        ...batch,
        tickers: batch.tickers.map((ticker: string) => ({
          ticker,
          verdict: (batch.entries[ticker]?.["verdict"] as string | undefined) ?? "HOLD",
        })),
      })),
    });
  })
);

router.get(
  "/reports/feed/:pageNum",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const pageNum = parseInt(String(req.params["pageNum"] ?? "0"), 10);
    const mode = typeof req.query["mode"] === "string" ? req.query["mode"] : null;
    const search = typeof req.query["q"] === "string" ? req.query["q"].trim() : null;
    if (!Number.isInteger(pageNum) || pageNum < 1) {
      res.status(400).json({ error: "pageNum must be positive integer" });
      return;
    }

    res.json(await readFeedPage(ws.userId, { pageNum, mode, search }));
  })
);

router.get(
  "/reports/batch/:batchId/:ticker/:reportType",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const batchId = String(req.params["batchId"] ?? "");
    const ticker = String(req.params["ticker"] ?? "");
    const reportType = String(req.params["reportType"] ?? "");

    if (!BATCH_ID_REGEX.test(batchId)) {
      res.status(400).json({ error: "Invalid batchId" });
      return;
    }
    if (!TICKER_REGEX.test(ticker)) {
      res.status(400).json({ error: "Invalid ticker" });
      return;
    }
    if (!VALID_REPORT_TYPES.includes(reportType)) {
      res
        .status(400)
        .json({
          error: `reportType must be one of: ${VALID_REPORT_TYPES.join(", ")}`,
        });
      return;
    }

    const filePath = path.join(ws.reportsDir, ticker, `${reportType}.json`);
    guardPath(ws, filePath);

    const content = await readWorkspaceJson(ws.userId, filePath);
    if (!content) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    res.json({ batchId, ticker, reportType, content });
  })
);

router.get(
  "/reports/strategy/:ticker",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const ticker = String(req.params["ticker"] ?? "");

    if (!TICKER_REGEX.test(ticker)) {
      res.status(400).json({ error: "Invalid ticker" });
      return;
    }

    const filePath = ws.strategyFile(ticker);
    guardPath(ws, filePath);

    const loaded = await loadUserStrategy(ws.userId, filePath, { repair: true, tickerHint: ticker });
    if (!loaded.valid || !loaded.strategy) {
      if ((loaded.errors ?? []).some((error) => error.startsWith("File not found:"))) {
        res.status(404).json({ error: "Strategy not found" });
        return;
      }
      res.status(422).json({ error: "Strategy is not valid", details: loaded.errors });
      return;
    }

    res.json(loaded.strategy);
  })
);

export default router;
