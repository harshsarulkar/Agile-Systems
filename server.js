const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
mongoose.connect('mongodb://127.0.0.1:27017/AgileProject')
    .then(() => console.log("[SYSTEM] Database connection established."))
    .catch(err => console.error("[ERROR] Database connection failed:", err.message));

// --- 1. DATABASE SCHEMAS ---
const User = mongoose.model('User', new mongoose.Schema({
    email: String,
    lastSeen: { type: Date, default: Date.now },
    role: { type: String, default: 'Operative' }
}, { strict: false }));

const TaskSchema = new mongoose.Schema({
    ticketId: { type: String, unique: true }, // NEW: Short ID for GitHub linking (e.g., OP-1)
    title: String,
    description: String,
    status: { type: String, default: 'To Do' },
    type: { type: String, default: 'Standard' },
    createdBy: String,
    storyPoints: { type: Number, default: 0 },
    priority: { type: String, default: 'Low' },
    deadline: Date,
    assignees: [String],
    blockedBy: { type: String, default: null }, // Cryptographic Task Dependency Locking
    comments: [{ user: String, text: String, timestamp: { type: Date, default: Date.now } }]
});
const Task = mongoose.model('Task', TaskSchema);

// Global Chat Schema with Task Referencing
const ChatMessage = mongoose.model('ChatMessage', new mongoose.Schema({
    channel: String,
    user: String,
    text: String,
    taskRef: { id: String, title: String, status: String, points: Number }, // Rich Embeds
    timestamp: { type: Date, default: Date.now }
}));

// --- 2. TEAM & HEARTBEAT ROUTES ---
app.post('/api/team/heartbeat', async (req, res) => {
    try {
        await User.findOneAndUpdate(
            { email: req.body.email },
            { $set: { lastSeen: new Date(), role: req.body.role || 'Operative' } },
            { upsert: true }
        );
        res.status(200).send();
    } catch (err) { res.status(500).send(); }
});

app.get('/api/team/all', async (req, res) => {
    try { res.json(await User.find({}, 'email lastSeen role')); } catch (err) { res.status(500).send(); }
});

// --- 3. TASK (KANBAN) ROUTES ---
app.post('/api/tasks/add', async (req, res) => {
    try {
        // NEW: Automatically generate a sequential ticket ID (e.g., OP-1, OP-2)
        const count = await Task.countDocuments();
        const newTicketId = `OP-${count + 1}`;

        const taskData = { ...req.body, ticketId: newTicketId };
        const task = new Task(taskData);
        await task.save();

        res.status(201).json(task);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/tasks/all', async (req, res) => {
    try { res.json(await Task.find()); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/tasks/update/:id', async (req, res) => {
    try { res.json(await Task.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true })); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/tasks/delete/:id', async (req, res) => {
    try { await Task.findByIdAndDelete(req.params.id); res.status(200).json({ message: "Deleted" }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/tasks/single/:id', async (req, res) => {
    try { res.json(await Task.findById(req.params.id)); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tasks/:id/chat', async (req, res) => {
    try {
        const task = await Task.findById(req.params.id);
        task.comments.push({ user: req.body.user, text: req.body.text });
        await task.save();
        res.json(task);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 4. GLOBAL CHAT ROUTES ---
app.get('/api/chat/:channel', async (req, res) => {
    try {
        res.json(await ChatMessage.find({ channel: req.params.channel }).sort({ timestamp: 1 }));
    }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/chat/:channel', async (req, res) => {
    try {
        const msg = new ChatMessage({
            channel: req.params.channel,
            user: req.body.user,
            text: req.body.text,
            taskRef: req.body.taskRef || null
        });
        await msg.save();
        res.status(201).json(msg);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 5. GITHUB WEBHOOK INTEGRATION (NEW) ---
app.post('/api/github/webhook', async (req, res) => {
    const event = req.headers['x-github-event'];
    const payload = req.body;

    // Acknowledge receipt to GitHub immediately
    res.status(200).send('Webhook received');

    // We only care about Pull Request events
    if (event === 'pull_request') {
        const action = payload.action;
        const isMerged = payload.pull_request.merged;
        const prTitle = payload.pull_request.title;

        // Trigger ONLY if the PR is successfully merged
        if (action === 'closed' && isMerged) {

            // Extract the Task ID from the PR title (looks for [OP-12])
            const match = prTitle.match(/\[(OP-\d+)\]/i);

            if (match) {
                const ticketId = match[1].toUpperCase();

                try {
                    // Advance the operation to "Done" in MongoDB
                    const updatedTask = await Task.findOneAndUpdate(
                        { ticketId: ticketId },
                        { $set: { status: 'Done' } },
                        { new: true }
                    );

                    if (updatedTask) {
                        console.log(`[SYSTEM] Code merged. Operation ${ticketId} advanced to Done.`);

                        // Broadcast the victory to the Global Comm-Link
                        const autoMsg = new ChatMessage({
                            channel: 'Team Global',
                            user: 'SYSTEM_AI',
                            text: `[AUTOMATION] Code merged for ${ticketId}: "${updatedTask.title}". Operation automatically advanced to Verified.`
                        });
                        await autoMsg.save();
                    }
                } catch (err) {
                    console.error("[ERROR] Webhook processing failed:", err);
                }
            }
        }
    }
});

// --- 6. FRONTEND HTML ROUTING ---
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/dashboard.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'dashboard.html')); });
app.get('/client-dashboard.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'client-dashboard.html')); });
app.get('/task-details.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'task-details.html')); });
app.get('/chat.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'chat.html')); });
app.get(/.*/, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(5000, () => {
    console.log("------------------------------------------------------------");
    console.log(" Node.js Command Center Online | Port 5000");
    console.log(" GitHub Automated Webhooks Enabled");
    console.log(" Access at: http://127.0.0.1:5000/");
    console.log("------------------------------------------------------------");
});