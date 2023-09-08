const fs = require("fs").promises;
const path = require("path");
const gamedig = require("gamedig");
const dotenv = require("dotenv");
dotenv.config();
const axios = require("axios");

const { findMostCommonResponse, getWorkingNodes } = require("./utils");

const clusterFilePath = path.join(process.env.FILE_PATH, "cluster_ip.txt");
const recodsFilePath = path.join(process.env.RECORD_PATH, "records.json");
const RETRY = Number(process.env.RETRY ?? "3");
const RETRY_INTERVAL = Number(process.env.RETRY_INTERVAL ?? "60000");

const MASTER_RETRY_INTERVAL = Number(
  process.env.MASTER_RETRY_INTERVAL ?? "60000"
);

async function checkIP(workerData) {
  const { app_name, app_port, domain_name } = workerData;
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
    const [ip, port] = await getCurrentMasterFromFile();

    if (ip && (await checkIsNodeHealthy(ip, port))) {
      let minecraftActive = 0;
      let attempts = 0;

      console.log("Checking Minecraft activity...");
      while (attempts < 3 && !minecraftActive) {
        minecraftActive = await checkMinecraftActivity(ip, app_port);
        await new Promise((resolve) =>
          setTimeout(resolve, MASTER_RETRY_INTERVAL)
        );
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
        const currentDnsMaster = await getCurrentMasterRecord(domain_name);
        if (currentDnsMaster?.content !== ip) {
          console.log(
            "dns master is not matched with current healthy master so updating dns record"
          );
          await createOrUpdateFileRecord(ip, domain_name);
        }
        return;
      } else {
        console.log(
          "Updating the master node IP. The old master node is not working."
        );
        await createNew(app_name, app_port, domain_name, ip);
      }
    } else {
      console.log(
        "The file cluster_ip.txt is empty. Creating and updating new master..."
      );
      await createNew(app_name, app_port, domain_name);
    }
  } catch (error) {
    console.error(
      "An error occurred in the checkIP function: ",
      error?.message
    );
    console.log(
      "Updating the new record file. The file cluster_ip.txt does not exist or is empty."
    );
    await createNew(app_name, app_port, domain_name);
  }
}

async function createOrUpdateFile(liveIps, newMasterIp, domainName) {
  try {
    const activeMaster = await getCurrentMasterRecord(domainName);
    const [masterFromFile, _] = await getCurrentMasterFromFile();
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
      return `${ip.ip}:${ipType}:${ip.hash}:${ip.port}`;
    })
    .join("\n");

  console.log("Updating the file cluster_ips.txt with healthy IPs...");
  await fs.writeFile(clusterFilePath, fileContent);
  console.log("File content:\n", fileContent);
}

async function createNew(app_name, app_port, domain_name, oldMaster = null) {
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
        return {
          ip: item.ip.split(":")[0],
          port: item.ip.split(":")[1],
          hash: item.hash,
        };
      }
      return { ...item, port: "16127" };
    });
    console.log("consensusIp ", consensusIp);
    const commonIps = [];

    for (const item of consensusIp) {
      if (await checkIsNodeHealthy(item.ip, item.port)) {
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

    let [masterIp, _] = await getCurrentMasterFromFile();
    masterIp = masterIp || commonIps?.[0].ip;

    if (oldMaster) {
      console.log("Old Master IP: ", oldMaster);
      masterIp = commonIps.find((ip) => ip.ip !== oldMaster)?.ip;
      console.log("New Master IP: ", masterIp);
    }
    try {
      const masterRecord = await getCurrentMasterRecord(domain_name);
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
    await createOrUpdateFile(commonIps, masterIp, domain_name);
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
              await createOrUpdateFileRecord(r.ip, domain_name);
              if (r.ip !== masterIp) {
                await createOrUpdateFile(commonIps, r.ip, domain_name);
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
        await createOrUpdateFile(commonIps, masterIp, domain_name);
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

async function createOrUpdateFileRecord(selectedIp, domainName) {
  const comment = "master";
  // const filePath = path.join(__dirname, `${domainName}.json`);
  let records = [];

  try {
    const fileContent = fs.readFileSync(recodsFilePath, "utf8");
    records = JSON.parse(fileContent);
  } catch (error) {
    console.log(`Failed to read the file ${recodsFilePath}`);
    console.log(error?.message);
  }

  console.log("records ", records);
  const selectedRecord = records?.[0];

  if (records.length > 1) {
    for (let i = 1; i < records.length; i++) {
      try {
        records.splice(i, 1);
      } catch (error) {
        console.log(`failed to delete the record ${records[i].id}`);
        console.log(error?.message);
      }
    }
  }

  if (!selectedRecord) {
    console.log(`Creating new record for IP ${selectedIp} in text file`);
    // Create new record
    records.push({
      type: "A",
      name: domainName,
      content: selectedIp,
      ttl: 120,
      comment: comment,
      proxied: false,
    });
    fs.writeFileSync(recodsFilePath, JSON.stringify(records));
    console.log(`Created new record for IP ${selectedIp} in text file`);
  } else {
    if (selectedIp === selectedRecord.content) {
      console.log(
        "selected master and file master is same so not updating file record."
      );
      return;
    }
    console.log("we are going to set this ip in file record", selectedIp);
    console.log("currentFile record ip is ", selectedRecord.content);
    console.log(
      "please check above log message to make sure it's spaming or not"
    );

    // Update existing record
    selectedRecord.content = selectedIp;
    fs.writeFileSync(filePath, JSON.stringify(records));

    console.log(`Updated record with new master ip ${selectedIp}`);
  }
}

async function getCurrentMasterRecord(domainName) {
  let records = [];

  try {
    const fileContent = fs.readFileSync(recodsFilePath, "utf8");
    records = JSON.parse(fileContent);
  } catch (error) {
    console.log(`Failed to read the file ${recodsFilePath}`);
    console.log(`Failed to read the file ${domainName}`);
    console.log(error?.message);
  }

  return records?.[0];
}

async function getCurrentMasterFromFile() {
  const ips = (await fs.readFile(clusterFilePath, "utf8"))?.split("\n");

  let row = ips?.find((c) => c.includes("MASTER"));
  console.log("masterRow ", row);
  let masterIP = row?.split(":")?.[0]?.trim();
  let port = row?.split(":")?.[3]?.trim();
  console.log("ip from master row ", masterIP);
  return [masterIP, port];
}

async function checkIsNodeHealthy(ip, port = "16127") {
  try {
    const data = await axios
      .get(`http://${ip}:${port}/daemon/getbenchmarks`)
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
