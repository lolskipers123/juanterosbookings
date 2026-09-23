const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const session = require('express-session');
// Loads .env (DATABASE_URL / ADMIN_USERNAME / ADMIN_PASSWORD / SESSION_SECRET
// / GMAIL_* etc). Done first, before requiring ./db and ./notifier, since
// both read process.env values at module-load time to set up their
// connections/transporters.
require('dotenv').config();
const db = require('./db');
const {
  sendAdminBookingNotice,
  sendBookingStatusEmail,
  sendBookingPendingEmail,
  sendPaymentProofAdminNotice,
  sendPaymentReviewEmail
} = require('./notifier');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// --- Serverless-safe DB init gate ---
// On Vercel there's no long-lived process to await db.init() before the
// server starts listening (there IS no app.listen() - see bottom of file).
// So instead we kick off init once when this module loads, and every
// request waits on that same promise before hitting any route below.
// Locally this resolves almost instantly and is invisible.
const dbReady = db.init().catch(err => {
  console.error('[server] Failed to initialize database:', err.message);
  throw err;
});
app.use((req, res, next) => {
  dbReady.then(() => next()).catch(next);
});

// --- Admin session setup ---
// This is what makes the admin side (and only the admin side) a logged-in
// area: a signed, httpOnly session cookie that /api/admin/login sets and
// /api/admin/logout destroys. The public booking site never touches this.
app.use(session({
  name: 'juanteros.sid',
  secret: process.env.SESSION_SECRET || 'juanteros-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 4 // 4 hours, then the admin has to log in again
  }
}));

// Blocks an API request unless the caller has a valid admin session.
function requireAdminApi(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Not authenticated. Please log in as admin.' });
}

// Blocks the admin.html PAGE itself unless logged in - bounces to the
// login page instead. Registered before express.static below so it runs
// first for that one path.
function requireAdminPage(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/admin-login.html');
}
app.get('/admin.html', requireAdminPage, (req, res, next) => next());

app.use(express.static(path.join(__dirname, 'public')));

// --- Admin auth endpoints ---
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  const validUser = process.env.ADMIN_USERNAME;
  const validPass = process.env.ADMIN_PASSWORD;

  if (!validUser || !validPass) {
    return res.status(500).json({ error: 'Admin credentials are not configured on the server. Set ADMIN_USERNAME and ADMIN_PASSWORD in .env.' });
  }

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  if (username === validUser && password === validPass) {
    req.session.isAdmin = true;
    req.session.username = username;
    return res.json({ message: 'Logged in.' });
  }

  return res.status(401).json({ error: 'Invalid username or password.' });
});

// Logs the admin out by destroying the session (server-side) and clearing
// the session cookie (client-side). Only ends the ADMIN session - it has
// no effect on public visitors browsing the booking site.
app.post('/api/admin/logout', (req, res) => {
  if (!req.session) {
    return res.json({ message: 'Logged out.' });
  }
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to log out.' });
    }
    res.clearCookie('juanteros.sid');
    res.json({ message: 'Logged out.' });
  });
});

// Lets admin.js check on page load whether the session is still valid.
app.get('/api/admin/session', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// --- Room photo upload config ---
// Vercel's filesystem is read-only outside /tmp and nothing written there
// survives past the request, so uploads can't be saved to disk like they
// could on a normal VPS. Instead we keep the file in memory (memoryStorage)
// and store it as a base64 data: URI directly in the database row - same
// place bookings/rates/etc already live, so it works the same locally and
// on Vercel, and survives redeploys as long as DATABASE_URL is set.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error('Only .jpg, .jpeg, .png, or .webp images are allowed.'));
    }
    cb(null, true);
  }
});

// Turns a multer memoryStorage file into a data: URI string ready to store
// in the DB and drop straight into an <img src="..."> on the front end.
function fileToDataUri(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

// Helper: Check if date ranges overlap
function isOverlapping(startA, endA, startB, endB) {
  return new Date(startA) < new Date(endB) && new Date(endA) > new Date(startB);
}

// Balai Hiraya and Balai Ima are treated as sharing the same physical space,
// so a booking on one automatically closes the same dates on the other.
// Add more room ids to a group below if additional rooms should be linked.
const LINKED_ROOM_GROUPS = [
  ['balai-hiraya', 'balai-ima']
];

// Returns every room id that shares availability with the given room id,
// including the room itself (so callers can just do `.includes(roomId)`).
function getLinkedRoomIds(roomId) {
  const group = LINKED_ROOM_GROUPS.find(g => g.includes(roomId));
  return group ? group : [roomId];
}

// 1. Get Room Details
app.get('/api/rooms', async (req, res) => {
  try {
    res.json(await db.getRooms());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// 1a. Update a Room's Photo (Admin)
app.post('/api/rooms/:id/image', requireAdminApi, (req, res) => {
  upload.single('photo')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Failed to upload photo.' });
    }

    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No photo file was provided.' });
    }

    const rooms = await db.getRooms();
    const room = rooms.find(r => r.id === id);

    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    room.image = fileToDataUri(req.file);
    await db.saveRooms(rooms);

    res.json({ message: 'Room photo updated.', room });
  });
});

// 1a-2. Get/Update site-wide photos (logo, hero background, gallery) (Admin)
const uploadSiteImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error('Only .jpg, .jpeg, .png, or .webp images are allowed.'));
    }
    cb(null, true);
  }
});

// Proof-of-payment screenshots guests upload from the public payment page.
// Kept separate from the site's content images since these are per-booking
// uploads, not editable site assets.
const uploadPaymentProof = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error('Only .jpg, .jpeg, .png, or .webp images are allowed.'));
    }
    cb(null, true);
  }
});

app.get('/api/site-images', async (req, res) => {
  try {
    res.json(await db.getSiteImages());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch site images' });
  }
});

app.post('/api/site-images/:key/image', requireAdminApi, (req, res) => {
  uploadSiteImage.single('photo')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Failed to upload photo.' });
    }

    const { key } = req.params;
    const siteImages = await db.getSiteImages();

    if (!siteImages[key]) {
      return res.status(404).json({ error: 'Unknown site image slot.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No photo file was provided.' });
    }

    siteImages[key].image = fileToDataUri(req.file);
    await db.saveSiteImages(siteImages);

    res.json({ message: 'Site photo updated.', key, siteImage: siteImages[key] });
  });
});

// --- Payment Settings (Bank Transfer / GCash / Maya) ---
// Public: guests need this on the payment page to know where to send money.
app.get('/api/payment-settings', async (req, res) => {
  try {
    res.json(await db.getPaymentSettings());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment settings' });
  }
});

// Admin: edit the account name/number/bank name/instructions text for a method.
app.put('/api/payment-settings/:key', requireAdminApi, async (req, res) => {
  const { key } = req.params;
  const { accountName, accountNumber, bankName, instructions } = req.body || {};

  const paymentSettings = await db.getPaymentSettings();
  if (!paymentSettings[key]) {
    return res.status(404).json({ error: 'Unknown payment method.' });
  }

  if (accountName !== undefined) paymentSettings[key].accountName = accountName;
  if (accountNumber !== undefined) paymentSettings[key].accountNumber = accountNumber;
  if (bankName !== undefined) paymentSettings[key].bankName = bankName;
  if (instructions !== undefined) paymentSettings[key].instructions = instructions;

  await db.savePaymentSettings(paymentSettings);
  res.json({ message: 'Payment settings updated.', key, paymentSettings: paymentSettings[key] });
});

// Admin: upload/replace the QR code photo for a payment method.
app.post('/api/payment-settings/:key/image', requireAdminApi, (req, res) => {
  uploadSiteImage.single('photo')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Failed to upload photo.' });
    }

    const { key } = req.params;
    const paymentSettings = await db.getPaymentSettings();

    if (!paymentSettings[key]) {
      return res.status(404).json({ error: 'Unknown payment method.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No photo file was provided.' });
    }

    paymentSettings[key].qrImage = fileToDataUri(req.file);
    await db.savePaymentSettings(paymentSettings);

    res.json({ message: 'QR code updated.', key, paymentSettings: paymentSettings[key] });
  });
});

// --- Rates / Pricing (check-in/out, per-pax tiers, excess-pax & pet fee) ---
// Public: guests see this on the site to know what a stay costs.
app.get('/api/rates', async (req, res) => {
  try {
    res.json(await db.getRates());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch rates' });
  }
});

// Admin: replace the whole rate card in one go (check-in/out times, the
// full tier list, excess-pax fee/label, pet fee/label). The admin console
// always sends the complete object back, so we just validate shape and save.
app.put('/api/rates', requireAdminApi, async (req, res) => {
  const { checkIn, checkOut, durationLabel, tiers, excessPaxFee, excessPaxLabel, petFee, petFeeLabel } = req.body || {};

  if (!Array.isArray(tiers) || tiers.some(t => typeof t.label !== 'string' || isNaN(Number(t.price)))) {
    return res.status(400).json({ error: 'Tiers must be a list of { label, price } entries.' });
  }

  const rates = {
    checkIn: checkIn || '',
    checkOut: checkOut || '',
    durationLabel: durationLabel || '',
    tiers: tiers.map(t => ({ label: t.label, price: Number(t.price) })),
    excessPaxFee: Number(excessPaxFee) || 0,
    excessPaxLabel: excessPaxLabel || '',
    petFee: Number(petFee) || 0,
    petFeeLabel: petFeeLabel || ''
  };

  await db.saveRates(rates);
  res.json({ message: 'Rates updated.', rates });
});

// 1e. Get all blocked date ranges for a room (bookings + admin closed dates)
// so the public calendar can grey out unavailable nights before a guest submits.
app.get('/api/rooms/:id/blocked-dates', async (req, res) => {
  const { id } = req.params;
  const rooms = await db.getRooms();

  if (!rooms.find(r => r.id === id)) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  const bookings = await db.getBookings();
  const closedDates = await db.getClosedDates();
  const linkedRoomIds = getLinkedRoomIds(id);

  // A Pending request already holds the dates so a second guest can't also
  // request them - only a Cancelled booking frees the dates back up.
  // Also includes bookings on any linked room (e.g. Balai Hiraya / Balai
  // Ima share the same space), so booking one closes the other's calendar.
  const bookingRanges = bookings
    .filter(b => linkedRoomIds.includes(b.roomId) && (b.status === 'Pending' || b.status === 'Approved'))
    .map(b => ({ startDate: b.checkIn, endDate: b.checkOut, reason: 'booked', status: b.status }));

  const closedRanges = closedDates
    .filter(c => linkedRoomIds.includes(c.roomId) || c.roomId === 'all')
    .map(c => ({ startDate: c.startDate, endDate: c.endDate, reason: c.reason || 'closed', status: 'closed' }));

  res.json([...bookingRanges, ...closedRanges]);
});

// 1b. Get Closed Dates (blackout dates set by admin)
app.get('/api/closed-dates', requireAdminApi, async (req, res) => {
  try {
    res.json(await db.getClosedDates());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch closed dates' });
  }
});

// 1c. Add a Closed Date Range (Admin)
app.post('/api/closed-dates', requireAdminApi, async (req, res) => {
  const { roomId, startDate, endDate, reason } = req.body;

  if (!roomId || !startDate || !endDate) {
    return res.status(400).json({ error: 'roomId, startDate, and endDate are required.' });
  }

  if (new Date(startDate) >= new Date(endDate)) {
    return res.status(400).json({ error: 'End date must be after start date.' });
  }

  if (roomId !== 'all') {
    const rooms = await db.getRooms();
    if (!rooms.find(r => r.id === roomId)) {
      return res.status(404).json({ error: 'Room not found.' });
    }
  }

  const closedDates = await db.getClosedDates();
  const newClosedDate = {
    id: '_' + Math.random().toString(36).substr(2, 9),
    roomId, // 'all' applies to every room
    startDate,
    endDate,
    reason: reason || '',
    createdAt: new Date().toISOString()
  };

  closedDates.push(newClosedDate);
  await db.saveClosedDates(closedDates);

  res.status(201).json({ message: 'Closed dates added.', closedDate: newClosedDate });
});

// 1d. Remove a Closed Date Range (Admin)
app.delete('/api/closed-dates/:id', requireAdminApi, async (req, res) => {
  const { id } = req.params;
  let closedDates = await db.getClosedDates();
  const startingLength = closedDates.length;

  closedDates = closedDates.filter(c => c.id !== id);

  if (closedDates.length === startingLength) {
    return res.status(404).json({ error: 'Closed date entry not found.' });
  }

  await db.saveClosedDates(closedDates);
  res.json({ message: 'Closed dates removed.' });
});


app.get('/api/bookings', requireAdminApi, async (req, res) => {
  try {
    res.json(await db.getBookings());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// 3. Submit a New Booking Request (Customer)
app.post('/api/bookings', async (req, res) => {
  const { name, email, phone, roomId, checkIn, checkOut, guests } = req.body;

  if (!name || !email || !phone || !roomId || !checkIn || !checkOut || !guests) {
    return res.status(400).json({ error: 'Please fill out all fields.' });
  }

  if (new Date(checkIn) >= new Date(checkOut)) {
    return res.status(400).json({ error: 'Check-out date must be after check-in date.' });
  }

  const bookings = await db.getBookings();
  const rooms = await db.getRooms();
  const selectedRoom = rooms.find(r => r.id === roomId);

  if (!selectedRoom) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  const linkedRoomIds = getLinkedRoomIds(roomId);

  // Prevent booking over a date range the admin has closed off
  const closedDates = await db.getClosedDates();
  const hasClosedDateConflict = closedDates.some(closed => {
    return (
      (linkedRoomIds.includes(closed.roomId) || closed.roomId === 'all') &&
      isOverlapping(checkIn, checkOut, closed.startDate, closed.endDate)
    );
  });

  if (hasClosedDateConflict) {
    return res.status(400).json({ error: 'Sorry, this room is unavailable for the selected dates.' });
  }

  // Prevent booking over an existing stay that already holds these dates.
  // A Pending request blocks the dates just like an Approved one does -
  // once a guest reserves a date range, no one else can request it until
  // it's Cancelled. Also blocks against bookings on any linked room (e.g.
  // Balai Hiraya / Balai Ima share the same physical space).
  const hasOverlap = bookings.some(booking => {
    return (
      linkedRoomIds.includes(booking.roomId) &&
      (booking.status === 'Approved' || booking.status === 'Pending') &&
      isOverlapping(checkIn, checkOut, booking.checkIn, booking.checkOut)
    );
  });

  if (hasOverlap) {
    return res.status(400).json({ error: 'Sorry, this room is already booked for these dates.' });
  }

  const newBooking = {
    id: '_' + Math.random().toString(36).substr(2, 9),
    name,
    email,
    phone,
    roomId,
    roomName: selectedRoom.name,
    checkIn,
    checkOut,
    guests,
    status: 'Pending',
    paymentStatus: 'Awaiting Payment',
    paymentMethod: null,
    paymentReference: null,
    paymentProofImage: null,
    paymentSubmittedAt: null,
    paymentReviewedAt: null,
    createdAt: new Date().toISOString()
  };

  bookings.push(newBooking);
  await db.saveBookings(bookings);

  // Fire off the admin notification as a styled HTML status card (Pending
  // badge, full details, link into the admin dashboard) instead of a plain
  // text message. We don't let a notification failure break the booking
  // itself - the reservation is already saved.
  const adminUrl = `${req.protocol}://${req.get('host')}/admin.html`;
  sendAdminBookingNotice(newBooking, adminUrl).catch(err =>
    console.error('[notifier] Unexpected error sending admin notice:', err)
  );

  // Email the guest that their request is Pending, with a link to the
  // public payment page where they can pay via Bank Transfer / GCash /
  // Maya and upload their proof of payment.
  const paymentUrl = `${req.protocol}://${req.get('host')}/pay.html?bookingId=${newBooking.id}`;
  sendBookingPendingEmail(newBooking, paymentUrl).catch(err =>
    console.error('[notifier] Unexpected error sending pending email:', err)
  );

  res.status(201).json({ message: 'Booking request sent successfully!', booking: newBooking, paymentUrl });
});

// 3a. Get one booking's public details (no admin login required) - powers
// the public payment page. The booking's own random id acts as the access
// token, since it's only ever shared with the guest via their email link.
// Only the fields a guest needs to see are returned - never the full
// admin bookings list.
app.get('/api/bookings/:id/public', async (req, res) => {
  const { id } = req.params;
  const bookings = await db.getBookings();
  const booking = bookings.find(b => b.id === id);

  if (!booking) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  res.json({
    id: booking.id,
    name: booking.name,
    roomName: booking.roomName,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    guests: booking.guests,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    paymentMethod: booking.paymentMethod,
    paymentReference: booking.paymentReference,
    paymentProofImage: booking.paymentProofImage
  });
});

// 3b. Submit Proof of Payment (Guest, no login required - reached via the
// booking's payment link). Saves the screenshot + reference number and
// flips paymentStatus to "Submitted" so the admin can verify or reject it.
app.post('/api/bookings/:id/payment-proof', (req, res) => {
  uploadPaymentProof.single('proofImage')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Failed to upload proof of payment.' });
    }

    const { id } = req.params;
    const { method, reference } = req.body || {};

    if (!method || !['bank', 'gcash', 'maya'].includes(method)) {
      return res.status(400).json({ error: 'Please select a valid payment method.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Please attach a screenshot of your payment.' });
    }

    const bookings = await db.getBookings();
    const index = bookings.findIndex(b => b.id === id);

    if (index === -1) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    if (bookings[index].status === 'Cancelled') {
      return res.status(400).json({ error: 'This booking was cancelled, so payment can no longer be submitted.' });
    }

    bookings[index].paymentMethod = method;
    bookings[index].paymentReference = reference || '';
    bookings[index].paymentProofImage = fileToDataUri(req.file);
    bookings[index].paymentStatus = 'Submitted';
    bookings[index].paymentSubmittedAt = new Date().toISOString();
    await db.saveBookings(bookings);

    // Let the admin know a proof of payment is waiting to be reviewed.
    sendPaymentProofAdminNotice(bookings[index]).catch(err =>
      console.error('[notifier] Unexpected error sending payment proof admin notice:', err)
    );

    res.json({ message: 'Proof of payment submitted! We\'ll review it shortly.', booking: bookings[index] });
  });
});

// 3c. Verify or Reject a submitted Proof of Payment (Admin)
app.put('/api/bookings/:id/payment-status', requireAdminApi, async (req, res) => {
  const { id } = req.params;
  const { paymentStatus } = req.body || {};

  if (!['Verified', 'Rejected'].includes(paymentStatus)) {
    return res.status(400).json({ error: 'Invalid payment status update.' });
  }

  const bookings = await db.getBookings();
  const index = bookings.findIndex(b => b.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  bookings[index].paymentStatus = paymentStatus;
  bookings[index].paymentReviewedAt = new Date().toISOString();
  await db.saveBookings(bookings);

  const paymentUrl = `${req.protocol}://${req.get('host')}/pay.html?bookingId=${bookings[index].id}`;
  sendPaymentReviewEmail(bookings[index], paymentStatus, paymentUrl).catch(err =>
    console.error('[notifier] Unexpected error sending payment review email:', err)
  );

  res.json({ message: `Payment marked as ${paymentStatus}`, booking: bookings[index] });
});

// 4. Update Status (Approved / Cancelled / Completed)
app.put('/api/bookings/:id', requireAdminApi, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['Pending', 'Approved', 'Cancelled', 'Completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status update.' });
  }

  const bookings = await db.getBookings();
  const index = bookings.findIndex(b => b.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  if (status === 'Approved') {
    const target = bookings[index];
    const linkedRoomIds = getLinkedRoomIds(target.roomId);

    const closedDates = await db.getClosedDates();
    const closedConflict = closedDates.some(closed => {
      return (
        (linkedRoomIds.includes(closed.roomId) || closed.roomId === 'all') &&
        isOverlapping(target.checkIn, target.checkOut, closed.startDate, closed.endDate)
      );
    });

    if (closedConflict) {
      return res.status(400).json({ error: 'Conflict detected: These dates have been closed off by the admin.' });
    }

    // Also checks any linked room (e.g. Balai Hiraya / Balai Ima share the
    // same physical space) so an approval can't clash with a stay held there.
    const hasOverlap = bookings.some(booking => {
      return (
        booking.id !== target.id &&
        linkedRoomIds.includes(booking.roomId) &&
        booking.status === 'Approved' &&
        isOverlapping(target.checkIn, target.checkOut, booking.checkIn, booking.checkOut)
      );
    });

    if (hasOverlap) {
      return res.status(400).json({ error: 'Conflict detected: Another approved booking overlaps with these dates.' });
    }
  }

  bookings[index].status = status;
  await db.saveBookings(bookings);

  // Email the GUEST (the address they typed into the booking form) that
  // their request was accepted or denied. Approved bookings get a QR
  // code they can show at check-in. We don't let an email failure break
  // the status update itself - it's already saved either way.
  if (status === 'Approved' || status === 'Cancelled') {
    sendBookingStatusEmail(bookings[index], status).catch(err =>
      console.error('[server] Unexpected error sending guest status email:', err)
    );
  }

  res.json({ message: `Status updated to ${status}`, booking: bookings[index] });
});

// 5. Delete a Booking Record
app.delete('/api/bookings/:id', requireAdminApi, async (req, res) => {
  const { id } = req.params;
  let bookings = await db.getBookings();
  const startingLength = bookings.length;

  bookings = bookings.filter(b => b.id !== id);

  if (bookings.length === startingLength) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  await db.saveBookings(bookings);
  res.json({ message: 'Booking cleared from records.' });
});

// Only actually bind to a port when this file is run directly
// (`node server.js` / `npm start`, e.g. on your own PC or a normal VPS).
// On Vercel this file is required as a module by their Node runtime, which
// calls the exported `app` itself for each request - there is no long-lived
// process and nothing should call app.listen().
if (require.main === module) {
  dbReady
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Server running at: http://localhost:${PORT}`);
        console.log(`Admin Dashboard: http://localhost:${PORT}/admin.html`);
      });
    })
    .catch((err) => {
      console.error('[server] Check that DATABASE_URL is set correctly in your .env file.');
      process.exit(1);
    });
}

module.exports = app;