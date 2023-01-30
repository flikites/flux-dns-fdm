const dotenv = require("dotenv");
dotenv.config();
const cron = require("node-cron");
const axios = require("axios");
const { checkIP } = require("./app");

const DNS_SERVER_ADDRESS =
  process.env.DNS_SERVER_ADDRESS ?? "http://146.190.112.16:5380";
const DNS_SERVER_TOKEN = process.env.DNS_SERVER_TOKEN;

const APPS_NAME = process.env.APP_NAME?.split(",");
const APPS_PORT = process.env.APP_PORT?.split(",");
const DNS_ZONES_NAME = process.env.DNS_ZONE_NAME?.split(",");
const DOMAINS_NAME = process.env.DOMAIN_NAME?.split(",");

async function main() {
  let workers = [];
  await createNotAvailableZones(DNS_ZONES_NAME);

  for (let i = 0; i < APPS_NAME.length; i++) {
    console.log("Worker: ", i + 1);
    workers.push(
      checkIP({
        app_name: APPS_NAME[i],
        app_port: APPS_PORT[i],
        zone_name: DNS_ZONES_NAME[i],
        domain_name: DOMAINS_NAME[i],
      })
    );
  }

  await Promise.all(workers);
}

async function createNotAvailableZones(zones = []) {
  try {
    // get all zones from dns server
    const { data } = await axios.get(
      `${DNS_SERVER_ADDRESS}/api/zones/list?token=${DNS_SERVER_TOKEN}`
    );
    // we only need the zone names so maping over response and getting the names
    const availabeZones = data.response.zones.map((item) => item.name);
    //filtering not availale zones from response
    const unavailableZones = zones.filter(
      (zone) => !availabeZones.includes(zone)
    );

    //creating new zone if they not existed in previous response
    if (unavailableZones.length) {
      await axios.all(unavailableZones.map(createZone)).catch((error) => {
        console.log(`Zone Error while making concurrent requests: ${error}`);
      });
    }
  } catch (error) {
    console.log(error?.message ?? error);
  }
}

function createZone(zone) {
  return axios
    .get(
      `${DNS_SERVER_ADDRESS}/api/zones/create?token=${DNS_SERVER_TOKEN}&zone=${zone}&type=Primary`
    )
    .catch((e) => console.log(e?.message ?? e));
}

if (require.main === module) {
  main();
  cron.schedule("*/6 * * * *", async () => {
    await main();
  });
}
