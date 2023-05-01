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

    const records = await getValidRecords(zone_name, app_port, app_name);
    console.log("records ", records);
    for (const [index, ip] of commonIps.entries()) {
      const domainName =
        index < domain_names.length ? domain_names[index] : domain_names[0];
      await createOrDeleteRecord(
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

async function getValidRecords(zoneName, appPort, appName) {
  console.log("zoneName ", zoneName);
  console.log("appPort ", appPort);
  console.log("appName ", appName);
  const { data } = await api.get(
    `/zones/${zoneName}/dns_records?comment=${appName}&type=A`
  );
  const records = [];

  for (const record of data?.result ?? []) {
    try {
      const isConnected = await checkConnection(record.content, appPort);
      if (isConnected) {
        records.push(record);
      } else {
        await api.delete(`/zones/${zoneName}/dns_records/${record.id}`);
      }
    } catch (error) {
      console.log(error);
    }
  }
  return records;
}

async function createOrDeleteRecord(
  selectedIp,
  appPort,
  domainName,
  zoneName,
  appName,
  records
) {
  try {
    const isConnected = await checkConnection(selectedIp, appPort);
    const { data: r2 } = await axios.get(
      `https://api.incolumitas.com/?q=${selectedIp}`
    );
    const isGood = !(
      r2?.is_datacenter ||
      r2?.is_tor ||
      r2?.is_proxy ||
      r2?.is_vpn ||
      r2?.is_abuser
    );

    const selectedRecord = records.find(
      (record) => record.content === selectedIp
    );

    if (isConnected && isGood) {
      if (!selectedRecord) {
        await api.post(`/zones/${zoneName}/dns_records`, {
          type: "A",
          name: domainName,
          content: selectedIp,
          ttl: 60,
          comment: appName,
        });
        console.log("created domain ", domainName);
        console.log("created ip ", selectedIp);
      } else {
        console.log("record exist ", selectedRecord.content);
      }
    } else if (selectedRecord && (!isGood || !isConnected)) {
      console.log("deleting record");
      await api.delete(`/zones/${zoneName}/dns_records/${selectedRecord.id}`);
    }
  } catch (error) {
    console.log("connection check failed for ", selectedIp + ":" + appPort);
    const selectedRecord = records.find(
      (record) => record.content === selectedIp
    );
    if (!selectedRecord) {
      console.log(
        "we have not found any existing record so avoiding delete request ",
        selectedIp + ":" + appPort
      );
    } else {
      console.log("deleting record");
      await api
        .delete(`/zones/${zoneName}/dns_records/${selectedRecord.id}`)
        .catch(console.log);
    }
  }
}

module.exports = {
  checkIP,
};
