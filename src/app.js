const dotenv = require("dotenv");
dotenv.config();
const axios = require("axios");

const {
  api,
  findMostCommonResponse,
  findMostCommonValues,
  getWorkingNodes,
  checkConnection,
} = require("./utils");

async function checkIP(workerData) {
  const { app_name, app_port, zone_name, domain_names } = workerData;
  try {
    const randomFluxNodes = await getWorkingNodes();

    const randomUrls = randomFluxNodes.map(
      (ip) => `http://${ip}:16127/apps/location/${app_name}`
    );

    const responses = await axios.all(
      randomUrls.map((url) =>
        axios.get(url).catch((error) => {
          console.log(`Error while making request to ${url}: ${error}`);
        })
      )
    );

    const responseData = responses.reduce((acc, res) => {
      if (res && res.data) {
        const data = res.data.data;
        acc.push(...data.map((item) => item.ip));
      }
      return acc;
    }, []);

    const commonIps = findMostCommonValues(
      responseData.map((ip) => {
        if (ip.includes(":")) {
          return ip.split(":")[0];
        }
        return ip;
      })
    );

    console.log("app_name: ", app_name);
    console.log("app_port: ", app_port);
    console.log("flux Consensus Ip list for app: ", commonIps);
    const workingIPS = [];
    for (const ip of commonIps) {
      try {
        await checkConnection(ip, app_port);
        workingIPS.push(ip);
      } catch (error) {
        console.log(
          "flux returned a bad ip we are excluding from commonIps",
          ip
        );
      }
    }

    const cleanips = [];

    console.log("started checking cleaness of ips");

    for(const ip of workingIPS) {
      if(await isCleanIp(ip)) {
        cleanips.push(ip);
      }
    }

    console.log("clean ips ", cleanips);

    console.log("getting and updating dns record");
    const records = await getValidRecords(
      zone_name,
      app_port,
      app_name,
      cleanips
    );
    console.log("----creating new record if required----");
    for (const [index, domainName] of domain_names.entries()) {
      const ip = index < cleanips.length ? cleanips[index] : cleanips[0];
      await createRecord(
        ip,
        app_port,
        domainName,
        zone_name,
        app_name,
        records
      );
    }
  } catch (error) {
    console.error(error?.message ?? error);
  }
}


async function getValidRecords(zoneName, appPort, appName, commonIps) {
  console.log("zoneName ", zoneName);
  console.log("appPort ", appPort);
  console.log("appName ", appName);
  const { data } = await api.get(
    `/zones/${zoneName}/dns_records?comment=${appName}&type=A`
  );
  const records = [];
  for (const record of data.result) {
    try {
      await checkConnection(record.content, appPort);
      records.push(record);
    } catch (error) {
      console.log(
        `detected a bad record with name: ${record.name} and ip ${record.content}`
      );

      // Find a healthy common IP that doesn't exist in data.result
      let newIp = null;
      for (const ip of commonIps) {
        if (!data.result.find((r) => r.content === ip)) {
          newIp = ip;
          break;
        }
      }

      if (!newIp) {
        // Select a random IP from commonIps
        const randomIndex = Math.floor(Math.random() * commonIps.length);
        newIp = commonIps[randomIndex];
      }
      console.log(
        `replacing bad ip: ${record.content} with new ip:${newIp} for domain:${record.name}`
      );
      // Update the record with the new healthy IP or random IP
      await api
        .put(`/zones/${zoneName}/dns_records/${record.id}`, {
          type: "A",
          name: record.name,
          content: newIp,
          ttl: record.ttl,
          proxied: record.proxied,
          comment: appName,
        })
        .catch(console.log);
      record.content = newIp;
      records.push(record);
    }
  }
  return records;
}

async function createRecord(
  selectedIp,
  appPort,
  domainName,
  zoneName,
  appName,
  records
) {
  try {
    const selectedRecord = records.find(
      (record) => record.name === domainName || record.content === selectedIp
    );
    if (!selectedRecord) {
      await api.post(`/zones/${zoneName}/dns_records`, {
        type: "A",
        name: domainName,
        content: selectedIp,
        ttl: 60,
        comment: appName,
      });
      console.log(
        `created record for ip ${selectedIp} and domain ${domainName}`
      );
    } else {
      console.log(
        `record already exist with domain:${selectedRecord.name} ip:${selectedRecord.content} `
      );
    }
  } catch (error) {
    console.log(error?.message);
    // console.log("connection check failed for ", selectedIp + ":" + appPort);
  }
}

async function isCleanIp(ip) {
  try {
    console.log("checking ip quality score for ip ", ip);
    const { data } = await axios.get(`https://www.ipqualityscore.com/api/json/ip/${process.env.IP_QUALITY_KEY}/${ip}?strictness=2`);
    // console.log("clean data ", data);
    if(data.proxy || data.vpn || data.recent_abuse || data.tor || data.fraud_score >= 74) {
      return false;
    }
    return true;
  } catch (error) {
    console.log("ipquality check failed for ip ", ip);
    console.log("ip quality error ", error?.message ?? error);
  }
  return false;
}

module.exports = {
  checkIP,
};
