import "dotenv/config";
import axios from "axios";

/**
 * Seeds dummy deals into a HubSpot test account using the Private App token.
 * The private app needs `crm.objects.deals.write`.
 *
 * Usage (token read from apps/backend/.env HUBSPOT_PRIVATE_APP_TOKEN):
 *   npm run seed:deals -w apps/backend
 *   SEED_DEALS_COUNT=30 npm run seed:deals -w apps/backend
 */

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const COUNT = Number(process.env.SEED_DEALS_COUNT ?? 20);
const BATCH_URL = "https://api.hubapi.com/crm/v3/objects/deals/batch/create";

if (!TOKEN) {
  console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN (needs crm.objects.deals.write).");
  process.exit(1);
}

// Standard stage ids of HubSpot's default deal pipeline.
const STAGES = [
  "appointmentscheduled",
  "qualifiedtobuy",
  "presentationscheduled",
  "decisionmakerboughtin",
  "contractsent",
  "closedwon",
  "closedlost",
];

const NAMES = [
  "Acme", "Globex", "Initech", "Umbrella", "Soylent", "Hooli", "Stark",
  "Wayne", "Wonka", "Cyberdyne", "Massive Dynamic", "Pied Piper",
];

const runId = Date.now().toString(36);
const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

interface DealInput {
  properties: Record<string, string>;
}

function buildDeals(n: number): DealInput[] {
  const deals: DealInput[] = [];
  for (let i = 0; i < n; i++) {
    const stage = STAGES[i % STAGES.length];
    const amount = randInt(2, 120) * 500; // $1k - $60k
    const closeInDays = randInt(-20, 60);
    const closedate = new Date(Date.now() + closeInDays * 86400000)
      .toISOString()
      .slice(0, 10);

    deals.push({
      properties: {
        dealname: `${rand(NAMES)} deal ${runId}-${i}`,
        amount: String(amount),
        pipeline: "default",
        dealstage: stage,
        closedate,
      },
    });
  }
  return deals;
}

async function createBatch(inputs: DealInput[]): Promise<number> {
  const { data } = await axios.post(
    BATCH_URL,
    { inputs },
    { headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } }
  );
  return data.results?.length ?? 0;
}

async function main() {
  const deals = buildDeals(COUNT);
  console.log(`Seeding ${deals.length} deals into HubSpot...`);

  let created = 0;
  for (let i = 0; i < deals.length; i += 100) {
    const chunk = deals.slice(i, i + 100);
    try {
      created += await createBatch(chunk);
      console.log(`  batch ${i / 100 + 1}: created ${chunk.length}`);
    } catch (err) {
      const e = err as { response?: { status?: number; data?: unknown } };
      console.error(
        `  batch ${i / 100 + 1} failed (status ${e.response?.status}):`,
        JSON.stringify(e.response?.data ?? (err as Error).message)
      );
    }
  }

  console.log(`Done. Created ${created} deals.`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
