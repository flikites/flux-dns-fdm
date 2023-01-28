const cron = require("node-cron");
const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();

const { findMostCommonResponse, getFluxNodes } = require("./utils");

const WORKING_FLUX_NODE = "https://api.runonflux.io";
const DNS_SERVER_ADDRESS =
  process.env.DNS_SERVER_ADDRESS ?? "http://146.190.112.16:5380";
const DNS_ZONE_NAME = process.env.DNS_ZONE_NAME;
const DNS_SERVER_TOKEN = process.env.DNS_SERVER_TOKEN;
const DOMAIN_NAME = process.env.DOMAIN_NAME;
const APP_PORT = process.env.APP_PORT;
const APP_NAME = process.env.APP_NAME;
// /api/zones/records/add?token=x&domain=try.fluxvpn&zone=fluxvpn&ttl=60&type=A&ipAddress={healthyIPofapp}
// /api/zones/records/get?token=x&domain=example.com&zone=example.com
// /api/zones/records/delete?token=x&domain=example.com&zone=example.com&type=A&ipAddress=127.0.0.1
async function checkIP() {
  try {
    // Array of URLs
    const fluxNodes = await getFluxNodes();
    // Select 5 random URLs
    const randomFluxNodes = fluxNodes
      .sort(() => 0.5 - Math.random())
      .slice(0, 5);
    const randomUrls = randomFluxNodes.map(
      (ip) => `http://${ip}:16127/apps/location/${APP_NAME}`
    );
    randomUrls.push(`${WORKING_FLUX_NODE}/apps/location/${APP_NAME}`);
    // const randomUrls = urls.sort(() => 0.5 - Math.random()).slice(0, 5);
    console.log("Selected URLs: ", randomUrls);
    // Make GET request to the selected URLs
    const requests = randomUrls.map((url) =>
      axios.get(url).catch((error) => {
        console.log(`Error while making request to ${url}: ${error}`);
      })
    );
    const responses = await axios.all(requests).catch((error) => {
      console.log(`Error while making concurrent requests: ${error}`);
    });
    let responseData = [];
    for (let i = 0; i < responses.length; i++) {
      if (responses[i] && responses[i].data) {
        const data = responses[i].data.data;
        console.log(`Received IPs from ${randomUrls[i]}:`, data);
        responseData.push(data.map((item) => item.ip));
      }
    }
    console.log("responseData ", responseData);
    // Find the most common IP
    const commonIps = findMostCommonResponse(responseData).map((ip) => {
      if (ip.includes(":")) {
        return ip.split(":")[0];
      }
      return ip;
    });
    console.log(`Most common IP: ${commonIps}`);

    const ipRecords = await getRecords();

    const badIps = ipRecords.filter((ip) => !commonIps.includes(ip));

    for (const ip of commonIps) {
      try {
        await createOrDeleteRecord(ip, ipRecords);
      } catch (error) {
        console.log(error?.message ?? error);
      }
    }
    //deleting bad ips from dns record
    for (const badIp of badIps) {
      try {
        await deleteRecord(badIp);
      } catch (error) {
        console.log(error?.message ?? error);
      }
    }
  } catch (error) {
    console.error(error?.message ?? error);
  }
}

async function createOrDeleteRecord(selectedIp, records = []) {
  console.log(`Selected IP: ${selectedIp}`);
  // Check if the selected IP returns success response
  const checkIpResponse = await axios.get(`http://${selectedIp}:${APP_PORT}`);
  if (checkIpResponse.status === 200) {
    console.log(`Successful response from IP: ${selectedIp}`);

    if (!records.includes(selectedIp)) {
      console.log(
        `Creating new record for IP: ${selectedIp} in Technitium DNS Server`
      );
      // Create new DNS record
      await axios.get(
        `${DNS_SERVER_ADDRESS}/api/zones/records/add?token=${DNS_SERVER_TOKEN}&domain=${DOMAIN_NAME}&zone=${DNS_ZONE_NAME}&ttl=60&type=A&ipAddress=${selectedIp}`
      );
    } else {
      console.log(
        `Record for IP: ${selectedIp} already exists in Technitium DNS Server`
      );
    }
  } else if (checkIpResponse.status !== 200 && records.includes(selectedIp)) {
    console.log(`Unsuccessful response from IP: ${selectedIp}`);
    // Delete DNS record
    await deleteRecord(selectedIp);
  }
}

async function deleteRecord(ip) {
  await axios.get(
    `${DNS_SERVER_ADDRESS}/api/zones/records/delete?token=${DNS_SERVER_TOKEN}&domain=${DOMAIN_NAME}&zone=${DNS_ZONE_NAME}&type=A&ipAddress=${ip}`
  );
  console.log("Deleted Bad Record From Dns Record IP: ", ip);
}

async function getRecords() {
  const url = `${DNS_SERVER_ADDRESS}/api/zones/records/get?token=${DNS_SERVER_TOKEN}&domain=${DOMAIN_NAME}&zone=${DNS_ZONE_NAME}`;
  console.log("url ", url);
  const { data } = await axios.get(url);
  return data.response.records
    .filter((record) => record.type === "A")
    .map((item) => item.rData.ipAddress);
}

if (require.main === module) {
  checkIP();
  cron.schedule("*/5 * * * *", () => {
    console.log("=========schedule run========");
    checkIP();
  });
}
