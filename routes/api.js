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
        '.php', '.c', '.cpp', '.h', '.sh', '.bat', '.dockerfile', '.terminal',
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
        let content = Buffer.from(data.content, 'base64').toString('utf-8');

        // Truncate if content exceeds a certain size
        const maxLength = 10000; // Limit to 10,000 characters
        if (content.length > maxLength) {
            content = content.slice(0, maxLength) + "\n... [Content Truncated]";
        }

        return content;
    } catch (error) {
        console.error("Error fetching file content:", error.message);
        throw new Error("Failed to fetch file content.");
    }
}

async function summarizeContent(content, filePath) {
    const prompt = `
The following is the content of a file from a software repository. Summarize it concisely, highlighting the key details, purpose, and any relevant information:
File path: ${filePath}

Content:
${content.slice(0, 8000)}... [Content Truncated if Necessary]
`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 500,
        });

        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error("Error summarizing file content:", error.message);
        throw new Error("Failed to summarize file content.");
    }
}



// Analyze Code with OpenAI
async function analyzeCode(content, filePath) {
    let prompt = `You are a cybersecurity expert specializing in secure coding practices, vulnerability assessment, and API security.
    Do not include any #, ##, ### or *, **, *** in your response.

Below is the raw source code provided for analysis. Your task is to provide the following in separate sections:
1. **Security Metrics**: Identify specific security vulnerabilities such as injection attack vulnerabilities, exposed keys, and any insecure practices.
2. **Function Analysis**: Provide a paragraph describing the function and purpose of the file.
3. **Security Recommendations**: Offer concrete and actionable recommendations to improve the security of the code.

Please format your response as follows:
Security Metrics:
[Your analysis here]

Function Analysis:
[Your analysis here]

Security Recommendations:
[Your recommendations here]

\n\n${content}`;

    if (filePath.endsWith('.md') || filePath.endsWith('.txt')) {
        prompt = `Analyze the following text file for clarity, grammar, and content quality:\n\n${content}`;
    }

    const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
    });

    return response.choices[0].message.content.trim();
}

function getLanguageByExtension(filePath) {
    const extensionMap = {
        js: "JavaScript",
        py: "Python",
        swift: "Swift",
        java: "Java",
        ts: "TypeScript",
        html: "HTML",
        css: "CSS",
        scss: "SCSS",
        less: "LESS",
        go: "Go",
        rb: "Ruby",
        php: "PHP",
        c: "C",
        cpp: "C++",
        h: "C Header",
        sh: "Shell Script",
        md: "Markdown",
        json: "JSON",
        xml: "XML",
        yaml: "YAML",
        yml: "YAML",
        sql: "SQL",
        dockerfile: "Dockerfile",
        ini: "INI File",
        conf: "Config File",
        md: "Markdown",
        txt: "Text File",
        csv: "CSV File",
        pdf: "PDF File",
        ppt: "PowerPoint File",
        doc: "Word Document",
        xls: "Excel File",
        zip: "Zip File",
        rar: "RAR File",
        tar: "Tar File",
    };

    const extension = filePath.split('.').pop().toLowerCase();
    return extensionMap[extension] || "Unknown";
}

async function fetchRepoLanguages(owner, repo) {
    const headers = { Authorization: `token ${githubToken}` };
    const url = `https://api.github.com/repos/${owner}/${repo}/languages`;

    try {
        const { data } = await axios.get(url, { headers });
        return data; // Returns an object like { JavaScript: 1024, Python: 2048 }
    } catch (error) {
        console.error("Error fetching repo languages:", error.message);
        return {}; // Return an empty object if the request fails
    }
}



// Analyze Files
async function analyzeFiles(categorizedFiles, repoLanguages) {
    const results = [];
    const { parsable } = categorizedFiles;

    for (const file of parsable) {
        try {
            // Get the extension-based language
            const extensionLanguage = getLanguageByExtension(file.path);

            // Check if GitHub language data has this file's language
            const githubLanguage = Object.keys(repoLanguages).find(lang =>
                file.path.toLowerCase().includes(lang.toLowerCase())
            );

            // Use GitHub language if available; otherwise, fallback to extension-based detection
            const language = githubLanguage || extensionLanguage;

            let content = await fetchFileContent(file.url);

            // Summarize content if it's too long
            if (content.length > 10000) {
                content = await summarizeContent(content, file.path);
            }

            const analysis = await analyzeCode(content, file.path);
            results.push({
                filePath: file.path,
                analysis,
                language,
            });
        } catch (error) {
            console.error(`Error analyzing file ${file.path}:`, error.message);
            results.push({
                filePath: file.path,
                error: error.message,
                language: "Unknown",
            });
        }
    }

    return results;
}







async function analyzeRepositoryTypeAndStatus(fileSummary) {
    const prompt = `

You are an expert in software repositories and application architecture.

Based on the following summary of a repository, provide:
1. The type of the repository (e.g., "Node.js Application", "Python Library", "Containerized Application", etc.).
2. A safety status: "Clean to Use", "Inspect Before Use", or "Not Safe to Use".
3. A concise explanation for your safety assessment.
4. A security score out of 96 based on the repository's safety.

Repository Summary:
- File Types: ${JSON.stringify(fileSummary.fileTypes, null, 2)}
- Contains sensitive files: ${fileSummary.containsSensitiveFiles ? "Yes" : "No"}
- Total size: ${fileSummary.totalSizeKB} KB
- Total files: ${fileSummary.fileCount}

Answer in the following format:
Type: [Repository Type]
Status: [Safety Status]
Explanation: [Reasoning for the status]
Security Score: [Numeric Value]

Do not include any # or * in your response.


`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 300,
        });

        const result = response.choices[0].message.content.trim();
        const [typeLine, statusLine, explanationLine, scoreLine] = result.split("\n");
        const type = typeLine.replace("Type: ", "").trim();
        const status = statusLine.replace("Status: ", "").trim();
        const explanation = explanationLine.replace("Explanation: ", "").trim();
        const securityScore = parseInt(scoreLine.replace("Security Score: ", "").trim(), 10);

        return { type, status, explanation, securityScore };
    } catch (error) {
        console.error("Error analyzing repository type and status:", error.message);
        return {
            type: "Unknown",
            status: "Inspect Before Use",
            explanation: "Unable to determine repository type and safety status.",
            securityScore: 0,
        };
    }
}




// Analyze Repository (Summary Metrics)
async function analyzeRepo(categorizedFiles) {
    const { parsable, nonParsable, unknown } = categorizedFiles;

    // Security Rating (Simple Heuristics)
    const sensitiveFiles = parsable.filter(file =>
        file.path.includes('.env') || file.path.includes('config')
    );
    const containsSensitiveFiles = sensitiveFiles.length > 0;
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

    // Determine Repository Type
    let repositoryType = "Unknown";
    if (parsable.some(file => file.path.includes("package.json"))) {
        repositoryType = "Node.js Application";
    } else if (parsable.some(file => file.path.includes("requirements.txt"))) {
        repositoryType = "Python Project";
    } else if (parsable.some(file => file.path.includes("Dockerfile"))) {
        repositoryType = "Containerized Application";
    }

    // Determine Status
    let status = "Inspect Before Use"; // Default status
    if (containsSensitiveFiles) {
        status = "Not Safe to Use";
    } else if (parsable.length > 0) {
        status = "Clean to Use";
    }

    // Calculate Community Score
    const diversityScore = Math.min(Object.keys(fileTypes).length, 10); // Max 10 for diverse file types
    const sizeScore = totalSizeKB < 500 ? 10 : totalSizeKB < 1000 ? 7 : 5; // Smaller repos score higher
    const sensitiveScore = containsSensitiveFiles ? -10 : 0; // Deduct 10 for sensitive files

    const communityScore = Math.max(0, 50 + diversityScore + sizeScore + sensitiveScore);

    return {
        securityRating,
        fileTypes,
        totalSizeKB: totalSizeKB.toFixed(2),
        fileCount,
        repositoryType,
        status,
        communityScore,
        lastAnalysisDate: new Date().toISOString() // Placeholder for future database storage
    };
}





// Unified Analyze Route
router.post('/analyze', async (req, res) => {
    const { githubUrl } = req.body;

    try {
        if (!githubUrl) throw new Error("GitHub URL is required.");
        const repoDetails = /github\.com\/([^\/]+)\/([^\/]+)/.exec(githubUrl);
        if (!repoDetails) throw new Error("Invalid GitHub URL.");

        const owner = repoDetails[1];
        const repo = repoDetails[2];

        // Fetch categorized files and languages
        const [categorizedFiles, repoLanguages] = await Promise.all([
            fetchRepoFiles({ owner, repo }),
            fetchRepoLanguages(owner, repo),
        ]);

        const metrics = await analyzeRepo(categorizedFiles);
        const analysis = await analyzeFiles(categorizedFiles, repoLanguages);
        const repoStatus = await analyzeRepositoryTypeAndStatus(metrics);

        metrics.securityScore = repoStatus.securityScore;


        console.log("Community Score:", metrics.communityScore);

        res.json({ success: true, metrics, report: analysis });
    } catch (error) {
        console.error("Error during analysis:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});



module.exports = router;
