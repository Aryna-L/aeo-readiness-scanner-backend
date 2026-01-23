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

    // Detect page type for context-aware scoring
    const pageType = detectPageType(doc, url);

    const answerCheck = checkAnswerExtraction(doc);
    totalPoints += answerCheck.points;
    checks.push(answerCheck);
    if (!answerCheck.pass) recommendations.push(...answerCheck.recommendations);

    const structureCheck = checkContentStructure(doc);
    totalPoints += structureCheck.points;
    checks.push(structureCheck);
    if (!structureCheck.pass) recommendations.push(...structureCheck.recommendations);

    const schemaCheck = checkSchemaPresence(doc, pageType);
    totalPoints += schemaCheck.points;
    checks.push(schemaCheck);
    if (!schemaCheck.pass && !schemaCheck.isOptional) {
        recommendations.push(...schemaCheck.recommendations);
    }

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

    return { score: normalizedScore, checks, recommendations, pageType };
}

function detectPageType(doc, url) {
    const urlLower = url.toLowerCase();
    const title = doc.querySelector('title')?.textContent.toLowerCase() || '';
    const h1 = doc.querySelector('h1')?.textContent.toLowerCase() || '';
    
    // Homepage detection
    const path = new URL(url).pathname;
    if (path === '/' || path === '/index.html' || path === '/home') {
        return 'homepage';
    }
    
    // Article/blog detection
    if (urlLower.includes('/blog/') || urlLower.includes('/article/') || 
        urlLower.includes('/post/') || urlLower.includes('/news/')) {
        return 'article';
    }
    
    // Recipe detection
    if (urlLower.includes('/recipe') || title.includes('recipe') || h1.includes('recipe')) {
        return 'recipe';
    }
    
    // Product detection
    if (urlLower.includes('/product') || urlLower.includes('/shop/') || 
        doc.querySelector('[itemtype*="Product"]')) {
        return 'product';
    }
    
    // FAQ detection
    if (urlLower.includes('/faq') || title.includes('faq') || h1.includes('faq')) {
        return 'faq';
    }
    
    // Default to content page
    return 'content';
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
        points += 10; // Increased from 8
        details.push(`✓ H1 found: "${h1.textContent.trim().substring(0, 60)}..."`);

        const h1Text = h1.textContent.toLowerCase();
        if (h1Text.includes('what') || h1Text.includes('how') || h1Text.includes('why') || h1Text.includes('?')) {
            points += 5; // Increased from 4
            details.push('✓ H1 is formatted as a question');
        } else {
            details.push('ℹ H1 could be formatted as a question for better AEO');
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

            const hasIsA = defLower.includes(' is a ') || defLower.includes(' are ') || 
                          defLower.includes(' refers to ') || defLower.includes(' means ');

            // More lenient definition scoring
            if (defText.length > 0 && defText.length <= 250) { // Increased from 150
                points += 10; // More generous
                details.push(`✓ Definition paragraph found (${defText.length} chars)`);
                
                if (hasIsA) {
                    points += 5; // Bonus for clear definition pattern
                    details.push('✓ Definition uses clear explanatory pattern');
                }
            } else if (defText.length > 250) {
                points += 7; // Still give partial credit
                details.push(`ℹ Definition paragraph present but could be more concise (${defText.length} chars)`);
                recommendations.push('Consider making the opening definition more concise (under 250 characters)');
            }
        } else {
            recommendations.push('Add a clear definition paragraph near the top of the content');
        }
    } else {
        recommendations.push('Add a clear H1 heading to your page');
    }

    pass = points >= 15; // Lowered threshold from 18

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
    const h3s = doc.querySelectorAll('h3');
    const lists = doc.querySelectorAll('ul, ol');
    const paragraphs = doc.querySelectorAll('p');

    // More flexible heading structure
    if (h2s.length >= 3) { // Lowered from 4
        points += 15;
        details.push(`✓ Good heading structure (${h2s.length} H2 sections)`);
    } else if (h2s.length >= 2) {
        points += 10; // Increased from 8
        details.push(`✓ Adequate heading structure (${h2s.length} H2 sections)`);
    } else if (h2s.length === 1) {
        points += 5;
        recommendations.push('Add more H2 sections to improve content structure (aim for 3+)');
    } else {
        recommendations.push('Break content into clear H2 sections for better AI comprehension');
    }

    // H3 bonus points
    if (h3s.length >= 2) {
        points += 2;
        details.push(`✓ Subsections present (${h3s.length} H3s)`);
    }

    // Lists - more generous
    if (lists.length >= 2) {
        points += 8;
        details.push(`✓ Lists present (${lists.length})`);
    } else if (lists.length === 1) {
        points += 5;
        details.push(`✓ List present (consider adding more for better structure)`);
    } else {
        recommendations.push('Add bulleted or numbered lists to improve scanability');
    }

    pass = points >= 13; // Lowered from 15

    return {
        title: 'Content Structure',
        points,
        maxPoints,
        pass,
        details: details.join('\n'),
        recommendations
    };
}

function checkSchemaPresence(doc, pageType) {
    let points = 0;
    let details = [];
    const recommendations = [];
    const schemas = new Set();
    const maxPoints = 25;
    let isOptional = false;

    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');

    scripts.forEach(script => {
        try {
            const json = JSON.parse(script.textContent);
            const type = json['@type'];
            if (type) {
                if (Array.isArray(type)) {
                    type.forEach(t => schemas.add(t));
                } else {
                    schemas.add(type);
                }
            }
        } catch (e) {}
    });

    const schemaArray = Array.from(schemas);

    // Context-aware schema scoring
    if (pageType === 'homepage') {
        // Homepage: schema is nice to have but not critical
        isOptional = true;
        if (schemaArray.some(s => s.includes('Organization') || s.includes('WebSite'))) {
            points += 20;
            details.push(`✓ Organization/Website schema found`);
        } else {
            points += 15; // Give most points anyway
            details.push(`ℹ Homepage - Organization schema recommended but optional`);
        }
    } else if (pageType === 'article') {
        // Article: Article schema is important
        if (schemaArray.some(s => s.includes('Article') || s === 'BlogPosting' || s === 'NewsArticle')) {
            points += 15;
            details.push(`✓ Article schema found`);
        } else {
            points += 5;
            recommendations.push('Add Article or BlogPosting schema for better AEO');
        }
        
        if (schemaArray.some(s => s.includes('FAQ'))) {
            points += 10;
            details.push(`✓ FAQ schema found`);
        } else {
            points += 5; // Partial credit
        }
    } else if (pageType === 'recipe') {
        // Recipe: Recipe schema is very important
        if (schemaArray.some(s => s.includes('Recipe'))) {
            points += 20;
            details.push(`✓ Recipe schema found`);
        } else {
            recommendations.push('Add Recipe schema for recipe content');
        }
    } else if (pageType === 'product') {
        // Product: Product schema is important
        if (schemaArray.some(s => s.includes('Product'))) {
            points += 20;
            details.push(`✓ Product schema found`);
        } else {
            points += 5;
            recommendations.push('Add Product schema for better visibility');
        }
    } else {
        // Generic content page - flexible schema requirements
        if (schemaArray.length > 0) {
            points += 20; // Give generous points for any schema
            details.push(`✓ Structured data found: ${schemaArray.join(', ')}`);
        } else {
            points += 10; // Give half points even without schema
            recommendations.push('Consider adding relevant schema markup (Article, HowTo, FAQ, etc.)');
        }
    }

    // Always give bonus points for having any schema
    if (schemaArray.length > 0 && points < 15) {
        points += 5;
    }

    pass = points >= 12;

    return {
        title: 'Schema Markup',
        points,
        maxPoints,
        pass,
        details: details.join('\n'),
        recommendations,
        isOptional
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

    // More lenient internal linking
    if (internalLinks.length >= 3) {
        points += 10;
        details.push(`✓ Good internal linking (${internalLinks.length} links)`);
    } else if (internalLinks.length >= 1) {
        points += 7; // Give most points for having some internal links
        details.push(`✓ Internal links present (${internalLinks.length})`);
        recommendations.push('Consider adding more internal links to related content (aim for 3+)');
    } else {
        points += 3; // Still give some base points
        recommendations.push('Add internal links to related content for better topic clustering');
    }

    pass = points >= 7;

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
        points += 5;
        details.push('✓ Page loads successfully (200 OK)');
    } else {
        recommendations.push(`Fix HTTP status code (currently ${statusCode})`);
    }

    const canonical = doc.querySelector('link[rel="canonical"]');
    if (canonical) {
        points += 3;
        details.push('✓ Canonical tag present');
    } else {
        points += 1; // Partial credit
        recommendations.push('Add a canonical tag to specify preferred URL');
    }

    const title = doc.querySelector('title');
    if (title && title.textContent.trim()) {
        points += 2;
        details.push('✓ Title tag present');
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
                'User-Agent': 'Mozilla/5.0 (compatible; AEOScanner/1.0)'
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
