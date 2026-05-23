import { Router } from "express";

const router = Router();

// Auth is now handled by Clerk. These endpoints are no longer active.
router.all("/login", (_req, res) => res.status(410).json({ error: "Use Clerk authentication" }));
router.all("/logout", (_req, res) => res.json({ status: "ok" }));
router.all("/register", (_req, res) => res.status(410).json({ error: "Use Clerk dashboard to create users" }));
router.all("/change-password", (_req, res) => res.status(410).json({ error: "Use Clerk dashboard to manage passwords" }));

export default router;
