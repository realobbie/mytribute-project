const express = require('express');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const multer = require('multer');
const session = require('express-session');

const app = express();
const upload = multer({ dest: 'public/uploads/' });

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'memorial-secret-key',
    resave: false,
    saveUninitialized: false
}));

let db;

(async () => {
    db = await open({
        filename: 'tributes.db',
        driver: sqlite3.Database
    });

    // Combined Table Initialization
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, isAdmin INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS tributes (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, bio TEXT, photo TEXT, funeralHome TEXT);
        CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, tributeId INTEGER, author TEXT, content TEXT, likes INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY AUTOINCREMENT, heroTitle TEXT, heroText TEXT, heroImageUrl TEXT);
    `);

    const settingsCheck = await db.get("SELECT COUNT(*) as count FROM settings");
    if (settingsCheck.count === 0) {
        await db.run(`INSERT INTO settings (heroTitle, heroText, heroImageUrl) VALUES ('In Loving Memory', 'Honoring those who remain in our hearts.', 'https://images.unsplash.com/photo-1506744038136-46273834b3fb')`);
    }
})();

// Middleware to protect admin routes
const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.isAdmin === 1) next();
    else res.redirect('/login');
};

// --- ROUTES ---

// 1. Home
app.get('/', async (req, res) => {
    const search = req.query.name || '';
    const siteSettings = await db.get("SELECT * FROM settings WHERE id = 1") || {};
    const tributes = search 
        ? await db.all("SELECT * FROM tributes WHERE firstName LIKE ? OR lastName LIKE ?", [`%${search}%`, `%${search}%`])
        : await db.all("SELECT * FROM tributes ORDER BY id DESC");
    res.render('index', { tributes, siteSettings, searchQuery: search, userLoggedIn: !!req.session.user });
});

// 2. Auth
app.post('/register', async (req, res) => {
    const { username, password, confirm_password } = req.body;

    // 1. Image Update Check: Ensure passwords match
    if (password !== confirm_password) {
        return res.send("Passwords do not match. <a href='/register'>Try again</a>");
    }

    try {
        // 2. Insert user (Using 0 for isAdmin by default)
        await db.run(
            "INSERT INTO users (username, password, isAdmin) VALUES (?, ?, 0)", 
            [username, password]
        );
        res.redirect('/login');
    } catch (err) {
        // Handle unique constraint if username exists
        res.send("Username already taken. <a href='/register'>Try again</a>");
    }
});

app.get('/register', (req, res) => res.render('register', { userLoggedIn: false }));
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
   try {
        await db.run("INSERT INTO users (username, password, isAdmin) VALUES (?, ?, 0)", [username, password]);
        res.redirect('/login');
    } catch (e) { res.send("User already exists or DB error. <a href='/register'>Try again</a>"); }
});

app.get('/login', (req, res) => res.render('login', { userLoggedIn: false }));
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password]);
    if (user) {
        req.session.user = user;
        res.redirect(user.isAdmin ? '/admin' : '/');
    } else res.send("Invalid credentials. <a href='/login'>Back</a>");
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// 3. Admin & Hero
app.get('/admin', checkAdmin, async (req, res) => {
    const tributes = await db.all("SELECT * FROM tributes");
    const siteSettings = await db.get("SELECT * FROM settings WHERE id = 1");
    res.render('admin', { tributes, siteSettings, userLoggedIn: true });
});

app.post('/admin/settings', checkAdmin, upload.single('heroImage'), async (req, res) => {
    const { heroTitle, heroText } = req.body;
    const current = await db.get("SELECT heroImageUrl FROM settings WHERE id = 1");
    const img = req.file ? `/uploads/${req.file.filename}` : current.heroImageUrl;
    await db.run("UPDATE settings SET heroTitle=?, heroText=?, heroImageUrl=? WHERE id=1", [heroTitle, heroText, img]);
    res.redirect('/admin');
});

// 4. Tribute Management
app.get('/create', (req, res) => res.render('create', { userLoggedIn: !!req.session.user }));
app.post('/create', upload.single('photo'), async (req, res) => {
    const { firstName, lastName, bio, funeralHome } = req.body;
    const photo = req.file ? `/uploads/${req.file.filename}` : 'https://via.placeholder.com/150';
    await db.run("INSERT INTO tributes (firstName, lastName, bio, photo, funeralHome) VALUES (?, ?, ?, ?, ?)", [firstName, lastName, bio, photo, funeralHome]);
    res.redirect('/');
});

app.get('/tribute/:id', async (req, res) => {
    const tribute = await db.get("SELECT * FROM tributes WHERE id = ?", [req.params.id]);
    const messages = await db.all("SELECT * FROM messages WHERE tributeId = ?", [req.params.id]);
    res.render('tribute', { tribute, messages, userLoggedIn: !!req.session.user });
});

// 5. Messages & Likes
app.post('/tribute/:id/message', async (req, res) => {
    await db.run("INSERT INTO messages (tributeId, author, content) VALUES (?, ?, ?)", [req.params.id, req.body.author, req.body.content]);
    res.redirect(`/tribute/${req.params.id}`);
});

app.post('/message/:id/like', async (req, res) => {
    const msg = await db.get("SELECT tributeId FROM messages WHERE id = ?", [req.params.id]);
    await db.run("UPDATE messages SET likes = likes + 1 WHERE id = ?", [req.params.id]);
    res.redirect(`/tribute/${msg.tributeId}`);
});

// 6. Delete (Admin Only)
app.post('/tribute/:id/delete', checkAdmin, async (req, res) => {
    await db.run("DELETE FROM tributes WHERE id = ?", [req.params.id]);
    await db.run("DELETE FROM messages WHERE tributeId = ?", [req.params.id]);
    res.redirect('/admin');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
