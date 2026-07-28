import { Router } from "express";
import { config } from "../config.js";
import { buildAuthUrl, exchangeCodeForToken, getTokenInfo } from "../hubspot.js";
import { saveTokens } from "../tokenStore.js";

// Mounted at /api/auth. Kicks off the OAuth flow.
export const authRouter = Router();

authRouter.get("/install", (_req, res) => {
  res.redirect(buildAuthUrl());
});

// Mounted at /oauth-callback to match the HubSpot app's registered redirect URL.
// HubSpot redirects here with ?code=... after the user approves.
export const callbackRouter = Router();

callbackRouter.get("/", async (req, res) => {
  const code = req.query.code;
  const error = req.query.error;

  if (typeof error === "string") {
    return res.redirect(`${config.FRONTEND_URL}/?error=${encodeURIComponent(error)}`);
  }
  if (typeof code !== "string") {
    return res.redirect(`${config.FRONTEND_URL}/?error=missing_code`);
  }

  try {
    const tokens = await exchangeCodeForToken(code);
    const info = await getTokenInfo(tokens.access_token);
    await saveTokens(info.hub_id, tokens);
    res.redirect(`${config.FRONTEND_URL}/?portalId=${info.hub_id}`);
  } catch (err) {
    console.error("[oauth-callback] OAuth exchange failed:", err);
    res.redirect(`${config.FRONTEND_URL}/?error=oauth_failed`);
  }
});
