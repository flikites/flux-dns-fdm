const fs = require("fs").promises;
const path = require("path");
const gamedig = require("gamedig");
const dotenv = require("dotenv");
dotenv.config();
const axios = require("axios");

const { api, findMostCommonResponse, getWorkingNodes } = require("./utils");

const clusterFilePath = path.join(process.env.FILE_PATH, "cluster_ip.txt");
const RETRY = Number(process.env.RETRY ?? "5");
const RETRY_INTERVAL = Number(process.env.RETRY_INTERVAL ?? "15000");

async function checkIP(workerData) {
  const { app_name, app_port, zone_name, domain_name } = workerData;
  try {
    await fs.access(clusterFilePath);
  } catch (error) {
    console.log(
      "The file cluster_ip.txt does not exist. Creating an empty file..."
    );
    await fs.mkdir(path.dirname(clusterFilePath), { recursive: true });
    await fs.writeFile(clusterFilePath, "");
  }

  try {
    const ip = await getCurrentMasterFromFile();

    if (ip && (await checkIsNodeHealthy(ip))) {
      let minecraftActive = 0;
      let attempts = 0;

      console.log("Checking Minecraft activity...");
      while (attempts < 3 && !minecraftActive) {
        minecraftActive = await checkMinecraftActivity(ip, app_port);
        await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL));
        attempts += 1;
        if (!minecraftActive) {
          console.log(
            "Attempt",
            attempts,
            "to check Minecraft activity failed. Retrying..."
          );
        }
      }

      console.log(
        `Minecraft activity status for current master : ${
          minecraftActive ? "Active" : "Inactive"
        } ip: ${ip}`
      );

      if (minecraftActive) {
        console.log(
          "The master node is active. It has passed the gamedig check. IP: ",
          ip
        );
        const currentDnsMaster = await getCurrentMasterRecord(
          zone_name,
          domain_name
        );
        if (currentDnsMaster?.content !== ip) {
          console.log(
            "dns master is not matched with current healthy master so updating dns record"
          );
          await createOrUpdateRecord(ip, domain_name, zone_name);
        }
        return;
      } else {
        console.log(
          "Updating the master node IP. The old master node is not working."
        );
        await createNew(app_name, app_port, zone_name, domain_name, ip);
      }
    } else {
      console.log(
        "The file cluster_ip.txt is empty. Creating and updating new master..."
      );
      await createNew(app_name, app_port, zone_name, domain_name);
    }
  } catch (error) {
    console.error(
      "An error occurred in the checkIP function: ",
      error?.message
    );
    console.log(
      "Updating the new record file. The file cluster_ip.txt does not exist or is empty."
    );
    await createNew(app_name, app_port, zone_name, domain_name);
  }
}

async function createOrUpdateFile(liveIps, newMasterIp, zoneId, domainName) {
  try {
    const activeMaster = await getCurrentMasterRecord(zoneId, domainName);
    const masterFromFile = await getCurrentMasterFromFile();
    if (
      newMasterIp &&
      newMasterIp === activeMaster?.content &&
      newMasterIp === masterFromFile
    ) {
      console.log(
        "new master and existing master is same so avoiding update the file"
      );
      return;
    }
    console.log("newMaster ", newMasterIp);
    console.log("masterFromFile ", masterFromFile);

    if (activeMaster) {
      let oldDateTime = new Date(activeMaster.modified_on); // your old date-time string
      let currentDateTime = new Date(); // current date-time

      // convert both times to milliseconds
      let oldDateTime_ms = oldDateTime.getTime();
      let currentDateTime_ms = currentDateTime.getTime();

      // calculate the difference in time
      let difference_ms = currentDateTime_ms - oldDateTime_ms;

      // convert time to minutes
      let difference_in_minutes = difference_ms / 1000 / 60;

      if (difference_in_minutes < 5) {
        console.log(
          "current master from dns server is alive so we will not replace current master with new master"
        );
        newMasterIp = activeMaster.content;
      }
    }
  } catch (error) {
    console.log(
      "checking active master has failed before updating file ",
      error?.message
    );
  }

  console.log("Live IPs: ", liveIps);

  let fileContent = liveIps
    .map((ip) => {
      const ipType = ip.ip === newMasterIp ? "MASTER" : "SECONDARY";
      return `${ip.ip}:${ipType}:${ip.hash}`;
    })
    .join("\n");

  console.log("Updating the file cluster_ips.txt with healthy IPs...");
  await fs.writeFile(clusterFilePath, fileContent);
  console.log("File content:\n", fileContent);
}

async function createNew(
  app_name,
  app_port,
  zone_name,
  domain_name,
  oldMaster = null
) {
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
    console.log("Finding most common IPs...");
    const consensusIp = findMostCommonResponse(responseData).map((item) => {
      if (item.ip.includes(":")) {
        return { ip: item.ip.split(":")[0], hash: item.hash };
      }
      return item;
    });

    const commonIps = [];

    for (const item of consensusIp) {
      if (await checkIsNodeHealthy(item.ip)) {
        commonIps.push(item);
        console.log(`node ${item.ip} is passed health check`);
      } else {
        console.log(`node ${item.ip} is not passed health check`);
      }
    }

    if (!commonIps.length) {
      console.log("no healthy nodes found");
      return;
    }

    let masterIp = (await getCurrentMasterFromFile()) || commonIps?.[0].ip;

    if (oldMaster) {
      console.log("Old Master IP: ", oldMaster);
      masterIp = commonIps.find((ip) => ip.ip !== oldMaster)?.ip;
      console.log("New Master IP: ", masterIp);
    }
    try {
      const masterRecord = await getCurrentMasterRecord(zone_name, domain_name);
      if (
        masterRecord &&
        commonIps.find((cm) => cm.ip === masterRecord.content) &&
        (await checkMinecraftActivity(masterRecord.content, app_port))
      ) {
        masterIp = masterRecord?.content;
        console.log(
          "current master node ip is exist in flux api and dns server so using this as currentMaster"
        );
      } else {
        console.log(
          "not found any active master in the dns record or that does not available in flux api"
        );
      }
    } catch (error) {
      console.log(
        "something went wrong when checking current master info ",
        error?.message
      );
    }

    console.log("Selected Master IP: ", masterIp);

    console.log(
      "Updating the file cluster_ip.txt without checking any connection..."
    );
    await createOrUpdateFile(commonIps, masterIp, zone_name, domain_name);
    console.log("Update to cluster_ip.txt file completed.");

    let foundMaster = false;
    let currentIpIndex = 0;
    while (!foundMaster) {
      let retry = 0;
      let success = false;
      console.log("starting gamedig check.");
      while (retry < RETRY) {
        for (const r of commonIps) {
          try {
            if (await checkMinecraftActivity(r.ip, app_port)) {
              await createOrUpdateRecord(r.ip, domain_name, zone_name);
              if (r.ip !== masterIp) {
                await createOrUpdateFile(
                  commonIps,
                  r.ip,
                  zone_name,
                  domain_name
                );
              }
              retry = RETRY;
              success = true;
              foundMaster = true;
              console.log("successfully updated/created new master");
              break;
            }
          } catch (error) {
            console.log(`Error while creating record: ${error?.message}`);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL));
        retry++;
        if (!success) {
          console.log("gamedig retry ", retry);
        } else {
          console.log("gamedig check successfull exiting the interval loop");
        }
      }

      if (!success) {
        currentIpIndex++;
        if (currentIpIndex < commonIps.length) {
          masterIp = commonIps?.[currentIpIndex]?.ip;
        } else {
          currentIpIndex = 0;
          masterIp = commonIps?.[currentIpIndex]?.ip;
        }
        console.log("updgrading secondary to new master ", masterIp);
        await createOrUpdateFile(commonIps, masterIp, zone_name, domain_name);
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
    console.log(`Checking Minecraft activity for server ${ip}...`);
    const response = await gamedig.query({
      type: "minecraft",
      host: ip,
      port: app_port,
    });
    console.log("minecraft response ", response);
    return true; // Check if Minecraft server is online
  } catch (error) {
    console.log("minecraft error ", error?.message ?? error?.error);
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
    if (selectedIp === selectedRecord.content) {
      console.log(
        "selected master and dns master is same so not updating dns record."
      );
      return;
    }
    console.log("we are going to set this ip in dns record", selectedIp);
    console.log("currentDns record ip is ", selectedRecord.content);
    console.log(
      "please check above log message to make sure it's spaming or not"
    );
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

async function getCurrentMasterRecord(zoneId, domainName) {
  try {
    const records = await api
      .get(
        `/zones/${zoneId}/dns_records?type=A&name=${domainName}&comment=master`
      )
      .then(async ({ data }) => {
        return data?.result ?? [];
      });
    return records?.[0];
  } catch (error) {
    console.log("unable to find master in dns server ", error?.message);
  }
  return undefined;
}

async function getCurrentMasterFromFile() {
  const ips = (await fs.readFile(clusterFilePath, "utf8"))?.split("\n");

  let row = ips?.find((c) => c.includes("MASTER"));
  console.log("masterRow ", row);
  let masterIP = row?.split(":")?.[0]?.trim();
  console.log("ip from master row ", masterIP);
  return masterIP;
}

async function checkIsNodeHealthy(ip) {
  try {
    const data = await axios
      .get(`http://${ip}:16127/daemon/getbenchmarks`)
      .then((res) => {
        return JSON.parse(res.data?.data ?? `{}`);
      });
    console.log(
      `new health check for ip ${ip} ping ${data.ping} passed? `,
      data.ping > 0 && data.error === ""
    );
    return data.ping > 0 && data.error === "";
  } catch (error) {
    console.log(`new health check for ip ${ip} get error `, error?.message);
  }
}
module.exports = {
  checkIP,
};
