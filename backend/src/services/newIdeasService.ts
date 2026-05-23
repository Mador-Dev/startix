import { promises as fs } from "fs";
import path from "path";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { Job, JsonValue, Exchange } from "../types/index.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import { getPrice, getUsdIlsRate } from "./priceService.js";
import { updateJob } from "./jobService.js";
import { runNewIdeasAdvisor } from "./advisorLlmService.js";
import { publishNotification } from "./notificationService.js";
import { buildStrategyMetadata } from "./strategyBaselineService.js";
import { putReportBatch } from "./reportIndexStore.js";

interface CandidateIdea {
  ticker: string;
  exchange: Exchange;
  category: "broad_us" | "gold" | "bonds" | "clean_energy" | "real_assets" | "international";
  label: string;
  rationale: string;
  primaryGap: string;
  secondaryGap: string | null;
  timeframe: "months" | "long_term";
  verdict: "ADD" | "BUY";
  confidence: "medium" | "high";
  entryCondition: string;
  exitCondition: string;
}

interface ExposureSummary {
  tickers: Set<string>;
  categories: Set<CandidateIdea["category"]>;
}

interface NewIdeaEntry {
  ticker: string;
  mode: "new_idea";
  verdict: "ADD" | "BUY";
  confidence: "medium" | "high";
  reasoning: string;
  timeframe: "months" | "long_term";
  analystTypes: Array<"fundamentals" | "technical" | "sentiment" | "macro" | "risk">;
  hasBullCase: boolean;
  hasBearCase: boolean;
}

export interface NewIdeasResult {
  generatedAt: string;
  totalIdeas: number;
  usedLlm: boolean;
  ideas: Array<{
    ticker: string;
    exchange: Exchange;
    category: CandidateIdea["category"];
    score: number;
    verdict: "ADD" | "BUY";
    confidence: "medium" | "high";
    reasoning: string;
  }>;
}

const CANDIDATE_UNIVERSE: CandidateIdea[] = [
  {
    ticker: "VOO",
    exchange: "NYSE",
    category: "broad_us",
    label: "broad US equity",
    rationale: "low-cost core US index exposure that reduces single-name concentration",
    primaryGap: "broad-market exposure",
    secondaryGap: "single-name concentration",
    timeframe: "long_term",
    verdict: "ADD",
    confidence: "high",
    entryCondition: "Build in tranches over 2-4 weeks",
    exitCondition: "Reduce if core allocation exceeds intended long-term weight",
  },
  {
    ticker: "GLD",
    exchange: "NYSE",
    category: "gold",
    label: "gold hedge",
    rationale: "portfolio ballast against macro stress and fiat debasement",
    primaryGap: "defensive hard-asset hedge",
    secondaryGap: "inflation resilience",
    timeframe: "long_term",
    verdict: "ADD",
    confidence: "medium",
    entryCondition: "Start with a partial hedge allocation",
    exitCondition: "Trim if hedge grows beyond target defensive weight",
  },
  {
    ticker: "GOVT",
    exchange: "NYSE",
    category: "bonds",
    label: "US Treasury exposure",
    rationale: "duration and flight-to-quality ballast when risk assets wobble",
    primaryGap: "high-quality bond exposure",
    secondaryGap: "macro shock absorber",
    timeframe: "long_term",
    verdict: "ADD",
    confidence: "medium",
    entryCondition: "Accumulate gradually while maintaining diversification",
    exitCondition: "Reduce if defensive sleeve becomes oversized",
  },
  {
    ticker: "ICLN",
    exchange: "NASDAQ",
    category: "clean_energy",
    label: "clean energy basket",
    rationale: "theme diversification beyond existing AI and software concentration",
    primaryGap: "clean-energy exposure",
    secondaryGap: "thematic diversification",
    timeframe: "months",
    verdict: "BUY",
    confidence: "medium",
    entryCondition: "Prefer staged entry after confirmation of trend support",
    exitCondition: "Exit if theme momentum breaks and thesis weakens",
  },
  {
    ticker: "VNQ",
    exchange: "NYSE",
    category: "real_assets",
    label: "listed real estate",
    rationale: "real-asset cash-flow exposure that behaves differently from growth equities",
    primaryGap: "real-asset income exposure",
    secondaryGap: "equity-style diversification",
    timeframe: "long_term",
    verdict: "ADD",
    confidence: "medium",
    entryCondition: "Build position patiently around stable rate expectations",
    exitCondition: "Reduce if real-asset sleeve no longer improves diversification",
  },
  {
    ticker: "EEM",
    exchange: "NYSE",
    category: "international",
    label: "emerging markets basket",
    rationale: "non-US equity exposure that broadens geographic risk",
    primaryGap: "international diversification",
    secondaryGap: "currency diversification",
    timeframe: "long_term",
    verdict: "ADD",
    confidence: "medium",
    entryCondition: "DCA rather than chase short-term strength",
    exitCondition: "Reduce if allocation stops improving diversification quality",
  },
];

const CATEGORY_ALIASES: Record<CandidateIdea["category"], string[]> = {
  broad_us: ["VOO", "SPY", "IVV", "VTI", "QQQ"],
  gold: ["GLD", "IAU", "GDX", "SLV"],
  bonds: ["GOVT", "IEF", "TLT", "BND", "AGG"],
  clean_energy: ["ICLN", "TAN", "QCLN", "PBW"],
  real_assets: ["VNQ", "SCHH", "REET", "XLRE"],
  international: ["EEM", "VXUS", "VEA", "ACWX", "IXUS"],
};

function buildExposureSummary(tickers: string[]): ExposureSummary {
  const normalized = new Set(tickers.map((ticker) => ticker.toUpperCase()));
  const categories = new Set<CandidateIdea["category"]>();

  for (const [category, aliases] of Object.entries(CATEGORY_ALIASES) as Array<
    [CandidateIdea["category"], string[]]
  >) {
    if (aliases.some((alias) => normalized.has(alias))) {
      categories.add(category);
    }
  }

  return {
    tickers: normalized,
    categories,
  };
}

async function readPortfolioTickers(ws: UserWorkspace): Promise<string[]> {
  const { readPortfolio } = await import("./portfolioStore.js");
  const stored = await readPortfolio(ws.userId);
  if (!stored) throw new Error("portfolio not found");
  const raw = JSON.stringify(stored);
  const portfolio = PortfolioFileSchema.parse(JSON.parse(raw));
  return Array.from(
    new Set(
      Object.values(portfolio.accounts)
        .flat()
        .map((position) => position.ticker.toUpperCase())
    )
  );
}

function scoreIdea(candidate: CandidateIdea, exposure: ExposureSummary): number {
  if (exposure.tickers.has(candidate.ticker)) return -1_000;

  let score = 50;
  if (!exposure.categories.has(candidate.category)) score += 40;

  if (candidate.category === "broad_us" && !exposure.categories.has("broad_us")) score += 15;
  if (
    (candidate.category === "gold" || candidate.category === "bonds") &&
    !exposure.categories.has("gold") &&
    !exposure.categories.has("bonds")
  ) {
    score += 12;
  }
  if (candidate.category === "international" && !exposure.categories.has("international")) {
    score += 8;
  }

  return score;
}

function buildReasoning(candidate: CandidateIdea, exposure: ExposureSummary): string {
  const fragments = [
    `Portfolio is missing ${candidate.primaryGap}.`,
    `${candidate.ticker} adds ${candidate.rationale}.`,
  ];

  if (candidate.secondaryGap && !exposure.categories.has(candidate.category)) {
    fragments.push(`It also improves ${candidate.secondaryGap}.`);
  }

  fragments.push("Use phased sizing rather than a single full entry.");
  return fragments.join(" ");
}

async function buildIdeaEntry(
  ws: UserWorkspace,
  candidate: CandidateIdea,
  reasoning: string
): Promise<NewIdeaEntry> {
  const generatedAt = new Date().toISOString();
  const usdIlsRate = await getUsdIlsRate();
  const price = await getPrice(candidate.ticker, candidate.exchange, usdIlsRate);
  const livePrice = price.priceNative > 0 ? price.priceNative : null;
  const support = livePrice === null ? null : Math.round(livePrice * 0.93 * 100) / 100;
  const resistance = livePrice === null ? null : Math.round(livePrice * 1.08 * 100) / 100;

  const reportDir = path.join(ws.reportsDir, candidate.ticker);
  await fs.mkdir(reportDir, { recursive: true });

  await fs.writeFile(
    path.join(reportDir, "fundamentals.json"),
    JSON.stringify(
      {
        ticker: candidate.ticker,
        generatedAt,
        analyst: "fundamentals",
        earnings: {
          result: "unknown",
          epsActual: null,
          epsExpected: null,
          revenueActualM: null,
          revenueExpectedM: null,
        },
        revenueGrowthYoY: null,
        marginTrend: "unknown",
        guidance: "unknown",
        valuation: {
          pe: null,
          sectorAvgPe: null,
          assessment: "unknown",
        },
        analystConsensus: {
          buy: 0,
          hold: 0,
          sell: 0,
          avgTargetPrice: null,
          currency: candidate.exchange === "TASE" ? "ILS" : "USD",
        },
        balanceSheet: "unknown",
        insiderActivity: "unknown",
        fundamentalView: `${candidate.ticker} is a candidate because it fills a structural portfolio gap: ${candidate.primaryGap}.`,
        sources: ["https://example.com/new-ideas/fundamentals"],
      },
      null,
      2
    ),
    "utf-8"
  );

  await fs.writeFile(
    path.join(reportDir, "technical.json"),
    JSON.stringify(
      {
        ticker: candidate.ticker,
        generatedAt,
        analyst: "technical",
        price: {
          current: livePrice ?? 0,
          week52High: null,
          week52Low: null,
          positionInRange: null,
        },
        movingAverages: {
          ma50: null,
          ma200: null,
          priceVsMa50: "at",
          priceVsMa200: "at",
        },
        rsi: {
          value: null,
          signal: "neutral",
        },
        macd: "neutral",
        volume: "average",
        keyLevels: {
          support,
          resistance,
        },
        pattern: "screened_new_idea",
        technicalView: `${candidate.entryCondition}. ${candidate.exitCondition}.`,
        sources: ["https://example.com/new-ideas/technical"],
      },
      null,
      2
    ),
    "utf-8"
  );

  await fs.writeFile(
    path.join(reportDir, "sentiment.json"),
    JSON.stringify(
      {
        ticker: candidate.ticker,
        generatedAt,
        analyst: "sentiment",
        analystActions: [],
        insiderTransactions: [],
        majorNews: [],
        shortInterest: "unknown",
        narrativeShift: "stable",
        sentimentView: `${candidate.label} remains a watchlist candidate; current recommendation is driven by portfolio construction rather than a one-day catalyst.`,
        sources: ["https://example.com/new-ideas/sentiment"],
      },
      null,
      2
    ),
    "utf-8"
  );

  await fs.writeFile(
    path.join(reportDir, "macro.json"),
    JSON.stringify(
      {
        ticker: candidate.ticker,
        generatedAt,
        analyst: "macro",
        rateEnvironment: {
          relevantBank: "Fed",
          currentRate: null,
          direction: "holding",
          relevance: "neutral",
        },
        sectorPerformance: {
          sectorName: candidate.label,
          performanceVsMarket30d: null,
          trend: "in-line",
        },
        currency: {
          usdIls: usdIlsRate,
          trend: "stable",
          impactOnPosition: "neutral",
        },
        geopolitical: {
          relevantFactor: null,
          riskLevel: "low",
        },
        marketRegime: "mixed",
        macroView: `Macro case is primarily diversification-oriented: ${candidate.rationale}.`,
        sources: ["https://example.com/new-ideas/macro"],
      },
      null,
      2
    ),
    "utf-8"
  );

  await fs.writeFile(
    path.join(reportDir, "risk.json"),
    JSON.stringify(
      {
        ticker: candidate.ticker,
        generatedAt,
        analyst: "risk",
        livePrice: livePrice ?? 0,
        livePriceCurrency: candidate.exchange === "TASE" ? "ILS" : "USD",
        livePriceSource: price.source,
        shares: {
          main: 0,
          second: 0,
          total: 0,
        },
        positionValueILS: 0,
        portfolioWeightPct: 0,
        plILS: 0,
        plPct: 0,
        avgPricePaid: 0,
        concentrationFlag: false,
        riskFacts: "Not currently held; candidate is intended to improve diversification rather than increase existing concentration.",
      },
      null,
      2
    ),
    "utf-8"
  );

  await fs.writeFile(
    path.join(reportDir, "bull_case.json"),
    JSON.stringify(
      {
        ticker: candidate.ticker,
        generatedAt,
        analyst: "bull",
        round: 2,
        coreThesis: `${candidate.ticker} improves portfolio construction through ${candidate.primaryGap}.`,
        arguments: [
          {
            source: "https://example.com/new-ideas/bull-1",
            claim: "Diversification benefit is immediate.",
            dataPoint: `Candidate targets ${candidate.primaryGap}.`,
          },
          {
            source: "https://example.com/new-ideas/bull-2",
            claim: "Sizing can stay disciplined.",
            dataPoint: "Recommendation assumes phased entry rather than full allocation.",
          },
          {
            source: "https://example.com/new-ideas/bull-3",
            claim: "Portfolio fit matters even without a short-term catalyst.",
            dataPoint: candidate.rationale,
          },
        ],
        responseToBear: "Thesis depends on allocation discipline, not aggressive timing.",
        bullVerdict: candidate.verdict,
        conditionToBeWrong: "Existing portfolio exposure already covers the same gap.",
      },
      null,
      2
    ),
    "utf-8"
  );

  await fs.writeFile(
    path.join(reportDir, "bear_case.json"),
    JSON.stringify(
      {
        ticker: candidate.ticker,
        generatedAt,
        analyst: "bear",
        round: 2,
        coreConcern: "A diversification candidate can still be unnecessary if the portfolio already has similar exposure.",
        arguments: [
          {
            source: "https://example.com/new-ideas/bear-1",
            claim: "Theme overlap can be hidden.",
            dataPoint: "Single-name holdings sometimes already capture the same factor exposure.",
          },
          {
            source: "https://example.com/new-ideas/bear-2",
            claim: "ETF diversification can dilute upside.",
            dataPoint: "Broader baskets may lag high-conviction single names.",
          },
          {
            source: "https://example.com/new-ideas/bear-3",
            claim: "Poor sizing turns a hedge into clutter.",
            dataPoint: "Small undifferentiated positions add operational noise.",
          },
        ],
        responseToBull: "Only add when the exposure gap is real and sized intentionally.",
        bearVerdict: "HOLD",
        conditionToBeWrong: "Portfolio review confirms the gap is material and still unfilled.",
      },
      null,
      2
    ),
    "utf-8"
  );

  await fs.writeFile(
    path.join(reportDir, "strategy.json"),
    JSON.stringify(
      {
        ticker: candidate.ticker,
        updatedAt: generatedAt,
        version: 1,
        verdict: candidate.verdict,
        confidence: candidate.confidence,
        reasoning,
        timeframe: candidate.timeframe,
        positionSizeILS: 0,
        positionWeightPct: 0,
        entryConditions: [candidate.entryCondition],
        exitConditions: [candidate.exitCondition],
        catalysts: [
          {
            description: `Review ${candidate.ticker} idea after 60 days if still not acted on`,
            expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
            triggered: false,
          },
        ],
        bullCase: `${candidate.ticker} closes a genuine portfolio gap with controlled sizing.`,
        bearCase: `${candidate.ticker} is not attractive if current holdings already provide comparable exposure.`,
        lastDeepDiveAt: generatedAt,
        deepDiveTriggeredBy: "new_ideas",
        metadata: buildStrategyMetadata("new_ideas", "validated", generatedAt, false),
      },
      null,
      2
    ),
    "utf-8"
  );

  return {
    ticker: candidate.ticker,
    mode: "new_idea",
    verdict: candidate.verdict,
    confidence: candidate.confidence,
    reasoning,
    timeframe: candidate.timeframe,
    analystTypes: ["fundamentals", "technical", "sentiment", "macro", "risk"],
    hasBullCase: true,
    hasBearCase: true,
  };
}

async function appendNewIdeasBatch(
  ws: UserWorkspace,
  job: Job,
  entries: NewIdeaEntry[]
): Promise<void> {
  const batchId = `batch_${job.id}_new_ideas`;
  const generatedAt = job.completed_at ?? new Date().toISOString();
  await putReportBatch({
    batchId,
    userId: ws.userId,
    jobId: job.id,
    mode: "new_ideas",
    triggeredAt: generatedAt,
    date: generatedAt.slice(0, 10),
    summary: null,
    highlights: null,
    entries: entries.map((entry) => ({
      ticker: entry.ticker,
      dailySection: null,
      entry: entry as unknown as Record<string, unknown>,
    })),
  });
  await publishNotification({
    userId: ws.userId,
    kind: "new_ideas",
    summary: `Generated ${entries.length} new idea${entries.length === 1 ? "" : "s"}.`,
    ticker: entries[0]?.ticker ?? null,
    batchId,
    actionUrl: `/reports?batch=${encodeURIComponent(batchId)}`,
  });
}

async function rankIdeasWithAdvisor(
  ws: UserWorkspace,
  portfolioTickers: string[],
  exposure: ExposureSummary
): Promise<Array<{ candidate: CandidateIdea; score: number; reasoning: string; usedLlm: boolean }>> {
  const baseRanked = CANDIDATE_UNIVERSE
    .map((candidate) => ({
      candidate,
      score: scoreIdea(candidate, exposure),
      reasoning: buildReasoning(candidate, exposure),
      usedLlm: false,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.ticker.localeCompare(b.candidate.ticker));

  const advisor = await runNewIdeasAdvisor({
    userId: ws.userId,
    portfolioTickers,
    candidates: baseRanked.map((entry) => ({
      ticker: entry.candidate.ticker,
      category: entry.candidate.category,
      label: entry.candidate.label,
      rationale: entry.candidate.rationale,
      primaryGap: entry.candidate.primaryGap,
      secondaryGap: entry.candidate.secondaryGap,
      timeframe: entry.candidate.timeframe,
      verdict: entry.candidate.verdict,
      confidence: entry.candidate.confidence,
    })),
  });

  if (!advisor || advisor.ideas.length === 0) {
    return baseRanked.slice(0, 4);
  }

  const byTicker = new Map(baseRanked.map((entry) => [entry.candidate.ticker, entry] as const));
  const llmRanked = advisor.ideas
    .map((idea) => {
      const base = byTicker.get(idea.ticker);
      if (!base) return null;
      return {
        candidate: base.candidate,
        score: Number.isFinite(idea.score) ? idea.score : base.score,
        reasoning: idea.reasoning,
        usedLlm: true,
      };
    })
    .filter((entry): entry is { candidate: CandidateIdea; score: number; reasoning: string; usedLlm: boolean } => entry !== null);

  return llmRanked.length > 0 ? llmRanked.slice(0, 4) : baseRanked.slice(0, 4);
}

export async function runNewIdeasJob(
  ws: UserWorkspace,
  job: Job
): Promise<Job> {
  const startedAt = new Date().toISOString();
  await updateJob(ws, job.id, {
    status: "running",
    started_at: startedAt,
  });

  try {
    const portfolioTickers = await readPortfolioTickers(ws);
    const exposure = buildExposureSummary(portfolioTickers);

    const ranked = await rankIdeasWithAdvisor(ws, portfolioTickers, exposure);

    const entries = await Promise.all(
      ranked.map((entry) => buildIdeaEntry(ws, entry.candidate, entry.reasoning))
    );

    const completedAt = new Date().toISOString();
    const result: NewIdeasResult = {
      generatedAt: completedAt,
      totalIdeas: ranked.length,
      usedLlm: ranked.some((entry) => entry.usedLlm),
      ideas: ranked.map((entry) => ({
        ticker: entry.candidate.ticker,
        exchange: entry.candidate.exchange,
        category: entry.candidate.category,
        score: entry.score,
        verdict: entry.candidate.verdict,
        confidence: entry.candidate.confidence,
        reasoning: entry.reasoning,
      })),
    };

    const completed = await updateJob(ws, job.id, {
      status: "completed",
      completed_at: completedAt,
      result: result as unknown as JsonValue,
      error: null,
    });

    await appendNewIdeasBatch(ws, completed, entries);
    return completed;
  } catch (err) {
    return updateJob(ws, job.id, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error: err instanceof Error ? err.message.slice(0, 490) : "New ideas failed",
    });
  }
}
