const dotenv = require("dotenv");
dotenv.config();
const cron = require("node-cron");
const { api } = require("./utils");
const { checkIP } = require("./app");

const APP_NAME = process.env.APP_NAME?.trim();
const APP_PORT = process.env.APP_PORT?.trim();
const DOMAIN_NAMES = process.env.DOMAIN_NAME?.split(",")
  .filter((d) => d.trim())
  .map((d) => d.trim());
const ZONE_NAME = process.env.ZONE_NAME;

async function main() {
  const zoneId = await getOrCreateZone(ZONE_NAME);
  await checkIP({
    app_name: APP_NAME,
    app_port: APP_PORT,
    zone_name: zoneId,
    domain_names: DOMAIN_NAMES,
  });
}

async function getOrCreateZone(zoneName) {
  try {
    const { data: zoneData } = await api.get(
      `/zones?account.id=${process.env.DNS_SERVER_ACCOUNT_ID}`
    );
    let existingZone = zoneData.result.find((z) => z.name === zoneName);

    if (!existingZone) {
      existingZone = await createZone(zoneName);
    }

    return existingZone.id;
  } catch (error) {
    console.log(error?.message ?? error);
  }
  return null;
}

async function createZone(name) {
  console.log("Creating new zone with name", name);
  try {
    const result = await api.post(`/zones`, {
      name: name,
      type: "full",
      account: {
        id: process.env.DNS_SERVER_ACCOUNT_ID,
      },
    });
    console.log("Created", result);
    return { id: result.data.result.id, name: result.data.result.name };
  } catch (error) {
    console.log("Failed");
    console.log(error?.message ?? error);
    return null;
  }
}

if (require.main === module) {
  main();
  cron.schedule("*/1 * * * *", main);
}
