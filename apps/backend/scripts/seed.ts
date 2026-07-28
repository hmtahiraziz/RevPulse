import "dotenv/config";
import axios from "axios";

/**
 * Seeds dummy contacts into a HubSpot test account using a Private App token.
 *
 * Usage:
 *   1. HubSpot test account -> Settings -> Integrations -> Private Apps -> Create
 *      with scope `crm.objects.contacts.write` (and `...read`).
 *   2. Copy the token (starts with `pat-...`).
 *   3. Run one of:
 *        HUBSPOT_PRIVATE_APP_TOKEN=pat-xxx npm run seed -w apps/backend
 *      or add HUBSPOT_PRIVATE_APP_TOKEN=pat-xxx to apps/backend/.env, then:
 *        npm run seed -w apps/backend
 *   4. Optional: control how many contacts with SEED_COUNT (default 40).
 */

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const COUNT = Number(process.env.SEED_COUNT ?? 40);
const BATCH_URL = "https://api.hubapi.com/crm/v3/objects/contacts/batch/create";

if (!TOKEN) {
  console.error(
    "Missing HUBSPOT_PRIVATE_APP_TOKEN. Create a HubSpot Private App with " +
      "crm.objects.contacts.write and pass its token via env."
  );
  process.exit(1);
}

const FIRST_NAMES = [
  "Olivia", "Liam", "Emma", "Noah", "Ava", "Ethan", "Sophia", "Mason",
  "Isabella", "Lucas", "Mia", "Aiden", "Charlotte", "Elijah", "Amelia",
  "James", "Harper", "Benjamin", "Evelyn", "Henry",
];
const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
  "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Wilson", "Lee",
  "Walker", "Hall", "Allen", "Young", "King", "Wright",
];
const COMPANIES = [
  "Acme Corp", "Globex", "Initech", "Umbrella LLC", "Soylent Co",
  "Hooli", "Stark Industries", "Wayne Enterprises", "Wonka Inc", "Cyberdyne",
];

const pick = <T>(arr: T[], i: number): T => arr[i % arr.length];
const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// Unique run id so re-running the script never collides on email.
const runId = Date.now().toString(36);

interface ContactInput {
  properties: Record<string, string>;
}

function buildContacts(n: number): ContactInput[] {
  const contacts: ContactInput[] = [];

  for (let i = 0; i < n; i++) {
    const firstname = pick(FIRST_NAMES, i);
    const lastname = pick(LAST_NAMES, i * 3 + 1);
    const email = `${firstname}.${lastname}.${runId}${i}@example.com`.toLowerCase();

    const properties: Record<string, string> = { email, firstname, lastname };

    // Vary completeness so data-quality features have something to find.
    if (i % 5 !== 0) properties.phone = `+1415${String(1000000 + i).slice(-7)}`;
    if (i % 7 !== 0) properties.company = rand(COMPANIES);
    if (i % 11 === 0) delete properties.lastname; // a few missing last names

    contacts.push({ properties });
  }

  // Add a few name-duplicates (same first+last, different email) to exercise
  // duplicate detection.
  for (let d = 0; d < 3; d++) {
    const base = contacts[d];
    contacts.push({
      properties: {
        email: `dup.${runId}.${d}@example.com`,
        firstname: base.properties.firstname,
        lastname: base.properties.lastname ?? "Doe",
        company: rand(COMPANIES),
      },
    });
  }

  return contacts;
}

async function createBatch(inputs: ContactInput[]): Promise<number> {
  const { data } = await axios.post(
    BATCH_URL,
    { inputs },
    { headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } }
  );
  return data.results?.length ?? 0;
}

async function main() {
  const contacts = buildContacts(COUNT);
  console.log(`Seeding ${contacts.length} contacts into HubSpot...`);

  let created = 0;
  // HubSpot batch create accepts up to 100 inputs per request.
  for (let i = 0; i < contacts.length; i += 100) {
    const chunk = contacts.slice(i, i + 100);
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

  console.log(`Done. Created ${created} contacts.`);
  console.log("Refresh the dashboard to see them.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
