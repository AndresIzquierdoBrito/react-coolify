import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import session from "express-session";
import passport from "passport";
import { rateLimit } from "express-rate-limit";
import { Strategy as GitHubStrategy, type Profile } from "passport-github2";
import type { AppConfig } from "../config.js";
import type { DatabaseContext } from "../db/index.js";
import { SQLiteSessionStore } from "./session-store.js";

export interface AdminUser { id: string; login: string; displayName: string; avatarUrl: string | null }

export function authMiddleware(config: AppConfig, db: DatabaseContext) {
  return [
    session({
      name: "izbri.sid",
      secret: config.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: new SQLiteSessionStore(db),
      cookie: { httpOnly: true, secure: config.isProduction, sameSite: "lax" as const, maxAge: 7 * 86_400_000, path: "/" },
    }),
    passport.initialize(),
    passport.session(),
  ];
}

export function configurePassport(config: AppConfig) {
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user: AdminUser, done) => done(null, user));
  if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET) return;
  passport.use(new GitHubStrategy({
    clientID: config.GITHUB_CLIENT_ID,
    clientSecret: config.GITHUB_CLIENT_SECRET,
    callbackURL: `${config.APP_ORIGIN}/api/v1/auth/github/callback`,
    scope: ["read:user"],
  }, (_accessToken: string, _refreshToken: string, profile: Profile, done: (error: unknown, user?: AdminUser | false) => void) => {
    const login = profile.username?.toLowerCase() ?? "";
    if (!config.githubAdminLogins.has(login)) return done(null, false);
    done(null, { id: profile.id, login, displayName: profile.displayName || login, avatarUrl: profile.photos?.[0]?.value ?? null });
  }));
}

export function createAuthRouter(config: AppConfig) {
  const router = Router();
  const passwordLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, skipSuccessfulRequests: true, standardHeaders: "draft-8", legacyHeaders: false });
  router.get("/session", (request, response) => {
    const user = request.user as AdminUser | undefined;
    const sessionData = request.session as session.Session & Partial<session.SessionData> & { csrfToken?: string };
    if (user && !sessionData.csrfToken) sessionData.csrfToken = randomBytes(24).toString("base64url");
    const methods = { github: Boolean(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET && config.githubAdminLogins.size), password: config.passwordAuthConfigured };
    response.json({ authenticated: Boolean(user), configured: methods.github || methods.password, methods, user: user ?? null, csrfToken: user ? sessionData.csrfToken : null });
  });
  router.post("/password", passwordLimiter, (request, response, next) => {
    if (!config.passwordAuthConfigured) return response.status(503).json({ error: { code: "AUTH_NOT_CONFIGURED", message: "Username/password authentication is not configured." } });
    const username = typeof request.body?.username === "string" ? request.body.username : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!safeEqual(username, config.ADMIN_USERNAME) || !safeEqual(password, config.ADMIN_PASSWORD)) return response.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "The username or password is incorrect." } });
    const admin: AdminUser = { id: `env:${config.ADMIN_USERNAME}`, login: config.ADMIN_USERNAME, displayName: config.ADMIN_USERNAME, avatarUrl: null };
    request.session.regenerate((regenerateError) => {
      if (regenerateError) return next(regenerateError);
      request.login(admin, (loginError) => loginError ? next(loginError) : response.json({ user: admin }));
    });
  });
  router.get("/github", (request, response, next) => {
    if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET) return response.status(503).json({ error: { code: "AUTH_NOT_CONFIGURED", message: "GitHub OAuth is not configured." } });
    passport.authenticate("github", { session: true })(request, response, next);
  });
  router.get("/github/callback", passport.authenticate("github", { failureRedirect: "/admin?auth=denied" }), (_request, response) => response.redirect("/admin"));
  router.post("/logout", requireAuth, requireCsrf, (request, response, next) => request.logout((error) => error ? next(error) : request.session.destroy((destroyError) => destroyError ? next(destroyError) : response.status(204).end())));
  return router;
}

function safeEqual(candidate: string, expected: string) {
  const left = createHash("sha256").update(candidate).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  if (request.isAuthenticated?.()) return next();
  response.status(401).json({ error: { code: "UNAUTHORIZED", message: "Administrator authentication is required.", requestId: response.locals.requestId } });
}

export function requireCsrf(request: Request, response: Response, next: NextFunction) {
  const token = (request.session as session.Session & { csrfToken?: string }).csrfToken;
  if (token && request.get("x-csrf-token") === token) return next();
  response.status(403).json({ error: { code: "CSRF_INVALID", message: "The security token is missing or invalid.", requestId: response.locals.requestId } });
}
