const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

function analyzeHTML(html, url, statusCode, headers, finalUrl) {
    const { JSDOM } = require('jsdom');
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

    const h1 = doc.querySelector('h1');
    const allPs = doc.querySelectorAll('p');

    if (h1) {
        points += 8;
        details.push(`✓ H1 found: "${h1.textContent.trim().substring(0, 60)}..."`);

        const h1Text = h1.textContent.toLowerCase();
        if (h1Text.includes('what') || h1Text.includes('how') || h1Text.includes('why') || h1Text.includes('?')) {
            points += 4;
            details.push('✓ H1 is formatted as a question');
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
            const defLower = defText.toLowerCase();

            const hasIsA = defLower.includes(' is a ') || defLower.includes(' are ') || defLower.includes(' refers to ');

            if (defText.length > 0 && defText.length <= 150) {
                points += 12;
                details.push(`✓ Concise definition found (${defText.length} chars)`);
                if (hasIsA) {
                    points += 6;
                    details.push('✓ Definition uses "is a" or "refers to" pattern');
                }
            } else {
                recommendations.push('Add a concise definition paragraph (under 150 characters) directly after the H1');
            }
        } else {
            recommendations.push('Add a concise definition paragraph directly after the H1 (under 150 characters)');
        }
    } else {
        recommendations.push('Add a clear H1 heading, ideally formatted as a question');
    }

    pass = points >= 18;

    return {
        title: 'Answer Extraction',
        points,
        maxPoints,
        pass,
        details: details.join('\n'),
        recommendations
    };
}

function checkContentStructure(doc) {
    let points = 0;
    let details = [];
    const recommendations = [];
    const maxPoints = 25;

    const h2s = doc.querySelectorAll('h2');
    const lists = doc.querySelectorAll('ul, ol');

    if (h2s.length >= 4) {
        points += 15;
        details.push(`✓ Good H2 structure (${h2s.length} sections)`);
    } else if (h2s.length >= 2) {
        points += 8;
        recommendations.push('Add more H2 sections to improve content structure');
    } else {
        recommendations.push('Break content into at least 4 H2 sections for better AI comprehension');
    }

    if (lists.length >= 2) {
        points += 10;
        details.push(`✓ Lists present (${lists.length})`);
    } else {
        recommendations.push('Add bulleted or numbered lists to structure information for AI parsing');
    }

    pass = points >= 15;

    return {
        title: 'Content Structure',
        points,
        maxPoints,
        pass,
        details: details.join('\n'),
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
            const type = json['@type'];
            if (type) {
                schemas.add(type);
            }
        } catch (e) {}
    });

    const schemaArray = Array.from(schemas);

    if (schemaArray.some(s => s.includes('Article') || s === 'BlogPosting')) {
        points += 12;
    } else {
        recommendations.push('Add Article or BlogPosting schema markup using JSON-LD');
    }

    if (schemaArray.some(s => s.includes('FAQ'))) {
        points += 8;
    } else {
        recommendations.push('Add FAQ schema if content includes questions and answers');
    }

    if (schemaArray.length > 0) {
        details.push(`✓ Schemas found: ${schemaArray.join(', ')}`);
        points += 5;
    } else {
        recommendations.push('Add structured data schemas');
    }

    pass = points >= 12;

    return {
        title: 'Schema Markup',
        points,
        maxPoints,
        pass,
        details: details.join('\n'),
        recommendations
    };
}

function checkInternalLinking(doc, url) {
    let points = 0;
    let details = [];
    const recommendations = [];
    const maxPoints = 10;

    const baseUrl = new URL(url);
    const links = doc.querySelectorAll('a[href]');
    const internalLinks = [];

    links.forEach(link => {
        const href = link.getAttribute('href');
        if (href) {
            try {
                const linkUrl = new URL(href, url);
                if (linkUrl.hostname === baseUrl.hostname) {
                    internalLinks.push(link);
                }
            } catch (e) {}
        }
    });

    if (internalLinks.length >= 3) {
        points += 6;
        details.push(`✓ Good internal linking (${internalLinks.length})`);
    } else {
        recommendations.push('Add at least 3 internal links to related content');
    }

    pass = points >= 6;

    return {
        title: 'Internal Linking',
        points,
        maxPoints,
        pass,
        details: details.join('\n'),
        recommendations
    };
}

function checkCrawlability(doc, statusCode, headers, originalUrl, finalUrl) {
    let points = 0;
    let details = [];
    const recommendations = [];
    const maxPoints = 10;

    if (statusCode === 200) {
        points += 4;
    } else {
        recommendations.push('Fix HTTP status code to 200');
    }

    const canonical = doc.querySelector('link[rel="canonical"]');
    if (canonical) {
        points += 3;
    } else {
        recommendations.push('Add a canonical tag');
    }

    const title = doc.querySelector('title');
    if (title && title.textContent.trim()) {
        points += 3;
    } else {
        recommendations.push('Add a descriptive title tag');
    }

    pass = points >= 6;

    return {
        title: 'Crawlability',
        points,
        maxPoints,
        pass,
        details: details.join('\n'),
        recommendations
    };
}

app.post('/api/analyze', async (req, res) => {
    const { url } = req.body;

    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        return res.status(400).json({ error: 'Valid URL required' });
    }

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            },
            timeout: 10000,
            maxRedirects: 5,
            validateStatus: () => true
        });

        const result = analyzeHTML(
            response.data,
            url,
            response.status,
            {
                'x-robots-tag': response.headers['x-robots-tag'] || null
            },
            response.request.res.responseUrl || url
        );

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to analyze URL' });
    }
});

app.listen(PORT, () => {
    console.log(`AEO Scanner backend running on ${PORT}`);
});
