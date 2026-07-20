import "dotenv/config";
import axios from "axios";
import Stripe from "stripe";

/**
 * Seeds Stripe test data that lines up with the HubSpot contacts, so the
 * Revenue Intelligence tab has something to reconcile:
 *   - ~matched customers (charges + a mix of active / canceled subscriptions)
 *   - a few "leak" customers whose email is NOT in HubSpot
 *   - remaining HubSpot contacts are left unmatched ("ghosts")
 *
 * Requires: STRIPE_SECRET_KEY (test key) and HUBSPOT_PRIVATE_APP_TOKEN.
 * Run: npm run seed:stripe -w apps/backend
 */

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const HS_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;

if (!STRIPE_KEY) {
  console.error("Missing STRIPE_SECRET_KEY (use a test key, sk_test_...).");
  process.exit(1);
}
if (!HS_TOKEN) {
  console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN (needed to read contact emails).");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_KEY);

const MATCHED = Number(process.env.SEED_STRIPE_MATCHED ?? 15);
const LEAKS = Number(process.env.SEED_STRIPE_LEAKS ?? 4);
const runId = Date.now().toString(36);

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

interface HsContact {
  firstname?: string | null;
  lastname?: string | null;
  email?: string | null;
}

async function fetchHubspotContacts(): Promise<HsContact[]> {
  const { data } = await axios.get(
    "https://api.hubapi.com/crm/v3/objects/contacts",
    {
      params: { limit: 100, properties: "firstname,lastname,email" },
      headers: { Authorization: `Bearer ${HS_TOKEN}` },
    }
  );
  return (data.results ?? []).map((r: { properties: HsContact }) => r.properties);
}

async function createPaidCustomer(
  email: string,
  name: string,
  opts: { charges: number; sub: "none" | "active" | "canceled" },
  priceId: string
): Promise<void> {
  const customer = await stripe.customers.create({ email, name });
  const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: pm.id },
  });

  for (let i = 0; i < opts.charges; i++) {
    await stripe.paymentIntents.create({
      amount: randInt(20, 400) * 100,
      currency: "usd",
      customer: customer.id,
      payment_method: pm.id,
      confirm: true,
      off_session: true,
    });
  }

  if (opts.sub !== "none") {
    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
    });
    if (opts.sub === "canceled") {
      await stripe.subscriptions.cancel(sub.id);
    }
  }
}

async function main() {
  console.log("Reading HubSpot contacts...");
  const contacts = (await fetchHubspotContacts()).filter((c) => c.email);
  if (contacts.length === 0) {
    console.error("No HubSpot contacts with emails found. Seed contacts first.");
    process.exit(1);
  }

  console.log("Creating Stripe product + price...");
  const product = await stripe.products.create({ name: "RevPulse Test Plan" });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: 2000,
    currency: "usd",
    recurring: { interval: "month" },
  });

  const matched = contacts.slice(0, MATCHED);
  console.log(`Creating ${matched.length} matched customers...`);
  let created = 0;
  for (let i = 0; i < matched.length; i++) {
    const c = matched[i];
    const name = `${c.firstname ?? ""} ${c.lastname ?? ""}`.trim() || "Customer";
    // Distribute: some no sub, some active, some canceled (churn).
    const sub: "none" | "active" | "canceled" =
      i % 4 === 0 ? "canceled" : i % 3 === 0 ? "active" : "none";
    try {
      await createPaidCustomer(c.email!, name, { charges: randInt(1, 3), sub }, price.id);
      created++;
    } catch (err) {
      console.error(`  failed for ${c.email}:`, (err as Error).message);
    }
  }

  console.log(`Creating ${LEAKS} leak customers (not in HubSpot)...`);
  let leaks = 0;
  for (let i = 0; i < LEAKS; i++) {
    const email = `leak.${runId}.${i}@notinhubspot.com`;
    try {
      await createPaidCustomer(
        email,
        `Leak Customer ${i}`,
        { charges: randInt(1, 2), sub: i % 2 === 0 ? "active" : "none" },
        price.id
      );
      leaks++;
    } catch (err) {
      console.error(`  failed for ${email}:`, (err as Error).message);
    }
  }

  console.log(`Done. Matched customers: ${created}, leak customers: ${leaks}.`);
  console.log("Open the Revenue Intelligence tab to see the reconciliation.");
}

main().catch((err) => {
  console.error("Stripe seed failed:", err);
  process.exit(1);
});
