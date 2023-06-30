const fs = require("fs").promises;
const path = require("path");
const gamedig = require("gamedig");
const dotenv = require("dotenv");
dotenv.config();
const axios = require("axios");

const {
  api,
  findMostCommonResponse,
  getWorkingNodes,
  checkConnection,
} = require("./utils");

const clusterFilePath = path.join(process.env.FILE_PATH, "cluster_ip.txt");

async function checkIP(workerData) {
  const { app_name, app_port, zone_name, domain_name } = workerData;
  try {
    if (await fs.access(clusterFilePath)) {
      const ip = (await fs.readFile(clusterFilePath, "utf8"))
        .split("\n")[0]
        .split(":")[0];
      const isConnected = await checkConnection(ip, app_port);
      if (isConnected) {
        console.log("master node is active ", ip);
      } else {
        await createOrDeleteRecord(ip, app_port, domain_name, zone_name);
        console.log("creating new node, old node is not working");
        await createNew(app_name, app_port, zone_name, domain_name);
      }
    } else {
      await createNew(app_name, app_port, zone_name, domain_name);
    }
  } catch (error) {
    console.error(`Error in checkIP function: ${error}`);
  }
}

async function createNew(app_name, app_port, zone_name, domain_name) {
  try {
    const randomFluxNodes = await getWorkingNodes();
    const randomUrls = randomFluxNodes.map(
      (ip) => `http://${ip}:16127/apps/location/${app_name}`
    );

    const responses = await getResponses(randomUrls);

    let responseData = [];
    for (let i = 0; i < responses.length; i++) {
      if (responses[i] && responses[i].data) {
        const data = responses[i].data.data;
        responseData.push(
          data.map((item) => ({ ip: item.ip, hash: item.hash }))
        );
      }
    }

    const commonIps = findMostCommonResponse(responseData).map((item) => {
      if (item.ip.includes(":")) {
        return { ip: item.ip.split(":")[0], hash: item.hash };
      }
      return item;
    });

    const liveIps = [];
    for (const item of commonIps) {
      const r = await checkMinecraftActivity(item.ip, app_port);
      const c = await checkConnection(item.ip, app_port);
      if (r) {
        liveIps.push(item);
      } else {
        if (!r)
          console.log(`minecraft activity check failed for ip: ${item.ip}`);
        if (!c) console.log(`connection check failed for ip: ${item.ip}`);
      }
    }

    console.log("app_name: ", app_name);
    console.log("app_port: ", app_port);
    console.log("flux Consensus live Ip list for minecraft app: ", liveIps);
    // write liveIps to the file
    let fileContent = "";
    liveIps.forEach((ip, index) => {
      fileContent += `${ip.ip}:${index === 0 ? "MASTER" : "SECONDARY"}:${
        ip.hash
      }\n`;
    });

    await fs.writeFile(clusterFilePath, fileContent);

    console.log("fileContent ", fileContent);

    try {
      await createOrDeleteRecord(
        liveIps[0].ip,
        app_port,
        domain_name,
        zone_name
      );
    } catch (error) {
      console.log(`Error while creating or deleting record: ${error}`);
    }
  } catch (error) {
    console.error(`Error in createNew function: ${error}`);
  }
}

async function getResponses(urls) {
  try {
    const requests = urls.map((url) =>
      axios.get(url).catch((error) => {
        console.log(`Error while making request to ${url}: ${error}`);
      })
    );

    const responses = await axios.all(requests).catch((error) => {
      console.log(`Error while making concurrent requests: ${error}`);
    });

    return responses;
  } catch (error) {
    console.error(`Error in getResponses function: ${error}`);
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
