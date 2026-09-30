const https = require("https");

const API_URL = "https://api.thaistock2d.com/live";
const FIREBASE_DB =
  "https://myanmar-2d-stock-91737-default-rtdb.firebaseio.com";

const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY ||
  "AIzaSyBj9jq99-C8cVt3TGdL2UdHWRs2IgscL8Y";

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, res => {
      let data = "";

      res.on("data", chunk => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(
            new Error(`HTTP ${res.statusCode}: ${data}`)
          );
          return;
        }

        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error("Invalid JSON response"));
        }
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

function calc2D(setValue, marketValue) {
  const setText = String(setValue ?? "")
    .replace(/,/g, "")
    .trim();

  const valueText = String(marketValue ?? "")
    .replace(/,/g, "")
    .trim();

  const decimals = (setText.split(".")[1] || "")
    .padEnd(2, "0");

  const integer = (valueText.split(".")[0] || "")
    .replace(/\D/g, "");

  if (!decimals[1] || !integer) {
    return "";
  }

  return decimals[1] + integer.slice(-1);
}

async function getAnonToken() {
  const body = JSON.stringify({
    returnSecureToken: true
  });

  const data = await request(
    "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" +
      encodeURIComponent(FIREBASE_API_KEY),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    },
    body
  );

  if (!data.idToken) {
    throw new Error("Firebase Anonymous Login failed");
  }

  return data.idToken;
}

async function writeFirebase(path, value, token) {
  return request(
    FIREBASE_DB +
      "/" +
      path +
      ".json?auth=" +
      encodeURIComponent(token),
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      }
    },
    JSON.stringify(value)
  );
}

async function main() {
  console.log("Starting Myanmar 2D AutoServer...");

  const payload = await request(
    API_URL + "?t=" + Date.now(),
    {
      headers: {
        "Cache-Control": "no-cache"
      }
    }
  );

  console.log("ThaiStock API connected.");

  const results = Array.isArray(payload?.result)
    ? payload.result
    : [];

  const updates = {};

  for (const item of results) {
    const twod = calc2D(
      item?.set,
      item?.value
    );

    if (!twod) continue;

    const time = String(
      item?.open_time || ""
    );

    const record = {
      value: twod,
      set: String(item?.set || ""),
      marketValue: String(item?.value || ""),
      updatedAt: Date.now(),
      source: "ThaiStock2D API"
    };

    if (time.startsWith("12:01")) {
      updates["1201"] = record;
    }

    if (time.startsWith("16:30")) {
      updates["0431"] = record;
    }
  }

  const live = payload?.live;

  if (live?.set && live?.value) {
    const live2d = calc2D(
      live.set,
      live.value
    );

    if (live2d) {
      updates.current = {
        value: live2d,
        set: String(live.set),
        marketValue: String(live.value),
        time: String(live.time || ""),
        updatedAt: Date.now(),
        source: "ThaiStock2D API"
      };
    }
  }

  if (!Object.keys(updates).length) {
    console.log("No usable live values returned.");
    return;
  }

  console.log("Getting Firebase anonymous login...");

  const token = await getAnonToken();

  for (const [key, value] of Object.entries(updates)) {
    await writeFirebase(
      "live2d/" + key,
      value,
      token
    );

    console.log(
      "Updated live2d/" +
        key +
        " = " +
        value.value
    );
  }

  console.log("Myanmar 2D AutoServer completed successfully.");
}

main().catch(err => {
  console.error("AutoServer ERROR:");
  console.error(err);
  process.exitCode = 1;
});
