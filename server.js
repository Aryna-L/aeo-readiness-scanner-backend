const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.post('/api/fetch', async (req, res) => {
    const { url } = req.body;
    
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        return res.status(400).json({ error: 'Valid URL required' });
    }

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 10000,
            maxRedirects: 5,
            validateStatus: () => true
        });

        res.json({
            html: response.data,
            statusCode: response.status,
            headers: {
                'x-robots-tag': response.headers['x-robots-tag'] || null,
                'content-type': response.headers['content-type'] || null
            },
            finalUrl: response.request.res.responseUrl || url
        });
    } catch (error) {
        res.status(500).json({ 
            error: error.message || 'Failed to fetch URL'
        });
    }
});

app.listen(PORT, () => {
    console.log(`AEO Scanner backend running on ${PORT}`);
});