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
const DNS_ZONES_NAME = process.env.DNS_ZONE_NAME?.split(",")
  .filter((d) => d.trim())
  .map((d) => d.trim());
const DOMAINS_NAME = process.env.DOMAIN_NAME?.split(",")
  .filter((d) => d.trim())
  .map((d) => d.trim());

async function main() {
  let workers = [];
  const workingIpsByZone = {};

  await Promise.all(
    DNS_ZONES_NAME.map((zone) => {
      return getHealthyIp(zone, APPS_PORT).then((ips) => {
        workingIpsByZone[zone] = ips;
      });
    })
  );

  for (let i = 0; i < APPS_NAME.length; i++) {
    workers.push(
      checkIP({
        app_name: APPS_NAME[i],
        app_port: APPS_PORT[i],
        zone_name: DNS_ZONES_NAME[i],
        domain_name: DOMAINS_NAME[i],
        working_addresses: workingIpsByZone[DNS_ZONES_NAME[i]],
      })
    );
  }
  await Promise.all(workers);
}

async function getHealthyIp(zone, ports) {
  console.log("==============zone============");
  console.log(zone);
  console.log("=============zone=============");

  const workingIPs = [];
  const { data } = await api.get(`/zones/${zone}/dns_records?type=A`);
  // const records = data?.result?.filter((item) => item.type === "A") ?? [];
  const records = data?.result ?? [];
  for (const record of records) {
    let isHealthy = false;
    for (const port of ports) {
      try {
        console.log(`checking http://${record.content}:${port}`);
        const connected = await checkConnection(record.content, port);
        if (connected) {
          isHealthy = true;
          workingIPs.push(record.content);
          console.info(`looks healthy: http://${record.content}:${port}`);
          break;
        }
      } catch (error) {
        console.log(`H->Error connecting to ${record.content}:${port}`);
      }
    }

    if (!isHealthy) {
      console.log(
        `Health check failed IP:${record.content} deleting from dns server`
      );
      await api
        .delete(`/zones/${zone}/dns_records/${record.id}`)
        .catch(console.log);
    }
  }
  return workingIPs;
}

if (require.main === module) {
  main();
  cron.schedule("*/10 * * * *", () => {
    main();
  });
}
