
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const lighthouseModule = require("lighthouse");
const lighthouse = lighthouseModule.default || lighthouseModule;
const chromeLauncher = require("chrome-launcher");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// -------------------- DATABASE MODEL --------------------

const analysisSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    performance: Number,
    accessibility: Number,
    bestPractices: Number,
    seo: Number,
    lcp: String,
    fcp: String,
    cls: String,
    ttfb: String,
    inp: String,
    fieldData: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

const Analysis = mongoose.model("Analysis", analysisSchema);

// -------------------- BASIC ROUTES --------------------

app.get("/", (req, res) => {
  res.json({ message: "Lighthouse Backend is working!" });
});

app.get("/db-status", (req, res) => {
  const connected = mongoose.connection.readyState === 1;

  res.status(connected ? 200 : 503).json({
    connected,
    message: connected
      ? "MongoDB connected successfully!"
      : "MongoDB is not connected."
  });
});

// -------------------- URL VALIDATION --------------------

function validateWebsiteUrl(value) {
  try {
    const parsed = new URL(value);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    if (!parsed.hostname || !parsed.hostname.includes(".")) {
      return null;
    }

    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "::1" ||
      host === "127.0.0.1" ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === "0.0.0.0"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function getScore(categories, name) {
  const score = categories?.[name]?.score;

  return typeof score === "number" && Number.isFinite(score)
    ? Math.round(score * 100)
    : null;
}

function getMetric(audits, name) {
  return audits?.[name]?.displayValue ?? "N/A";
}

// -------------------- BLOCKED PAGE DETECTION --------------------

function isBlockedOrErrorPage(finalUrl, report) {
  try {
    const parsed = new URL(finalUrl);
    const path = parsed.pathname.toLowerCase();

    const title = String(
      report?.audits?.["document-title"]?.displayValue ||
      report?.audits?.["document-title"]?.title ||
      ""
    ).toLowerCase();

    const blockedPaths = [
      "/sorry",
      "/captcha",
      "/blocked",
      "/challenge",
      "/access-denied"
    ];

    const blockedPath = blockedPaths.some((part) =>
      path.includes(part)
    );

    const blockedTitle =
      title.includes("verify you are human") ||
      title.includes("security check") ||
      title.includes("access denied") ||
      title.includes("captcha") ||
      title.includes("robot check");

    return blockedPath || blockedTitle;
  } catch {
    return false;
  }
}

// -------------------- CRUX FIELD DATA --------------------

const CRUX_METRICS = [
  "largest_contentful_paint",
  "first_contentful_paint",
  "cumulative_layout_shift",
  "interaction_to_next_paint",
  "experimental_time_to_first_byte"
];

function formatCruxMetric(metricName, metric) {
  const value = metric?.percentiles?.p75;

  if (value === undefined || value === null) {
    return null;
  }

  if (metricName === "cumulative_layout_shift") {
    return String(value);
  }

  return `${value} ms`;
}

async function queryCrux(identifierType, identifier) {
  const apiKey = process.env.CRUX_API_KEY;

  if (!apiKey) {
    return {
      available: false,
      source: null,
      message: "CrUX API key is not configured."
    };
  }

  const response = await fetch(
    "https://chromeuxreport.googleapis.com/v1/records:queryRecord" +
      `?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        [identifierType]: identifier,
        metrics: CRUX_METRICS
      }),
      signal: AbortSignal.timeout(10000)
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      available: false,
      source: null,
      message:
        data?.error?.message ||
        `CrUX request failed with status ${response.status}.`
    };
  }

  const record = data.record;

  if (!record?.metrics) {
    return {
      available: false,
      source: null,
      message: "No field data was returned for this website."
    };
  }

  const metrics = record.metrics;

  const fieldData = {
    lcp: formatCruxMetric(
      "largest_contentful_paint",
      metrics.largest_contentful_paint
    ),
    fcp: formatCruxMetric(
      "first_contentful_paint",
      metrics.first_contentful_paint
    ),
    cls: formatCruxMetric(
      "cumulative_layout_shift",
      metrics.cumulative_layout_shift
    ),
    inp: formatCruxMetric(
      "interaction_to_next_paint",
      metrics.interaction_to_next_paint
    ),
    ttfb: formatCruxMetric(
      "experimental_time_to_first_byte",
      metrics.experimental_time_to_first_byte
    ),
    collectionPeriod: record.collectionPeriod || null
  };

  const available = [
    fieldData.lcp,
    fieldData.fcp,
    fieldData.cls,
    fieldData.inp,
    fieldData.ttfb
  ].some((value) => value !== null);

  return {
    available,
    source: identifierType === "url" ? "URL" : "ORIGIN",
    message: available
      ? "CrUX field data retrieved."
      : "The CrUX record contains no usable metric values.",
    ...fieldData
  };
}

async function getFieldData(inputUrl) {
  const parsed = new URL(inputUrl);

  const pageResult = await queryCrux("url", parsed.href);

  if (pageResult.available) {
    return pageResult;
  }

  const originResult = await queryCrux("origin", parsed.origin);

  if (originResult.available) {
    return originResult;
  }

  return {
    available: false,
    source: null,
    message: "No CrUX field data is available for this page or origin.",
    diagnostic: originResult.message || pageResult.message,
    lcp: null,
    fcp: null,
    cls: null,
    inp: null,
    ttfb: null,
    collectionPeriod: null
  };
}

// -------------------- WEBSITE ANALYSIS --------------------

app.post("/analyze", async (req, res) => {
  const input = req.body?.url;

  if (typeof input !== "string" || !input.trim()) {
    return res.status(400).json({
      error: "Please enter a website URL."
    });
  }

  const parsedUrl = validateWebsiteUrl(input.trim());

  if (!parsedUrl) {
    return res.status(400).json({
      error:
        "Enter a valid public website URL starting with https:// or http://."
    });
  }

  const analysisUrl = parsedUrl.href;
  let chrome;

  try {
    console.log("Starting Lighthouse analysis:", analysisUrl);

    const launchOptions = {
      chromeFlags: [
        "--headless",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote"
      ]
    };

    if (process.env.CHROME_PATH) {
      launchOptions.chromePath = process.env.CHROME_PATH;
    }

    chrome = await chromeLauncher.launch(launchOptions);

    const options = {
      logLevel: "error",
      output: "json",
      port: chrome.port,
      onlyCategories: [
        "performance",
        "accessibility",
        "best-practices",
        "seo"
      ],
      maxWaitForLoad: 45000,
      formFactor: "mobile",
      screenEmulation: {
        mobile: true,
        width: 412,
        height: 823,
        deviceScaleFactor: 1.75,
        disabled: false
      }
    };

    const runnerResult = await lighthouse(analysisUrl, options);

    if (!runnerResult?.lhr) {
      return res.status(422).json({
        error: "Lighthouse could not produce a report for this website."
      });
    }

    const report = runnerResult.lhr;

    if (report.runtimeError) {
      console.error("Lighthouse runtime error:", report.runtimeError);

      return res.status(422).json({
        error:
          "Lighthouse could not complete the analysis. The website may have blocked access or failed to load.",
        details:
          report.runtimeError.message || "Lighthouse runtime error."
      });
    }

    const categories = report.categories || {};
    const audits = report.audits || {};

    const finalUrl =
      report.finalDisplayedUrl ||
      report.finalUrl ||
      analysisUrl;

    if (isBlockedOrErrorPage(finalUrl, report)) {
      return res.status(422).json({
        error:
          "The website redirected Lighthouse to a blocked or verification page. Try another website.",
        finalUrl
      });
    }

    const result = {
      url: finalUrl,
      performance: getScore(categories, "performance"),
      accessibility: getScore(categories, "accessibility"),
      bestPractices: getScore(categories, "best-practices"),
      seo: getScore(categories, "seo"),
      lcp: getMetric(audits, "largest-contentful-paint"),
      fcp: getMetric(audits, "first-contentful-paint"),
      cls: getMetric(audits, "cumulative-layout-shift"),
      ttfb: getMetric(audits, "server-response-time"),
      inp: null,
      fieldData: null,
      savedToDatabase: false
    };

    const availableScores = [
      result.performance,
      result.accessibility,
      result.bestPractices,
      result.seo
    ].filter((score) => score !== null).length;

    if (availableScores === 0) {
      return res.status(422).json({
        error:
          "Lighthouse could not calculate usable category scores for this page.",
        finalUrl,
        scores: {
          performance: result.performance,
          accessibility: result.accessibility,
          bestPractices: result.bestPractices,
          seo: result.seo
        }
      });
    }

    // CrUX data is optional. Its failure must not cancel Lighthouse scores.
    try {
      result.fieldData = await getFieldData(finalUrl);
      result.inp = result.fieldData.inp;
    } catch (cruxError) {
      console.error("CrUX lookup failed:", cruxError.message);

      result.fieldData = {
        available: false,
        source: null,
        message: "Could not retrieve CrUX field data.",
        diagnostic: cruxError.message,
        lcp: null,
        fcp: null,
        cls: null,
        inp: null,
        ttfb: null,
        collectionPeriod: null
      };
    }

    // Save analysis when MongoDB is connected.
    if (mongoose.connection.readyState === 1) {
      try {
        await Analysis.create({
          url: result.url,
          performance: result.performance,
          accessibility: result.accessibility,
          bestPractices: result.bestPractices,
          seo: result.seo,
          lcp: result.lcp,
          fcp: result.fcp,
          cls: result.cls,
          ttfb: result.ttfb,
          inp: result.inp,
          fieldData: result.fieldData
        });

        result.savedToDatabase = true;
        console.log("Analysis saved to MongoDB.");
      } catch (dbError) {
        console.error("Database save failed:", dbError.message);
      }
    }

    result.message =
      availableScores === 4
        ? "Website analysis completed successfully."
        : `Analysis completed with ${availableScores} of 4 category scores.`;

    return res.json(result);
  } catch (error) {
    console.error("Website analysis failed:", error);

    const message = String(error?.message || "");

    const looksLikeTimeout =
      /timeout|timed out|navigation|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED/i
        .test(message);

    return res.status(error?.statusCode || 422).json({
      error: looksLikeTimeout
        ? "The website timed out or could not be reached. Check the URL and try again."
        : "Website analysis failed. The website may block automated testing.",
      details: message
    });
  } finally {
    if (chrome) {
      try {
        await chrome.kill();
      } catch (error) {
        console.error("Chrome cleanup failed:", error.message);
      }
    }
  }
});

// -------------------- ANALYSIS HISTORY --------------------

app.get("/history", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      error: "MongoDB is not connected."
    });
  }

  try {
    const history = await Analysis.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json(history);
  } catch (error) {
    console.error("History loading failed:", error.message);

    return res.status(500).json({
      error: "Could not load analysis history."
    });
  }
});

// -------------------- START SERVER --------------------

async function startServer() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is missing from environment variables");
  } else {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 15000
      });

      console.log("MongoDB connected successfully!");
    } catch (error) {
      console.error("MongoDB connection failed:", error.message);
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Lighthouse backend running on port ${PORT}`);
  });
}

startServer();
