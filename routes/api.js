const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const router = express.Router();

const githubToken = process.env.GITHUB_TOKEN;
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Categorize Files
function categorizeFiles(filePath) {
    const parsableExtensions = [
        '.js', '.py', '.swift', '.java', '.ts', '.md', '.txt', '.html', '.geojson', '.xml', '.json',
        '.yml', '.yaml', '.csv', '.sql', '.ini', '.conf', '.css', '.scss', '.less', '.rb', '.go',
        '.php', '.c', '.cpp', '.h', '.sh', '.bat', '.dockerfile'
    ];

    const nonParsableExtensions = [
        '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.zip', '.rar', '.7z', '.tar', '.gz', '.iso', '.mp3',
        '.mp4', '.avi', '.mkv', '.mov', '.wav', '.flac', '.ico', '.pdf', '.psd', '.ai', '.svg', '.ttf', '.woff', '.eot'
    ];

    const specialFiles = ['Dockerfile', '.gitattributes', '.gitignore']; // Files with no extension but are important

    if (parsableExtensions.some(ext => filePath.toLowerCase().endsWith(ext))) {
        return 'parsable';
    }
    if (nonParsableExtensions.some(ext => filePath.toLowerCase().endsWith(ext))) {
        return 'non-parsable';
    }
    if (specialFiles.some(file => filePath.endsWith(file))) {
        return 'parsable'; // Treat special files as parsable
    }
    return 'unknown'; // For all other files
}


// Fetch Repository Files
async function fetchRepoFiles({ owner, repo }) {
    const headers = { Authorization: `token ${githubToken}` };

    try {
        // Get default branch
        const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
        const { data: repoData } = await axios.get(repoUrl, { headers });
        const defaultBranch = repoData.default_branch;

        // Get repository tree
        const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`;
        const { data: treeData } = await axios.get(treeUrl, { headers });

        const categorizedFiles = { parsable: [], nonParsable: [], unknown: [] };

        treeData.tree.forEach(file => {
            if (file.type === 'blob') {
                const category = categorizeFiles(file.path);
                if (category === 'parsable') {
                    categorizedFiles.parsable.push(file);
                } else if (category === 'non-parsable') {
                    categorizedFiles.nonParsable.push(file);
                } else {
                    categorizedFiles.unknown.push(file);
                }
            }
        });

        return categorizedFiles;
    } catch (error) {
        console.error("Error fetching repo files:", error.message);
        throw new Error("Failed to fetch repository files.");
    }
}

// Fetch File Content
async function fetchFileContent(fileUrl) {
    const headers = { Authorization: `token ${githubToken}` };

    try {
        const { data } = await axios.get(fileUrl, { headers });
        return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch (error) {
        console.error("Error fetching file content:", error.message);
        throw new Error("Failed to fetch file content.");
    }
}

// Analyze Code with OpenAI
async function analyzeCode(content, filePath) {
    let prompt = `You are a cybersecurity expert specializing in secure coding practices, vulnerability assessment, and API security.

Below is the raw source code provided for analysis. Your task is to:
1. Identify specific security vulnerabilities in the code. Do not speculate—base your analysis on the provided code only.
2. Identify any exposed or misconfigured APIs, hardcoded secrets, or insecure practices.
3. Provide concrete and actionable recommendations to improve the security of the code.
4. Highlight best practices for secure coding relevant to the provided code.\n\n${content}`;

    if (filePath.endsWith('.md') || filePath.endsWith('.txt')) {
        prompt = `Analyze the following text file for clarity, grammar, and content quality:\n\n${content}`;
    }

    const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
    });

    return response.choices[0].message.content.trim();
}

// Analyze Files
async function analyzeFiles(categorizedFiles) {
    const results = [];
    const { parsable, nonParsable, unknown } = categorizedFiles;

    // Analyze parsable files
    for (const file of parsable) {
        try {
            const content = await fetchFileContent(file.url);
            const analysis = await analyzeCode(content, file.path);
            results.push({ filePath: file.path, analysis });
        } catch (error) {
            console.error(`Error analyzing file ${file.path}:`, error.message);
            results.push({ filePath: file.path, error: error.message });
        }
    }

    // Add non-parsable files to the results
    nonParsable.forEach(file => {
        results.push({ filePath: file.path, note: "This file type is not parsable and was skipped." });
    });

    // Add unknown files to the results
    unknown.forEach(file => {
        results.push({ filePath: file.path, note: "This file type is not recognized and was skipped." });
    });

    return results;
}


// Analyze Repository (Summary Metrics)
async function analyzeRepo(categorizedFiles) {
    const { parsable, nonParsable, unknown } = categorizedFiles;

    // Security Rating (Simple Heuristics)
    const sensitiveFiles = parsable.filter(file =>
        file.path.includes('.env') || file.path.includes('config')
    );
    const securityRating = 10 - Math.min(sensitiveFiles.length, 10); // Deduct points for sensitive files

    // File Type Distribution
    const fileTypes = {};
    [...parsable, ...nonParsable, ...unknown].forEach(file => {
        const extension = file.path.split('.').pop() || 'no-extension';
        fileTypes[extension] = (fileTypes[extension] || 0) + 1;
    });

    // Repository Size and File Count
    const totalSizeKB = [...parsable, ...nonParsable, ...unknown].reduce(
        (sum, file) => sum + (file.size || 0),
        0
    ) / 1024;
    const fileCount = parsable.length + nonParsable.length + unknown.length;

    return {
        securityRating,
        fileTypes,
        totalSizeKB: totalSizeKB.toFixed(2),
        fileCount,
    };
}


// Unified Analyze Route
router.post('/analyze', async (req, res) => {
    const { githubUrl } = req.body;

    try {
        if (!githubUrl) throw new Error("GitHub URL is required.");
        console.log("GitHub URL received:", githubUrl);

        // Extract repo details
        const repoDetails = /github\.com\/([^\/]+)\/([^\/]+)/.exec(githubUrl);
        if (!repoDetails) throw new Error("Invalid GitHub URL.");
        console.log("Parsed Repo Details:", repoDetails);

        // Fetch and categorize files
        const categorizedFiles = await fetchRepoFiles({
            owner: repoDetails[1],
            repo: repoDetails[2],
        });
        console.log("Categorized Files:", categorizedFiles);

        // Analyze repository-level metrics
        const metrics = await analyzeRepo(categorizedFiles);
        console.log("Computed Metrics:", metrics);

        // Analyze individual files
        const analysis = await analyzeFiles(categorizedFiles);
        console.log("Analysis Results:", analysis);

        // Send combined response
        res.json({ success: true, metrics, report: analysis });
    } catch (error) {
        console.error("Error during analysis:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
