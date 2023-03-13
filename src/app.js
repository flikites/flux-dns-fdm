const dotenv = require("dotenv");
dotenv.config();
const axios = require("axios");

const {
  findMostCommonResponse,
  getWorkingNodes,
  checkConnection,
} = require("./utils");

const DNS_SERVER_ADDRESS =
  process.env.DNS_SERVER_ADDRESS ?? "http://146.190.112.16:5380";
const DNS_SERVER_TOKEN = process.env.DNS_SERVER_TOKEN;

async function checkIP(workerData) {
  const { app_name, app_port, zone_name, domain_name } = workerData;
  try {
    // Array of URLs
    // const fluxNodes = await getFluxNodes();
    // // Select 5 random URLs
    // const randomFluxNodes = fluxNodes
    //   .sort(() => 0.5 - Math.random())
    //   .slice(0, 5);
    const randomFluxNodes = await getWorkingNodes();

    const randomUrls = randomFluxNodes.map(
      (ip) => `http://${ip}:16127/apps/location/${app_name}`
    );

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
        responseData.push(data.map((item) => item.ip));
      }
    }

    // Find the most common IP
    const commonIps = findMostCommonResponse(responseData).map((ip) => {
      if (ip.includes(":")) {
        return ip.split(":")[0];
      }
      return ip;
    });

    const ipRecords = await getRecords(domain_name, zone_name);

    const badIps = ipRecords.filter((ip) => !commonIps.includes(ip));

    console.log("app_name: ", app_name);
    console.log("app_port: ", app_port);
    console.log("flux Consensus Ip list for app: ", commonIps);
    console.log("dns server retunrned IP: ", ipRecords);

    for (const ip of commonIps) {
      try {
        await createOrDeleteRecord(
          ip,
          ipRecords,
          app_port,
          domain_name,
          zone_name
        );
      } catch (error) {
        console.log(error?.message ?? error);
      }
    }
    //deleting bad ips from dns record
    for (const badIp of badIps) {
      try {
        // we are adding extra check here if get success response we will not
        const connected = await checkConnection(badIp, app_port);
        // const r = await axios.get(`http://${badIp}:${app_port}`);
        // console.log("r ", r.status);
        if (!connected) {
          throw new Error(`unable to connect ${`http://${badIp}:${app_port}`}`);
        }
      } catch (error) {
        console.log(error?.message ?? error);
        console.log(`not healthy ${`http://${badIp}:${app_port}`}`);
        await deleteRecord(badIp, domain_name, zone_name);
        console.log(
          `deleted IP:${badIp} for domain: ${domain_name} zone: ${zone_name} app: ${app_name}`
        );
      }
    }
  } catch (error) {
    console.error(error?.message ?? error);
  }
}

async function createOrDeleteRecord(
  selectedIp,
  records = [],
  app_port,
  domain_name,
  zone_name
) {
  // Check if the selected IP returns success response
  // const checkIpResponse = await axios.get(`http://${selectedIp}:${app_port}`);
  const connected = await checkConnection(selectedIp, app_port);
  if (connected) {
    if (!records.includes(selectedIp)) {
      console.log(
        `Creating new record for IP: ${selectedIp} in Technitium DNS Server`
      );
      // Create new DNS record
      await axios.get(
        `${DNS_SERVER_ADDRESS}/api/zones/records/add?token=${DNS_SERVER_TOKEN}&domain=${domain_name}&zone=${zone_name}&ttl=60&type=A&ipAddress=${selectedIp}`
      );
    } else {
      console.log(
        `Record for IP: ${selectedIp} already exists in Technitium DNS Server`
      );
    }
  } else if (!connected && records.includes(selectedIp)) {
    console.log(`Unsuccessful response from IP: ${selectedIp}`);
    // Delete DNS record
    await deleteRecord(selectedIp, domain_name, zone_name);
  }
}

async function deleteRecord(ip, domain_name, zone_name) {
  await axios.get(
    `${DNS_SERVER_ADDRESS}/api/zones/records/delete?token=${DNS_SERVER_TOKEN}&domain=${domain_name}&zone=${zone_name}&type=A&ipAddress=${ip}`
  );
}

async function getRecords(domain_name, zone_name) {
  const domain = domain_name.includes(".")
    ? getDomain(domain_name)
    : domain_name;
  const url = `${DNS_SERVER_ADDRESS}/api/zones/records/get?token=${DNS_SERVER_TOKEN}&domain=${domain}&zone=${zone_name}`;
  const { data } = await axios.get(url);
  return (
    data?.response?.records
      ?.filter((record) => record.type === "A")
      ?.map((item) => item.rData.ipAddress) ?? []
  );
}

function getDomain(domain) {
  const commonTlds = [
    ".com",
    ".net",
    ".org",
    ".edu",
    ".gov",
    ".uk",
    ".us",
    ".ca",
    ".au",
  ];
  let parts = domain.split(".");
  let tld = parts.pop();
  let tld_d = tld;
  tld = "." + tld;
  if (commonTlds.includes(tld)) {
    let secondLvlDomain = parts.pop();
    if (secondLvlDomain) {
      return secondLvlDomain + tld;
    } else {
      return domain;
    }
  } else {
    return tld_d;
  }
}

// checkIP();
module.exports = {
  checkIP,
};
