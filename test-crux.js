
require("dotenv").config();

async function testCrux() {
  const apiKey = process.env.CRUX_API_KEY;

  if (!apiKey) {
    console.log("ERROR: CRUX_API_KEY was not loaded from backend/.env");
    return;
  }

  const endpoint =
    "https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=" +
    encodeURIComponent(apiKey);

  const body = {
    origin: "https://web.dev",
    metrics: ["interaction_to_next_paint"]
  };

  try {
    console.log("Testing Google CrUX API...");
    console.log("Website: https://web.dev");
    console.log("Metric: INP");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    console.log("\nHTTP STATUS:", response.status);
    console.log("\nFULL GOOGLE API RESPONSE:");
    console.log(JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.log("\nAPI REQUEST FAILED.");
      console.log(
        "Read the Google error message above to identify the cause."
      );
      return;
    }

    const inp =
      data.record?.metrics?.interaction_to_next_paint?.percentiles?.p75;

    if (inp !== undefined && inp !== null) {
      console.log("\nSUCCESS! INP FIELD DATA:", inp, "ms");
    } else {
      console.log("\nThe API request succeeded, but INP was not returned.");
      console.log(
        "Check the response above for available metrics and records."
      );
    }
  } catch (error) {
    console.log("TEST ERROR:", error.message);
  }
}

testCrux();
