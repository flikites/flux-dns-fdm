const dotenv = require("dotenv");
dotenv.config();
const axios = require("axios");
const gamedig = require("gamedig");

const {
  api,
  findMostCommonResponse,
  getWorkingNodes,
  checkConnection,
} = require("./utils");

async function checkIP(workerData) {
  const { app_name, app_port, zone_name, domain_name } = workerData;
  try {
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

    const commonIps = findMostCommonResponse(responseData).map((ip) => {
      if (ip.includes(":")) {
        return ip.split(":")[0];
      }
      return ip;
    });
    const liveIps = [];
    for (const ip of commonIps) {
      const isMinecraftActive = await checkMinecraftActivity(ip, app_port);

      if (isMinecraftActive) {
        liveIps.push(ip);
      } else {
        console.log(
          `Minecraft server for ${ip} is not active. Skipping DNS update.`
        );
      }
    }

    console.log("app_name: ", app_name);
    console.log("app_port: ", app_port);
    console.log("flux Consensus live Ip list for minecraft app: ", liveIps);

    for (const ip of liveIps) {
      try {
        await createOrDeleteRecord(ip, app_port, domain_name, zone_name);
      } catch (error) {
        console.log(error?.message ?? error);
      }
    }
  } catch (error) {
    console.error(error?.message ?? error);
  }
}

async function checkMinecraftActivity(ip, app_port) {
  try {
    const response = await gamedig.query({
      type: "minecraft",
      host: ip,
      port: app_port,
    });

    return response?.ping; // Check if Minecraft server is online
  } catch (error) {
    console.log(
      `Error while checking Minecraft activity for server ${ip}: ${error}`
    );
    return false;
  }
}

async function createOrDeleteRecord(selectedIp, appPort, domainName, zoneName) {
  // Check if the selected IP returns success response
  const isConnected = await checkConnection(selectedIp, appPort);
  console.log(
    `Checking if IP exists /zones/${zoneName}/dns_records?type=A&name=${domainName}&content=${selectedIp}`
  );

  const records = await api
    .get(`/zones/${zoneName}/dns_records?type=A&name=${domainName}`)
    .then(async ({ data }) => {
      const validRecords = [];
      for (const record of data?.result ?? []) {
        try {
          const isConnected = await checkConnection(record.content, appPort);
          if (isConnected) {
            validRecords.push(record);
          } else {
            console.log(
              `Deleting bad record: IP ${record.content} Domain ${domainName}`
            );
            await api.delete(`/zones/${zoneName}/dns_records/${record.id}`);
          }
        } catch (error) {
          console.log(
            `Deleting bad record: IP ${record.content} Domain ${domainName}`
          );
          await api.delete(`/zones/${zoneName}/dns_records/${record.id}`);
        }
      }
      return validRecords;
    });

  const selectedRecord = records.find(
    (record) => record.content === selectedIp
  );
  if (isConnected) {
    if (!selectedRecord) {
      console.log(
        `Creating new record for IP ${selectedIp} in Cloudflare DNS Server`
      );
      // Create new DNS record
      await api.post(`/zones/${zoneName}/dns_records`, {
        type: "A",
        name: domainName,
        content: selectedIp,
        ttl: 60,
      });
      console.log(
        `Created new record for IP ${selectedIp} in Cloudflare DNS Server`
      );
    } else {
      console.log(
        `Record for IP ${selectedIp} already exists in Cloudflare DNS Server`
      );
    }
  } else if (!isConnected && selectedRecord) {
    console.log(`Unsuccessful response from IP ${selectedIp}`);
    await api.delete(`/zones/${zoneName}/dns_records/${selectedRecord.id}`);
    console.log(`IP ${selectedIp} deleted from DNS server`);
  }
}

module.exports = {
  checkIP,
};
