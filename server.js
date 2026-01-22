const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { JSDOM } = require("jsdom");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.post("/api/fetch", async (req, res) => {
  const { url } = req.body;

  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    return res.status(400).json({ error: "Valid URL required" });
  }

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      },
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true
    });

    const headers = {
      "x-robots-tag": response.headers["x-robots-tag"] || null,
      "content-type": response.headers["content-type"] || null
    };

    const finalUrl = response.request?.res?.responseUrl || url;

    const analysis = runAnalysis(
      response.data,
      url,
      response.status,
      headers,
      finalUrl
    );

    res.json({
      score: analysis.score,
      checks: analysis.checks,
      recommendations: analysis.recommendations,
      html: response.data,
      statusCode: response.status,
      headers,
      finalUrl
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to fetch URL"
    });
  }
});

function runAnalysis(html, url, statusCode, headers, finalUrl) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  let totalPoints = 0;
  const checks = [];
  const recommendations = [];

  const answerCheck = checkAnswerExtraction(doc);
  totalPoints += answerCheck.points;
  checks.push(answerCheck);
  if (!answerCheck.pass) recommendations.push(...answerCheck.recommendations);

  const structureCheck = checkContentStructure(doc);
  totalPoints += structureCheck.points;
  checks.push(structureCheck);
  if (!structureCheck.pass) recommendations.push(...structureCheck.recommendations);

  const schemaCheck = checkSchemaPresence(doc);
  totalPoints += schemaCheck.points;
  checks.push(schemaCheck);
  if (!schemaCheck.pass) recommendations.push(...schemaCheck.recommendations);

  const linkingCheck = checkInternalLinking(doc, url);
  totalPoints += linkingCheck.points;
  checks.push(linkingCheck);
  if (!linkingCheck.pass) recommendations.push(...linkingCheck.recommendations);

  const crawlCheck = checkCrawlability(doc, statusCode, headers, url, finalUrl);
  totalPoints += crawlCheck.points;
  checks.push(crawlCheck);
  if (!crawlCheck.pass) recommendations.push(...crawlCheck.recommendations);

  const maxPossible = checks.reduce((sum, check) => sum + check.maxPoints, 0);
  const normalizedScore = Math.round((totalPoints / maxPossible) * 100);

  return { score: normalizedScore, checks, recommendations };
}

function checkAnswerExtraction(doc) {
  let points = 0;
  let details = [];
  let pass = false;
  const recommendations = [];
  const maxPoints = 30;

  const h1 = doc.querySelector("h1");
  const allPs = doc.querySelectorAll("p");

  if (h1) {
    points += 8;
    details.push(`✓ H1 found: "${h1.textContent.trim().substring(0, 60)}..."`);

    const h1Text = h1.textContent.toLowerCase();
    if (
      h1Text.includes("what") ||
      h1Text.includes("how") ||
      h1Text.includes("why") ||
      h1Text.includes("?")
    ) {
      points += 4;
      details.push("✓ H1 is formatted as a question");
    }

    let defParagraph = null;
    let nextEl = h1.nextElementSibling;

    while (nextEl && !defParagraph) {
      if (nextEl.tagName === "P" && nextEl.textContent.trim().length > 0) {
        defParagraph = nextEl;
        break;
      }
      nextEl = nextEl.nextElementSibling;
    }

    if (!defParagraph && allPs.length > 0) {
      defParagraph = allPs[0];
    }

    if (defParagraph) {
      const defText = defParagraph.textContent.trim();
      if (defText.length > 0 && defText.length <= 150) {
        points += 12;
        details.push(`✓ Concise definition found (${defText.length} chars)`);
      } else if (defText.length > 150 && defText.length <= 300) {
        points += 6;
        recommendations.push(
          "Shorten the opening definition to under 150 characters"
        );
      } else {
        points += 3;
        recommendations.push(
          "Add a concise definition paragraph directly after the H1"
        );
      }
    } else {
      recommendations.push(
        "Add a concise definition paragraph directly after the H1"
      );
    }
  } else {
    recommendations.push(
      "Add a clear H1 heading, ideally formatted as a question"
    );
  }

  pass = points >= 18;

  return {
    title: "Answer Extraction",
    points,
    maxPoints,
    pass,
    details: details.join("\n"),
    recommendations
  };
}

function checkContentStructure(doc) {
  let points = 0;
  let details = [];
  const recommendations = [];
  const maxPoints = 25;

  const h2s = doc.querySelectorAll("h2");
  const h3s = doc.querySelectorAll("h3");
  const lists = doc.querySelectorAll("ul, ol");

  if (h2s.length >= 4) {
    points += 12;
  } else if (h2s.length >= 2) {
    points += 6;
    recommendations.push("Add more H2 sections");
  } else {
    recommendations.push("Break content into H2 sections");
  }

  if (h3s.length >= 2) points += 5;
  if (lists.length >= 2) points += 8;

  pass = points >= 15;

  return {
    title: "Content Structure",
    points,
    maxPoints,
    pass,
    details: details.join("\n"),
    recommendations
  };
}

function checkSchemaPresence(doc) {
  let points = 0;
  let details = [];
  const recommendations = [];
  const schemas = new Set();
  const maxPoints = 25;

  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');

  scripts.forEach(script => {
    try {
      const json = JSON.parse(script.textContent);
      if (json["@type"]) {
        const types = Array.isArray(json["@type"])
          ? json["@type"]
          : [json["@type"]];
        types.forEach(t => schemas.add(t));
      }
    } catch (e) {}
  });

  const schemaArray = Array.from(schemas);

  if (schemaArray.some(s => s.includes("Article"))) points += 10;
  else recommendations.push("Add Article or BlogPosting schema");

  if (schemaArray.some(s => s.includes("FAQ"))) points += 8;
  else recommendations.push("Add FAQ schema");

  if (schemaArray.length > 0) details.push(`✓ Schemas found`);
  else details.push("✗ No schema markup detected");

  pass = points >= 10;

  return {
    title: "Schema Markup",
    points,
    maxPoints,
    pass,
    details: details.join("\n"),
    recommendations
  };
}

function checkInternalLinking(doc, url) {
  let points = 0;
  let details = [];
  const recommendations = [];
  const maxPoints = 10;

  try {
    const baseUrl = new URL(url);
    const links = doc.querySelectorAll("a[href]");
    const internalLinks = [];

    links.forEach(link => {
      const href = link.getAttribute("href");
      try {
        const linkUrl = new URL(href, url);
        if (linkUrl.hostname === baseUrl.hostname) {
          internalLinks.push(href);
        }
      } catch (e) {}
    });

    if (internalLinks.length >= 3) points += 6;
    else if (internalLinks.length > 0) {
      points += 3;
      recommendations.push("Add more internal links");
    } else {
      recommendations.push("Add internal links");
    }
  } catch (e) {}

  pass = points >= 6;

  return {
    title: "Internal Linking",
    points,
    maxPoints,
    pass,
    details: details.join("\n"),
    recommendations
  };
}

function checkCrawlability(doc, statusCode, headers, originalUrl, finalUrl) {
  let points = 0;
  let details = [];
  const recommendations = [];
  const maxPoints = 10;

  if (statusCode === 200) points += 3;
  else recommendations.push("Fix HTTP status code");

  const robotsMeta = doc.querySelector('meta[name="robots"]');
  const noindex =
    robotsMeta && robotsMeta.content.toLowerCase().includes("noindex");

  const xRobotsNoindex =
    headers["x-robots-tag"] &&
    headers["x-robots-tag"].toLowerCase().includes("noindex");

  if (!noindex && !xRobotsNoindex) points += 3;
  else recommendations.push("Remove noindex directives");

  const canonical = doc.querySelector('link[rel="canonical"]');
  if (canonical) points += 2;
  else recommendations.push("Add a canonical tag");

  const title = doc.querySelector("title");
  if (title && title.textContent.trim()) points += 2;
  else recommendations.push("Add a title tag");

  pass = points >= 6;

  return {
    title: "Crawlability",
    points,
    maxPoints,
    pass,
    details: details.join("\n"),
    recommendations
  };
}

app.listen(PORT, () => {
  console.log(`AEO Scanner backend running on ${PORT}`);
});
