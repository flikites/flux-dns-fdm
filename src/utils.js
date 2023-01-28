const fs = require("fs").promises;

async function getFluxNodes() {
  try {
    const data = await fs.readFile(__dirname + "/ips.txt", "utf8");
    const lines = data.split("\n");
    return lines.map((ip) => ip.trim());
  } catch (err) {
    console.log(err);
    return [];
  }
}

function findMostCommonResponse(arr) {
  let subArrCount = {};
  let maxCount = 0;
  let mostCommon;

  for (let i = 0; i < arr.length; i++) {
    let subArr = JSON.stringify(arr[i]);
    if (!subArrCount[subArr]) {
      subArrCount[subArr] = 1;
    } else {
      subArrCount[subArr]++;
    }
    if (subArrCount[subArr] > maxCount) {
      maxCount = subArrCount[subArr];
      mostCommon = JSON.parse(subArr);
    }
  }
  return mostCommon;
}

module.exports = {
  findMostCommonResponse,
  getFluxNodes,
};
