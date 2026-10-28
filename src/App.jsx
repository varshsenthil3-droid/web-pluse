
import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend
} from "recharts";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";

const scoreItems = [
  { title: "Performance", key: "performance", color: "#536dfe" },
  { title: "Accessibility", key: "accessibility", color: "#0891b2" },
  { title: "Best Practices", key: "bestPractices", color: "#059669" },
  { title: "SEO", key: "seo", color: "#d97706" }
];

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "--";
  return value;
}

function isValidAnalysis(item) {
  return (
    item &&
    Number.isFinite(Number(item.performance)) &&
    Number(item.performance) > 0 &&
    scoreItems.every(
      (score) =>
        item[score.key] !== null &&
        item[score.key] !== undefined &&
        item[score.key] !== "" &&
        Number.isFinite(Number(item[score.key])) &&
        Number(item[score.key]) >= 0 &&
        Number(item[score.key]) <= 100
    )
  );
}

function websiteLabel(item) {
  if (!item) return "Select a website";

  let host = item.url || "Unknown website";

  try {
    host = new URL(item.url).hostname;
  } catch {
    // Keep the original URL if it cannot be parsed.
  }

  const date = item.createdAt
    ? new Date(item.createdAt).toLocaleString()
    : "Unknown date";

  return `${host} — ${date}`;
}

function App() {
  const [page, setPage] = useState("Dashboard");
  const [url, setUrl] = useState("https://example.com");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [inpLoading, setInpLoading] = useState(false);
  const [error, setError] = useState("");
  const [inpValue, setInpValue] = useState("No field data available");

  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");

  async function loadHistory() {
    try {
      const response = await fetch(`${API}/history`);

      if (!response.ok) {
        throw new Error("Unable to load history");
      }

      const data = await response.json();
      const records = Array.isArray(data) ? data : [];

      setHistory(records);

      const latestValid = records.find(isValidAnalysis);

      if (latestValid) {
        setResult((current) => current || latestValid);
      }

      const validRecords = records.filter(isValidAnalysis);

      if (validRecords.length > 0) {
        setCompareA((current) =>
          current && validRecords.some((item) => item._id === current)
            ? current
            : String(validRecords[0]._id)
        );

        setCompareB((current) =>
          current && validRecords.some((item) => item._id === current)
            ? current
            : String(validRecords.length > 1 ? validRecords[1]._id : "")
        );
      }
    } catch {
      setError(
        "Cannot connect to the backend. Check that port 5000 is running."
      );
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function fetchINP(targetUrl) {
    setInpLoading(true);
    setInpValue("Checking field data...");

    try {
      const endpoint =
        "https://www.googleapis.com/pagespeedonline/v5/runPagespeed" +
        `?url=${encodeURIComponent(targetUrl)}` +
        "&strategy=mobile&category=performance";

      const response = await fetch(endpoint);

      if (!response.ok) {
        throw new Error("Field data unavailable");
      }

      const data = await response.json();

      const metric =
        data.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT ||
        data.originLoadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT;

      if (metric && Number.isFinite(Number(metric.percentile))) {
        setInpValue(`${metric.percentile} ms`);
      } else {
        setInpValue("No field data available");
      }
    } catch {
      setInpValue("No field data available");
    } finally {
      setInpLoading(false);
    }
  }

  async function analyzeWebsite(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Website analysis failed.");
      }

      if (!isValidAnalysis(data)) {
        throw new Error(
          "Lighthouse could not calculate valid scores for this website. Please try another URL."
        );
      }

      setResult(data);
      setPage("Dashboard");

      await loadHistory();
      await fetchINP(data.url || url.trim());
    } catch (err) {
      setError(err.message || "Analysis failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const validHistory = history.filter(isValidAnalysis);

  const selectedA = validHistory.find(
    (item) => String(item._id) === compareA
  );

  const selectedB = validHistory.find(
    (item) => String(item._id) === compareB
  );

  const comparisonData =
    selectedA && selectedB
      ? scoreItems.map((item) => ({
          name: item.title,
          [websiteLabel(selectedA)]: Number(selectedA[item.key]),
          [websiteLabel(selectedB)]: Number(selectedB[item.key]),
          color: item.color
        }))
      : [];

  const chartData = result
    ? scoreItems.map((item) => ({
        name: item.title,
        score: Number(result[item.key]) || 0,
        color: item.color
      }))
    : [];

  const vitalItems = [
    {
      name: "LCP",
      value: displayValue(result?.lcp),
      description: "Largest Contentful Paint",
      note: "Measures loading speed"
    },
    {
      name: "INP",
      value: inpLoading ? "Checking..." : inpValue,
      description: "Interaction to Next Paint",
      note: "Uses field data when available"
    },
    {
      name: "CLS",
      value: displayValue(result?.cls),
      description: "Cumulative Layout Shift",
      note: "Measures visual stability"
    },
    {
      name: "FCP",
      value: displayValue(result?.fcp),
      description: "First Contentful Paint",
      note: "Measures first visible content"
    },
    {
      name: "TTFB",
      value: displayValue(result?.ttfb),
      description: "Time to First Byte",
      note: "Measures server response"
    }
  ];

  function exportReport() {
    if (!result) return;

    const report = JSON.stringify(
      { ...result, inp: inpValue },
      null,
      2
    );

    const blob = new Blob([report], {
      type: "application/json"
    });

    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = "webpulse-report.json";
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">W</div>
          <div>
            <h2>WebPulse</h2>
            <span>Performance Monitor</span>
          </div>
        </div>

        <p className="menu-label">WORKSPACE</p>

        <nav className="navigation">
          {[
            "Dashboard",
            "URL Analysis",
            "History",
            "Comparison",
            "Reports",
            "Settings"
          ].map((name) => (
            <button
              key={name}
              className={`nav-item ${page === name ? "active" : ""}`}
              onClick={() => {
                setPage(name);
                setError("");

                if (name === "History" || name === "Comparison") {
                  loadHistory();
                }
              }}
            >
              <span className="nav-icon">
                {{
                  Dashboard: "▦",
                  "URL Analysis": "⌕",
                  History: "◷",
                  Comparison: "⇄",
                  Reports: "▤",
                  Settings: "⚙"
                }[name]}
              </span>
              {name}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <span className="status-dot" />
          <div>
            <strong>Performance Monitor</strong>
            <span>Local backend connection</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="breadcrumb">Workspace / {page}</p>
            <h1>{page}</h1>
          </div>
          <div className="user-avatar">WP</div>
        </header>

        <div className="page-container">
          {error && (
            <div className="error-message">
              <span>{error}</span>
              <button
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}

          {page === "Dashboard" && (
            <>
              <section className="welcome-section">
                <div>
                  <h2>Website Performance Dashboard</h2>
                  <p>
                    Monitor website speed, accessibility, SEO and quality.
                  </p>
                  {result?.url && (
                    <p className="analyzed-url">
                      Latest website: <span>{result.url}</span>
                    </p>
                  )}
                </div>
                <button
                  className="primary-button"
                  onClick={() => setPage("URL Analysis")}
                >
                  + Analyze Website
                </button>
              </section>

              <section className="score-grid">
                {scoreItems.map(({ title, key, color }) => {
                  const score = result?.[key];
                  const validScore =
                    score !== null &&
                    score !== undefined &&
                    Number.isFinite(Number(score));

                  return (
                    <article className="score-card" key={key}>
                      <div className="score-card-top">
                        <span>{title}</span>
                        <span
                          className="score-icon"
                          style={{ color, background: `${color}15` }}
                        >
                          {key === "performance"
                            ? "↗"
                            : key === "accessibility"
                              ? "◎"
                              : key === "bestPractices"
                                ? "✓"
                                : "⌕"}
                        </span>
                      </div>

                      <div className="score-number">
                        {validScore ? Number(score) : "--"}
                        {validScore && <small>/100</small>}
                      </div>

                      <div className="score-track">
                        <div
                          className="score-fill"
                          style={{
                            width: `${
                              validScore
                                ? Math.max(0, Math.min(100, Number(score)))
                                : 0
                            }%`,
                            background: color
                          }}
                        />
                      </div>

                      <p>
                        {!validScore
                          ? "Waiting for analysis"
                          : Number(score) >= 90
                            ? "Good score"
                            : Number(score) >= 50
                              ? "Needs improvement"
                              : "Poor score"}
                      </p>
                    </article>
                  );
                })}
              </section>

              <section className="panel graph-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Performance Overview</h3>
                    <p>Compare Lighthouse category scores out of 100.</p>
                  </div>
                  {result && (
                    <span className="live-badge">● Analysis ready</span>
                  )}
                </div>

                {result ? (
                  <div className="chart-container">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={chartData}
                        margin={{
                          top: 8,
                          right: 12,
                          left: -15,
                          bottom: 2
                        }}
                        barCategoryGap="42%"
                      >
                        <CartesianGrid
                          stroke="#edf0f7"
                          strokeDasharray="3 3"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="name"
                          tick={{ fill: "#68748b", fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                          interval={0}
                        />
                        <YAxis
                          domain={[0, 100]}
                          tick={{ fill: "#8a94a8", fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          width={35}
                        />
                        <Tooltip
                          formatter={(value) => [`${value}/100`, "Score"]}
                          contentStyle={{
                            border: "1px solid #e8ecf4",
                            borderRadius: "9px",
                            fontSize: "12px"
                          }}
                        />
                        <Bar
                          dataKey="score"
                          radius={[5, 5, 0, 0]}
                          maxBarSize={34}
                        >
                          {chartData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="empty-chart">
                    <div className="empty-chart-icon">▥</div>
                    <h4>No performance data yet</h4>
                    <p>Analyze a website to display its category scores.</p>
                    <button
                      className="primary-button"
                      onClick={() => setPage("URL Analysis")}
                    >
                      Analyze a Website
                    </button>
                  </div>
                )}
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h3>Core Web Vitals & Performance Metrics</h3>
                    <p>
                      Loading speed, interactivity and visual stability.
                    </p>
                  </div>
                </div>

                <div className="vitals-grid">
                  {vitalItems.map((item) => (
                    <article className="vital-card" key={item.name}>
                      <div
                        className={`vital-label vital-${item.name.toLowerCase()}`}
                      >
                        {item.name}
                      </div>
                      <strong className="vital-value">{item.value}</strong>
                      <p className="vital-description">{item.description}</p>
                      <span className="vital-note">{item.note}</span>
                    </article>
                  ))}
                </div>
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h3>Recent Analyses</h3>
                    <p>Your latest saved website reports.</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => {
                      loadHistory();
                      setPage("History");
                    }}
                  >
                    View all
                  </button>
                </div>
                <HistoryTable history={history.slice(0, 5)} />
              </section>
            </>
          )}

          {page === "URL Analysis" && (
            <section className="panel analysis-panel">
              <div className="section-icon">⌕</div>
              <h2>Analyze a Website</h2>
              <p>
                Enter a public website URL to measure its Lighthouse performance.
              </p>

              <form onSubmit={analyzeWebsite}>
                <label htmlFor="website-url">Website URL</label>
                <input
                  id="website-url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com"
                  required
                />
                <button
                  type="submit"
                  className="primary-button analyze-button"
                  disabled={loading}
                >
                  {loading ? "Analyzing website..." : "Run Analysis"}
                </button>
              </form>

              {loading && (
                <div className="loading-message">
                  <div className="spinner" />
                  <p>
                    Lighthouse is opening the website and collecting scores.
                    This may take a little time.
                  </p>
                </div>
              )}

              <div className="analysis-note">
                <strong>About INP</strong>
                <p>
                  INP is based on real-user field data. Some websites do not
                  have enough public field data, so the dashboard may show
                  “No field data available.”
                </p>
              </div>

              {result && (
                <div className="last-result">
                  <h3>Latest analysis</h3>
                  <p>{result.url}</p>
                  <p>
                    Performance: {displayValue(result.performance)} / 100
                  </p>
                </div>
              )}
            </section>
          )}

          {page === "History" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>Saved Analysis History</h3>
                  <p>Results retrieved from your MongoDB database.</p>
                </div>
                <button className="secondary-button" onClick={loadHistory}>
                  Refresh
                </button>
              </div>
              <HistoryTable history={history} />
            </section>
          )}

          {page === "Comparison" && (
            <section className="panel comparison-panel">
              <div className="panel-heading">
                <div>
                  <h3>Website Performance Comparison</h3>
                  <p>
                    Compare the Lighthouse scores of two saved analyses.
                  </p>
                </div>
                <button
                  className="secondary-button"
                  onClick={loadHistory}
                >
                  Refresh History
                </button>
              </div>

              {validHistory.length < 2 ? (
                <div className="empty-chart">
                  <div className="empty-chart-icon">⇄</div>
                  <h4>Two valid analyses are needed</h4>
                  <p>
                    Analyze at least two websites successfully. Failed
                    analyses and zero Performance scores are excluded.
                  </p>
                  <button
                    className="primary-button"
                    onClick={() => setPage("URL Analysis")}
                  >
                    Analyze a Website
                  </button>
                </div>
              ) : (
                <>
                  <div className="comparison-selectors">
                    <div className="comparison-field">
                      <label htmlFor="compare-a">First analysis</label>
                      <select
                        id="compare-a"
                        value={compareA}
                        onChange={(event) => setCompareA(event.target.value)}
                      >
                        {validHistory.map((item, index) => (
                          <option
                            key={item._id || index}
                            value={String(item._id)}
                          >
                            {websiteLabel(item)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="comparison-field">
                      <label htmlFor="compare-b">Second analysis</label>
                      <select
                        id="compare-b"
                        value={compareB}
                        onChange={(event) => setCompareB(event.target.value)}
                      >
                        <option value="">Select a different analysis</option>
                        {validHistory.map((item, index) => (
                          <option
                            key={item._id || index}
                            value={String(item._id)}
                          >
                            {websiteLabel(item)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {!selectedA || !selectedB ? (
                    <p className="empty-text">
                      Select two saved analyses to compare their scores.
                    </p>
                  ) : compareA === compareB ? (
                    <div className="error-message">
                      Please select two different analysis records.
                    </div>
                  ) : (
                    <>
                      <div className="comparison-score-grid">
                        {scoreItems.map((item) => {
                          const scoreA = Number(selectedA[item.key]);
                          const scoreB = Number(selectedB[item.key]);
                          const difference = scoreA - scoreB;

                          return (
                            <article
                              className="score-card comparison-score-card"
                              key={item.key}
                            >
                              <div className="score-card-top">
                                <span>{item.title}</span>
                                <span
                                  className="score-icon"
                                  style={{
                                    color: item.color,
                                    background: `${item.color}15`
                                  }}
                                >
                                  ⇄
                                </span>
                              </div>

                              <div className="comparison-numbers">
                                <div>
                                  <span className="comparison-caption">A</span>
                                  <strong>{scoreA}</strong>
                                </div>
                                <span className="comparison-divider">/</span>
                                <div>
                                  <span className="comparison-caption">B</span>
                                  <strong>{scoreB}</strong>
                                </div>
                              </div>

                              <p>
                                {difference === 0
                                  ? "Equal scores"
                                  : `${Math.abs(difference)} points ${
                                      difference > 0
                                        ? "higher for A"
                                        : "higher for B"
                                    }`}
                              </p>
                            </article>
                          );
                        })}
                      </div>

                      <div className="panel comparison-chart-panel">
                        <div className="panel-heading">
                          <div>
                            <h3>Score Comparison Chart</h3>
                            <p>
                              Higher scores indicate better category results.
                            </p>
                          </div>
                        </div>

                        <div className="chart-container">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={comparisonData}
                              margin={{
                                top: 12,
                                right: 12,
                                left: -10,
                                bottom: 4
                              }}
                              barCategoryGap="24%"
                            >
                              <CartesianGrid
                                stroke="#edf0f7"
                                strokeDasharray="3 3"
                                vertical={false}
                              />
                              <XAxis
                                dataKey="name"
                                tick={{
                                  fill: "#68748b",
                                  fontSize: 11
                                }}
                                axisLine={false}
                                tickLine={false}
                              />
                              <YAxis
                                domain={[0, 100]}
                                tick={{
                                  fill: "#8a94a8",
                                  fontSize: 10
                                }}
                                axisLine={false}
                                tickLine={false}
                              />
                              <Tooltip
                                formatter={(value) => [`${value}/100`, "Score"]}
                              />
                              <Legend />
                              <Bar
                                dataKey={websiteLabel(selectedA)}
                                name={`A: ${websiteLabel(selectedA)}`}
                                fill="#536dfe"
                                radius={[4, 4, 0, 0]}
                              />
                              <Bar
                                dataKey={websiteLabel(selectedB)}
                                name={`B: ${websiteLabel(selectedB)}`}
                                fill="#0891b2"
                                radius={[4, 4, 0, 0]}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <p className="comparison-note">
                        Comparison uses the scores saved at the time of each
                        analysis. Different dates, devices, network conditions
                        and website changes can affect results.
                      </p>
                    </>
                  )}
                </>
              )}
            </section>
          )}

          {page === "Reports" && (
            <section className="panel reports-panel">
              <div className="section-icon">▤</div>
              <h2>Latest Report</h2>
              <p>Summary of the latest selected website analysis.</p>

              {result ? (
                <div className="report-preview">
                  <h3>Website Performance Report</h3>
                  <p className="report-url">{result.url}</p>

                  {scoreItems.map((item) => (
                    <div className="report-score" key={item.key}>
                      <span>{item.title}</span>
                      <strong>{displayValue(result[item.key])}/100</strong>
                    </div>
                  ))}

                  <button
                    className="primary-button"
                    onClick={exportReport}
                  >
                    Export Report (JSON)
                  </button>
                </div>
              ) : (
                <p>Analyze a website first to create a report.</p>
              )}
            </section>
          )}

          {page === "Settings" && (
            <section className="panel settings-panel">
              <div className="section-icon">⚙</div>
              <h2>Settings</h2>
              <p>Application and connection information.</p>

              <div className="setting-row">
                <div>
                  <strong>Backend API</strong>
                  <p>{API}</p>
                </div>
              </div>

              <div className="setting-row">
                <div>
                  <strong>Saved history</strong>
                  <p>{history.length} records loaded from MongoDB.</p>
                </div>
                <button className="secondary-button" onClick={loadHistory}>
                  Refresh History
                </button>
              </div>

              <p className="settings-note">
                INP field data is retrieved from Google PageSpeed Insights when
                public data is available. Lighthouse category scores and other
                metrics come from your backend.
              </p>
            </section>
          )}

          <footer className="footer">
            <span>WebPulse · Website Performance Monitor</span>
            <span>Powered by Lighthouse</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function HistoryTable({ history }) {
  if (!history.length) {
    return <p className="empty-text">No saved analyses found.</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Website</th>
            <th>Performance</th>
            <th>Accessibility</th>
            <th>Best Practices</th>
            <th>SEO</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {history.map((item, index) => (
            <tr key={item._id || index}>
              <td className="website-cell" title={item.url}>
                {item.url}
              </td>
              <td>{displayValue(item.performance)}</td>
              <td>{displayValue(item.accessibility)}</td>
              <td>{displayValue(item.bestPractices)}</td>
              <td>{displayValue(item.seo)}</td>
              <td>
                {item.createdAt
                  ? new Date(item.createdAt).toLocaleString()
                  : "--"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;