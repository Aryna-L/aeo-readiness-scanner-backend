const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { JSDOM } = require('jsdom');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.post('/api/fetch', async (req, res) => {
  const { url } = req.body;

  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return res.status(400).json({ error: 'Valid URL required' });
  }

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true
    });

    const html = response.data;
    const statusCode = response.status;
    const headers = {
      'x-robots-tag': response.headers['x-robots-tag'] || null,
      'content-type': response.headers['content-type'] || null
    };
    const finalUrl = response.request?.res?.responseUrl || url;

    const analysis = analyzeHTML(html, statusCode, headers);

    res.json({
      score: analysis.score,
      checks: analysis.checks,
      recommendations: analysis.recommendations,
      statusCode,
      headers,
      finalUrl
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || 'Failed to fetch URL'
    });
  }
});

function analyzeHTML(html, statusCode, headers) {
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

  const crawlCheck = checkCrawlability(doc, statusCode, headers);
  totalPoints += crawlCheck.points;
  checks.push(crawlCheck);
  if (!crawlCheck.pass) recommendations.push(...crawlCheck.recommendations);

  const maxPossible = checks.reduce((sum, c) => sum + c.maxPoints, 0);
  const normalizedScore = Math.round((totalPoints / maxPossible) * 100);

  return { score: normalizedScore, checks, recommendations };
}

function checkAnswerExtraction(doc) {
  let points = 0;
  const details = [];
  const recommendations = [];
  const maxPoints = 30;

  const h1 = doc.querySelector('h1');
  const allPs = doc.querySelectorAll('p');

  if (h1) {
    points += 8;
    details.push(`H1 found`);

    const h1Text = h1.textContent.toLowerCase();
    if (
      h1Text.includes('what') ||
      h1Text.includes('how') ||
      h1Text.includes('why') ||
      h1Text.includes('?')
    ) {
      points += 4;
      details.push('H1 is formatted as a question');
    }

    let defParagraph = null;
    let nextEl = h1.nextElementSibling;

    while (nextEl && !defParagraph) {
      if (nextEl.tagName === 'P' && nextEl.textContent.trim().length > 0) {
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
        points += 18;
        details.push('Concise definition found');
      } else if (defText.length > 150) {
        points += 8;
        details.push('Definition found but too long');
        recommendations.push('Shorten the opening definition to under 150 characters');
      }
    } else {
      recommendations.push('Add a concise definition paragraph directly after the H1');
    }
  } else {
    recommendations.push('Add a clear H1 heading');
  }

  return {
    title: 'Answer Extraction',
    points,
    maxPoints,
    pass: points >= 18,
    details: details.join('\n'),
    recommendations
  };
}

function checkContentStructure(doc) {
  let points = 0;
  const details = [];
  const recommendations = [];
  const maxPoints = 25;

  const h2s = doc.querySelectorAll('h2');
  const lists = doc.querySelectorAll('ul, ol');

  if (h2s.length >= 4) {
    points += 12;
    details.push('Good H2 structure');
  } else if (h2s.length >= 2) {
    points += 6;
    recommendations.push('Add more H2 sections');
  } else {
    recommendations.push('Break content into H2 sections');
  }

  if (lists.length >= 2) {
    points += 13;
    details.push('Lists present');
  } else {
    recommendations.push('Add bulleted or numbered lists');
  }

  return {
    title: 'Content Structure',
    points,
    maxPoints,
    pass: points >= 15,
    details: details.join('\n'),
    recommendations
  };
}

function checkSchemaPresence(doc) {
  let points = 0;
  const details = [];
  const recommendations = [];
  const maxPoints = 25;

  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  const schemas = new Set();

  scripts.forEach(script => {
    try {
      const json = JSON.parse(script.textContent);
      if (json['@type']) schemas.add(json['@type']);
    } catch (e) {}
  });

  if (schemas.size > 0) {
    points += 25;
    details.push('Schema detected');
  } else {
    recommendations.push('Add Article or FAQ schema markup');
  }

  return {
    title: 'Schema Markup',
    points,
    maxPoints,
    pass: points >= 10,
    details: details.join('\n'),
    recommendations
  };
}

function checkCrawlability(doc, statusCode, headers) {
  let points = 0;
  const details = [];
  const recommendations = [];
  const maxPoints = 20;

  if (statusCode === 200) {
    points += 10;
    details.push('HTTP 200');
  } else {
    recommendations.push('Fix HTTP status to 200');
  }

  const robotsMeta = doc.querySelector('meta[name="robots"]');
  const noindex = robotsMeta && robotsMeta.content.toLowerCase().includes('noindex');
  const xRobots = headers['x-robots-tag'];
  const xNoindex = xRobots && xRobots.toLowerCase().includes('noindex');

  if (!noindex && !xNoindex) {
    points += 10;
    details.push('Indexable');
  } else {
    recommendations.push('Remove noindex directives');
  }

  return {
    title: 'Crawlability',
    points,
    maxPoints,
    pass: points >= 10,
    details: details.join('\n'),
    recommendations
  };
}

app.listen(PORT, () => {
  console.log(`AEO Scanner backend running on ${PORT}`);
});
