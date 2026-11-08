import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

interface Stored {
  /** The redirect URL the app was registered with (it includes the port). */
  redirectUrl?: string;
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
  state?: string;
}

export function readStored(file: string): Stored {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeStored(file: string, patch: Partial<Stored>) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = { ...readStored(file), ...patch };
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** True once a login has completed at some point (tokens are on disk). */
export const hasTokens = (file: string) => !!readStored(file).tokens?.access_token;

/**
 * Stores Granola's login in a private file under ./data (git-ignored, mode 600).
 * The MCP client library drives the standard OAuth flow (app registration, PKCE, token refresh) through this.
 */
export class FileAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly file: string,
    private readonly redirect: string,
    private readonly onRedirect: (url: URL) => void = () => {},
  ) {}

  get redirectUrl() {
    return this.redirect;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "StudyDeck (local study app)",
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state() {
    const state = randomBytes(16).toString("hex");
    writeStored(this.file, { state });
    return state;
  }

  clientInformation() {
    const s = readStored(this.file);
    // A registration is tied to its redirect URL (which includes the port). If that changed, register again.
    return s.redirectUrl === this.redirect ? s.client : undefined;
  }

  saveClientInformation(client: OAuthClientInformationMixed) {
    writeStored(this.file, { client, redirectUrl: this.redirect });
  }

  tokens() {
    return readStored(this.file).tokens;
  }

  saveTokens(tokens: OAuthTokens) {
    writeStored(this.file, { tokens });
  }

  redirectToAuthorization(url: URL) {
    this.onRedirect(url);
  }

  saveCodeVerifier(verifier: string) {
    writeStored(this.file, { verifier });
  }

  codeVerifier() {
    const v = readStored(this.file).verifier;
    if (!v) throw new Error("No login is in progress.");
    return v;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all") writeStored(this.file, { client: undefined, tokens: undefined, verifier: undefined, state: undefined });
    if (scope === "client") writeStored(this.file, { client: undefined });
    if (scope === "tokens") writeStored(this.file, { tokens: undefined });
    if (scope === "verifier") writeStored(this.file, { verifier: undefined });
  }
}
