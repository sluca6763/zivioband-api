require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── SSE-Clients ────────────────────────────────────────────────────────────
const sseClients = new Set();

function pushEvent(eventName, data) {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        client.write(payload);
    }
}

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const ALARMS_FILE = path.join(__dirname, 'data', 'alarms.json');
const HEALTH_FILE = path.join(__dirname, 'data', 'health.json');

// ── Helpers ────────────────────────────────────────────────────────────────

function readAlarms() {
    if (!fs.existsSync(ALARMS_FILE)) fs.writeFileSync(ALARMS_FILE, '[]', 'utf-8');
    return JSON.parse(fs.readFileSync(ALARMS_FILE, 'utf-8'));
}

function writeAlarms(alarms) {
    fs.writeFileSync(ALARMS_FILE, JSON.stringify(alarms, null, 2), 'utf-8');
}

function readHealth() {
    if (!fs.existsSync(HEALTH_FILE)) {
        const empty = { heartrate: [], steps: [], sleep: [] };
        fs.writeFileSync(HEALTH_FILE, JSON.stringify(empty, null, 2), 'utf-8');
        return empty;
    }
    return JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf-8'));
}

function writeHealth(data) {
    fs.writeFileSync(HEALTH_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

async function sendWebhook(alarm) {
    if (!WEBHOOK_URL || WEBHOOK_URL === 'https://your-webhook-url.com/notify') {
        console.log('[Webhook] Kein Webhook konfiguriert – übersprungen.');
        return { skipped: true };
    }
    const response = await axios.post(WEBHOOK_URL, { event: 'sos_alarm', alarm }, {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' }
    });
    return { status: response.status };
}

// ── SOS-Routen ─────────────────────────────────────────────────────────────

app.post('/sos', async (req, res) => {
    const { userId, lat, lng, message } = req.body;

    if (!userId || lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'userId, lat und lng sind Pflichtfelder.' });
    }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
        return res.status(400).json({ error: 'lat und lng müssen Zahlen sein.' });
    }

    const alarm = {
        id: crypto.randomUUID(),
        userId,
        coordinates: { lat, lng },
        message: message || null,
        status: 'active',
        triggeredAt: new Date().toISOString()
    };

    const alarms = readAlarms();
    alarms.push(alarm);
    writeAlarms(alarms);

    console.log(`[SOS] Alarm — User: ${userId} | Koordinaten: ${lat}, ${lng}`);

    pushEvent('sos_alarm', alarm);

    let webhookResult;
    try {
        webhookResult = await sendWebhook(alarm);
    } catch (err) {
        webhookResult = { error: err.message };
    }

    res.status(201).json({ success: true, alarm, webhook: webhookResult });
});

app.get('/alarms', (req, res) => {
    const alarms = readAlarms();
    const { userId, status } = req.query;
    let result = alarms;
    if (userId) result = result.filter(a => a.userId === userId);
    if (status) result = result.filter(a => a.status === status);
    res.json({ count: result.length, alarms: result });
});

app.get('/alarms/:id', (req, res) => {
    const alarm = readAlarms().find(a => a.id === req.params.id);
    if (!alarm) return res.status(404).json({ error: 'Alarm nicht gefunden.' });
    res.json(alarm);
});

app.put('/alarms/:id/resolve', (req, res) => {
    const alarms = readAlarms();
    const index = alarms.findIndex(a => a.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Alarm nicht gefunden.' });
    alarms[index].status = 'resolved';
    alarms[index].resolvedAt = new Date().toISOString();
    writeAlarms(alarms);
    res.json({ success: true, alarm: alarms[index] });
});

app.delete('/alarms/:id', (req, res) => {
    const alarms = readAlarms();
    const index = alarms.findIndex(a => a.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Alarm nicht gefunden.' });
    const deleted = alarms.splice(index, 1)[0];
    writeAlarms(alarms);
    res.json({ success: true, deleted });
});

// ── Gesundheitsdaten-Routen ────────────────────────────────────────────────

// Band sendet Herzfrequenz: POST /health/heartrate
app.post('/health/heartrate', (req, res) => {
    const { userId, bpm } = req.body;
    if (!userId || bpm === undefined) {
        return res.status(400).json({ error: 'userId und bpm sind Pflichtfelder.' });
    }
    if (typeof bpm !== 'number' || bpm < 20 || bpm > 300) {
        return res.status(400).json({ error: 'bpm muss eine Zahl zwischen 20 und 300 sein.' });
    }

    const health = readHealth();
    const entry = { id: crypto.randomUUID(), userId, bpm, timestamp: new Date().toISOString() };
    health.heartrate.push(entry);
    writeHealth(health);

    console.log(`[Herzfrequenz] User: ${userId} | ${bpm} BPM`);
    res.status(201).json({ success: true, entry });
});

// Band sendet Schritte: POST /health/steps
app.post('/health/steps', (req, res) => {
    const { userId, steps, calories, distance } = req.body;
    if (!userId || steps === undefined) {
        return res.status(400).json({ error: 'userId und steps sind Pflichtfelder.' });
    }
    if (typeof steps !== 'number' || steps < 0) {
        return res.status(400).json({ error: 'steps muss eine positive Zahl sein.' });
    }

    const health = readHealth();
    const entry = {
        id: crypto.randomUUID(),
        userId,
        steps,
        calories: calories || null,
        distance: distance || null,
        date: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString()
    };
    health.steps.push(entry);
    writeHealth(health);

    console.log(`[Schritte] User: ${userId} | ${steps} Schritte`);
    res.status(201).json({ success: true, entry });
});

// Band sendet Schlafdaten: POST /health/sleep
app.post('/health/sleep', (req, res) => {
    const { userId, startTime, endTime, deepSleep, lightSleep, remSleep } = req.body;
    if (!userId || !startTime || !endTime) {
        return res.status(400).json({ error: 'userId, startTime und endTime sind Pflichtfelder.' });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationMinutes = Math.round((end - start) / 60000);

    const health = readHealth();
    const entry = {
        id: crypto.randomUUID(),
        userId,
        startTime,
        endTime,
        durationMinutes,
        deepSleep: deepSleep || null,
        lightSleep: lightSleep || null,
        remSleep: remSleep || null,
        timestamp: new Date().toISOString()
    };
    health.sleep.push(entry);
    writeHealth(health);

    console.log(`[Schlaf] User: ${userId} | ${Math.round(durationMinutes / 60 * 10) / 10}h`);
    res.status(201).json({ success: true, entry });
});

// Alle Gesundheitsdaten eines Users abrufen
app.get('/health/:userId', (req, res) => {
    const { userId } = req.params;
    const health = readHealth();
    const alarms = readAlarms();

    const userHeartrate = health.heartrate.filter(e => e.userId === userId);
    const userSteps = health.steps.filter(e => e.userId === userId);
    const userSleep = health.sleep.filter(e => e.userId === userId);
    const userAlarms = alarms.filter(a => a.userId === userId);

    const today = new Date().toISOString().split('T')[0];
    const todaySteps = userSteps.filter(e => e.date === today);
    const totalStepsToday = todaySteps.reduce((sum, e) => sum + e.steps, 0);

    const latestHeartrate = userHeartrate.length > 0
        ? userHeartrate[userHeartrate.length - 1]
        : null;
    const latestSleep = userSleep.length > 0
        ? userSleep[userSleep.length - 1]
        : null;

    res.json({
        userId,
        summary: {
            latestBpm: latestHeartrate ? latestHeartrate.bpm : null,
            stepsToday: totalStepsToday,
            lastSleepDuration: latestSleep ? latestSleep.durationMinutes : null,
            activeAlarms: userAlarms.filter(a => a.status === 'active').length
        },
        heartrate: userHeartrate.slice(-50),
        steps: userSteps.slice(-30),
        sleep: userSleep.slice(-14),
        alarms: userAlarms
    });
});

// ── SSE-Route ──────────────────────────────────────────────────────────────

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(`event: connected\ndata: {"status":"ok"}\n\n`);
    sseClients.add(res);

    req.on('close', () => sseClients.delete(res));
});

// ── Dashboard-Route ────────────────────────────────────────────────────────

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log('==========================================');
    console.log(`  Zivioband Health API läuft auf Port ${PORT}`);
    console.log('==========================================');
    console.log('  SOS-Endpunkte:');
    console.log(`  POST   /sos`);
    console.log(`  GET    /alarms`);
    console.log(`  PUT    /alarms/:id/resolve`);
    console.log(`  DELETE /alarms/:id`);
    console.log('  Gesundheits-Endpunkte:');
    console.log(`  POST   /health/heartrate`);
    console.log(`  POST   /health/steps`);
    console.log(`  POST   /health/sleep`);
    console.log(`  GET    /health/:userId`);
    console.log('  Dashboard:');
    console.log(`  GET    http://localhost:${PORT}/`);
    console.log('==========================================');
});
