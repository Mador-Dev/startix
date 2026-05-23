import rateLimit from "express-rate-limit";
import type { Request } from "express";

const keyGenerator = (req: Request): string =>
  req.ip ?? (req.socket as { remoteAddress?: string })?.remoteAddress ?? "unknown";

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  validate: { ip: false },
  message: { error: "Too many requests, please try again later." },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  validate: { ip: false },
  message: { error: "Too many authentication attempts, please try again later." },
});

export const triggerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  validate: { ip: false },
  message: { error: "Too many trigger requests, please try again later." },
});
