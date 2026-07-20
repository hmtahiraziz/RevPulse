import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  HUBSPOT_CLIENT_ID: z.string().min(1, "HUBSPOT_CLIENT_ID is required"),
  HUBSPOT_CLIENT_SECRET: z.string().min(1, "HUBSPOT_CLIENT_SECRET is required"),
  HUBSPOT_REDIRECT_URI: z.string().url("HUBSPOT_REDIRECT_URI must be a valid URL"),
  HUBSPOT_SCOPES: z.string().min(1).default("crm.objects.contacts.read oauth"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  FRONTEND_URL: z.string().url("FRONTEND_URL must be a valid URL").default("http://localhost:5173"),
  PORT: z.coerce.number().default(3001),
  // Optional: when set, contacts are enriched with Stripe payment data.
  // An empty string (e.g. `STRIPE_SECRET_KEY=`) is treated as unset.
  STRIPE_SECRET_KEY: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(1).optional()
  ),
  // Optional: HubSpot Private App token. Used to seed data and as a fallback
  // for reading deals when the OAuth connection lacks the deals scope.
  HUBSPOT_PRIVATE_APP_TOKEN: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(1).optional()
  ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
