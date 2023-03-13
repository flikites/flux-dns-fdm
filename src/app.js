const dotenv = require("dotenv");
dotenv.config();
// const { workerData } = require("worker_threads");
const axios = require("axios");

const {
  findMostCommonResponse,
  getWorkingNodes,
  checkConnection,
  api,
} = require("./utils");

async function checkIP(workerData) {
  const { app_name, app_port, zone_name, domain_name, working_addresses } =
    workerData;
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

    console.log("app_name: ", app_name);
    console.log("app_port: ", app_port);
    console.log("flux Consensus Ip list for app: ", commonIps);
    console.log("dns server retunrned IP: ", working_addresses);

    for (const ip of commonIps) {
      try {
        await createOrDeleteRecord(
          ip,
          working_addresses,
          app_port,
          domain_name,
          zone_name
        );
      } catch (error) {
        console.log(error?.message ?? error);
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
        `Creating new record for IP: ${selectedIp} in Power DNS Server`
      );
      // Create new DNS record
      await api.post("", {
        action: "addRecord",
        zone: zone_name,
        type: "A",
        name: domain_name,
        content: selectedIp,
      });
    } else {
      console.log(
        `Record for IP: ${selectedIp} already exists in Power DNS Server`
      );
    }
  } else if (!connected && records.includes(selectedIp)) {
    console.log(`Unsuccessful response from IP: ${selectedIp}`);
    console.log(
      `IP: ${selectedIp} will be deleted from dns server next iteration`
    );
  }
}

// checkIP();
module.exports = {
  checkIP,
};
