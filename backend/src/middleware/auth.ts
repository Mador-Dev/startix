import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { getAuth } from "@clerk/express";
import { validateSession } from "../services/impersonationService.js";

const JWT_SECRET = process.env["JWT_SECRET"] ?? "changeme";

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

interface ImpersonationPayload {
  userId: string;
  impersonatorId: string;
  sessionId: string;
  readOnly: true;
}

function peekImpersonationPayload(token: string): ImpersonationPayload | null {
  try {
    const [, payloadB64] = token.split(".");
    if (!payloadB64) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as Record<string, unknown>;
    if (
      typeof payload["impersonatorId"] === "string" &&
      typeof payload["sessionId"] === "string" &&
      payload["readOnly"] === true
    ) {
      return payload as unknown as ImpersonationPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const token = authHeader.slice(7);

  // Impersonation tokens are custom JWTs issued by this backend — detect by peeking at payload
  const impersonationHint = peekImpersonationPayload(token);
  if (impersonationHint) {
    let payload: ImpersonationPayload;
    try {
      payload = jwt.verify(token, JWT_SECRET) as ImpersonationPayload;
    } catch {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const { impersonatorId, sessionId } = payload;
    validateSession(sessionId)
      .then((result) => {
        if (!result.valid) {
          res.status(401).json({ error: "impersonation_session_invalid", reason: result.reason });
          return;
        }
        res.locals["userId"] = result.targetUserId;
        res.locals["impersonatorId"] = impersonatorId;
        res.locals["sessionId"] = sessionId;
        res.locals["readOnly"] = true;
        next();
      })
      .catch(() => {
        res.status(401).json({ error: "impersonation_session_invalid", reason: "validation_error" });
      });
    return;
  }

  // Normal Clerk session token — clerkMiddleware() already verified it and attached auth to req
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  res.locals["userId"] = userId;
  next();
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Still used by impersonationService to mint custom impersonation JWTs
export function generateImpersonationToken(
  userId: string,
  impersonatorId: string,
  sessionId: string
): string {
  return jwt.sign(
    { userId, impersonatorId, sessionId, readOnly: true },
    JWT_SECRET,
    { expiresIn: "15m" }
  );
}
