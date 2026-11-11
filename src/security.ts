import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * StudyDeck only listens on this machine, but a browser on this machine will happily carry requests from any
 * website to it. Two attacks matter:
 *
 *  1. DNS rebinding: a hostile site points its own domain at 127.0.0.1, so the browser treats the app as part of
 *     that site and lets its scripts read every note and call every route. The request arrives with the attacker's
 *     name in the Host header, so checking Host stops it (for reads as well as writes).
 *  2. Cross-site requests: a page on another site submits a form or loads an image whose address is this app.
 *     The browser labels those with Origin and Sec-Fetch-Site, so checking them stops it.
 *
 * Programs that aren't browsers (curl, the test suite, the sync command) send none of these labels and are let
 * through: anything already running on this Mac can read the notes folder directly anyway.
 */

const LOCAL_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Routes another site is allowed to send the browser to: the page Granola returns to after sign-in. */
const CROSS_SITE_OK = new Set(["/api/granola/callback"]);

/** "localhost:3000" → { name: "localhost", port: 3000 }. Undefined when it isn't a plain host[:port]. */
export function parseHost(value: string | undefined): { name: string; port: number | undefined } | undefined {
  if (!value) return undefined;
  const m = value.trim().toLowerCase().match(/^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/);
  if (!m) return undefined;
  return { name: m[1], port: m[2] === undefined ? undefined : Number(m[2]) };
}

/** Is this Host header one of this machine's own names, on the port the request actually arrived at? */
export function isLocalHost(hostHeader: string | undefined, localPort: number | undefined): boolean {
  const h = parseHost(hostHeader);
  if (!h || !LOCAL_NAMES.has(h.name)) return false;
  return (h.port ?? 80) === localPort;
}

/** Is this Origin header the app's own address (http, a local name, the same port)? */
export function isOwnOrigin(origin: string, localPort: number | undefined): boolean {
  const m = origin.trim().toLowerCase().match(/^http:\/\/(.+)$/);
  return !!m && isLocalHost(m[1], localPort);
}

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // Tailwind's compiled sheet is a file, but the app sets a few widths and colours with style attributes.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function refuse(res: Response, status: number, error: string) {
  res.status(status).json({ error });
}

/** Mount first, before the body parser and the static files. */
export function localGuard(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const port = req.socket.localPort;

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);

    if (!isLocalHost(req.headers.host, port)) {
      return refuse(res, 403, "StudyDeck only answers at its own address on this computer (http://localhost).");
    }

    const origin = req.headers.origin;
    const site = String(req.headers["sec-fetch-site"] ?? "").toLowerCase();
    // What the browser says about where the request came from. "none" means you typed the address or used a bookmark.
    const fromElsewhere = site !== "" && site !== "same-origin" && site !== "none";
    const isApi = req.path.startsWith("/api/");

    if (SAFE_METHODS.has(req.method)) {
      // Another site may link to the app's pages, but may not make the browser call its API (some reads start work).
      if (isApi && fromElsewhere && !CROSS_SITE_OK.has(req.path)) {
        return refuse(res, 403, "That request came from another website, so StudyDeck ignored it.");
      }
      return next();
    }

    if (typeof origin === "string" ? !isOwnOrigin(origin, port) : fromElsewhere) {
      return refuse(res, 403, "That request came from another website, so StudyDeck ignored it.");
    }
    // The app only ever sends JSON. Refusing other body types closes the "plain form post" route for good.
    const hasBody = Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;
    if (hasBody && !/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return refuse(res, 415, "StudyDeck only accepts JSON here.");
    }
    next();
  };
}
