const express = require('express');

const app = express();
const router = express.Router();

app.use((req, res, next) => next());
router.get('/items', (req, res) => res.json([]));
app.use('/api', router);
app.use((err, req, res, next) => res.status(500).end());
app.get('/', (req, res) => res.send('ok'));

module.exports = app;
