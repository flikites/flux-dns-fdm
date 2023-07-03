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
    await fs.access(clusterFilePath);
  } catch (error) {
    await fs.mkdir(path.dirname(clusterFilePath), { recursive: true });
    await fs.writeFile(clusterFilePath, "");
  }

  try {
    const ip = (await fs.readFile(clusterFilePath, "utf8"))
      .split("\n")[0]
      .split(":")[0]
      .trim();

    if (ip) {
      const [isConnected, minecraftActive] = await Promise.all([
        checkConnection(ip, app_port),
        checkMinecraftActivity(ip, app_port),
      ]);

      console.log("isConnected ", isConnected);
      console.log("minecraftActive ", minecraftActive);

      if (isConnected && minecraftActive) {
        console.log("master node is active = passed gamedig check ", ip);
      } else {
        console.log("updating master node ip, old master node is not working");
        await createNew(app_name, app_port, zone_name, domain_name);
      }
    } else {
      console.log("cluster_ip.txt is empty creating and updating new master");
      await createNew(app_name, app_port, zone_name, domain_name);
    }
  } catch (error) {
    console.error(`Error in checkIP function: ${error}`);
    console.log(
      "updating new record file cluster_ip.txt does not exist or empty"
    );
    await createNew(app_name, app_port, zone_name, domain_name);
  }
}

async function checkAndAddLiveIps(commonIps, app_port) {
  const liveIps = [];
  for (const item of commonIps) {
    try {
      if (await checkConnection(item.ip, app_port)) {
        liveIps.push(item);
      } else {
        console.log(`connection check failed for ip: ${item.ip}`);
      }
    } catch (error) {
      console.log("connection check failed ", error?.message);
    }
  }
  return liveIps;
}

async function createOrUpdateFile(liveIps, newMasterIp = null) {
  console.log("liveIPS ", liveIps);
  console.log("liveIPS ", liveIps);
  let fileContent = liveIps
    .map((ip) => {
      const ipType = ip.ip === newMasterIp ? "MASTER" : "SECONDARY";
      return `${ip.ip}:${ipType}:${ip.hash}`;
    })
    .join("\n");

  console.log("updating cluster_ips.txt with healthy ips ");
  await fs.writeFile(clusterFilePath, fileContent);
  console.log("fileContent\n\n", fileContent);
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

    let masterIp = commonIps?.[0]?.ip;
    console.log("selected master ", masterIp);
    // write commonIps to the file
    console.log("writing ips to file without any check");
    await createOrUpdateFile(commonIps, masterIp);
    console.log("unchecked file update done");

    const liveIps = await checkAndAddLiveIps(commonIps, app_port);

    console.log("found some live ips that passes tcp check ", liveIps);
    for (const r of liveIps) {
      try {
        if (await checkMinecraftActivity(r.ip, app_port)) {
          await createOrUpdateRecord(r.ip, domain_name, zone_name);
          if (r.ip !== masterIp) {
            await createOrUpdateFile(liveIps, r.ip);
          }
          break;
        }
      } catch (error) {
        console.log(`Error while creating record: ${error?.message}`);
      }
    }
  } catch (error) {
    console.error(`Error in createNew function: ${error?.message}`);
  }
}

async function getResponses(urls) {
  try {
    const requests = urls.map((url) =>
      axios.get(url).catch((error) => {
        console.log(`Error while making request to ${url}: ${error?.message}`);
      })
    );

    const responses = await axios.all(requests).catch((error) => {
      console.log(`Error while making concurrent requests: ${error?.message}`);
    });

    return responses;
  } catch (error) {
    console.error(`Error in getResponses function: ${error?.message}`);
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
      `Error while checking Minecraft activity for server ${ip}: ${error?.message}`
    );
    return false;
  }
}

async function createOrUpdateRecord(selectedIp, domainName, zoneId) {
  const comment = "master";
  const records = await api
    .get(
      `/zones/${zoneId}/dns_records?type=A&name=${domainName}&comment=${comment}`
    )
    .then(async ({ data }) => {
      return data?.result ?? [];
    });

  console.log("records ", records);
  const selectedRecord = records?.[0];

  if (records.length > 1) {
    for (let i = 1; i < records.length; i++) {
      try {
        await api.delete(`/zones/${zoneId}/dns_records/${records[i].id}`);
      } catch (error) {
        console.log(`failed to delete the record ${records[i].id}`);
        console.log(error?.message);
      }
    }
  }

  if (!selectedRecord) {
    console.log(
      `Creating new record for IP ${selectedIp} in Cloudflare DNS Server`
    );
    // Create new DNS record
    await api.post(`/zones/${zoneId}/dns_records`, {
      type: "A",
      name: domainName,
      content: selectedIp,
      ttl: 120,
      comment: comment,
      proxied: false,
    });
    console.log(
      `Created new record for IP ${selectedIp} in Cloudflare DNS Server`
    );
  } else {
    await api.put(`/zones/${zoneId}/dns_records/${selectedRecord.id}`, {
      type: "A",
      name: domainName,
      content: selectedIp,
      ttl: 120,
      proxied: false,
      comment: comment,
    });
    console.log(`Updated record with new master ip ${selectedIp}`);
  }
}

module.exports = {
  checkIP,
};
