const express = require('express');
require('dotenv').config();

const path = require('path');
const apiRoutes = require('./routes/api');

console.log("OPENAI_API_KEY:", process.env.OPENAI_API_KEY || "NOT LOADED");
console.log("GITHUB_TOKEN:", process.env.GITHUB_TOKEN || "NOT LOADED");
console.log("PORT:", process.env.PORT || "NOT LOADED");


const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api', apiRoutes);

// Main Page
app.get('/', (req, res) => {
    res.render('index');
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`GitScan running at http://localhost:${PORT}`);
});
