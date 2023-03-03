const dotenv = require("dotenv");
dotenv.config();
const cron = require("node-cron");
const { api, checkConnection } = require("./utils");
const { checkIP } = require("./app");

const APPS_NAME = process.env.APP_NAME?.split(",")
  .filter((d) => d.trim())
  .map((d) => d.trim());
const APPS_PORT = process.env.APP_PORT?.split(",")
  .filter((d) => d.trim())
  .map((d) => d.trim());
const DOMAINS_NAME = process.env.DOMAIN_NAME?.split(",")
  .filter((d) => d.trim())
  .map((d) => d.trim());

async function main() {
  let workers = [];

  const zones = await getOrCreateZones(DOMAINS_NAME);
  for (let i = 0; i < APPS_NAME.length; i++) {
    workers.push(
      checkIP({
        app_name: APPS_NAME[i],
        app_port: APPS_PORT[i],
        zone_name: zones.find((v) => DOMAINS_NAME[i].endsWith(v.name))?.id,
        domain_name: DOMAINS_NAME[i],
      })
    );
  }
  await Promise.all(workers);
}

async function getOrCreateZones(names = []) {
  const rootNames = names.map((n) => {
    const arr = n.split(".");
    return arr[arr.length - 2] + "." + arr[arr.length - 1];
  });

  try {
    const { data: zoneData } = await api.get(
      `/zones?account.id=${process.env.DNS_SERVER_ACCOUNT_ID}`
    );
    const existingZones = zoneData.result.filter((z) =>
      rootNames.includes(z.name)
    );
    const availableZoneNames = zoneData.result.map((item) => item.name);
    const unavailableZoneNames = rootNames.filter(
      (name) => !availableZoneNames.includes(name)
    );

    if (unavailableZoneNames.length) {
      const newZones = await createZones(unavailableZoneNames);
      existingZones.push(...newZones);
    }

    return existingZones.map((z) => ({ name: z.name, id: z.id }));
  } catch (error) {
    console.log(error?.message ?? error);
  }
  return [];
}

async function createZones(names) {
  const promises = names.map((name) =>
    createZone(name).catch((error) => {
      console.log(`Zone Error while making concurrent requests: ${error}`);
    })
  );
  const newZones = await Promise.all(promises);
  console.log(newZones);
  return newZones.filter((z) => z);
}

async function createZone(name) {
  console.log("creating new zone with name ", name);
  try {
    const result = await api.post(`/zones`, {
      name: name,
      type: "full",
      account: {
        id: process.env.DNS_SERVER_ACCOUNT_ID,
      },
    });
    console.log("created ", result);
    return { id: result.result.id, name: result.result.name };
  } catch (error) {
    console.log("failed");
    console.log(error?.message ?? error);
    return null;
  }
}

if (require.main === module) {
  main();
  cron.schedule("*/10 * * * *", () => {
    main();
  });
}
