require('dotenv').config();
const fs = require('fs');
const path = require('path');

// --- Mode switch -------------------------------------------------------
// No DATABASE_URL set (e.g. running on your own PC with `npm start` and
// no .env changes)  -> read/write plain JSON files right in this folder,
//                      exactly like the very first version of this app.
//                      Zero setup required.
// DATABASE_URL set   -> use that Postgres database instead (Supabase,
//                      Render, Railway, etc). This is what keeps your
//                      data safe across redeploys once you're live.
const usePostgres = !!process.env.DATABASE_URL;

let pool = null;
if (usePostgres) {
  const { Pool } = require('pg');
  // Supabase (and most managed Postgres hosts) require SSL, and their
  // certificates aren't always in Node's default trust store, so we
  // disable strict verification here. This is standard practice for
  // connecting to Supabase from a Node backend.
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

// The 3 payment methods guests can pay with, editable by the admin from
// the console (account details + an optional QR code photo per method).
const initialPaymentSettings = {
  bank: {
    label: 'Bank Transfer',
    accountName: 'Juantero\'s Staycation',
    accountNumber: 'Set this up in the admin console',
    bankName: 'Bank Name',
    instructions: 'Transfer your total balance to the account above, then upload your proof of payment below.',
    qrImage: null
  },
  gcash: {
    label: 'GCash',
    accountName: 'Juantero\'s Staycation',
    accountNumber: 'Set this up in the admin console',
    bankName: '',
    instructions: 'Send your total balance via GCash to the number above, or scan the QR code, then upload your proof of payment below.',
    qrImage: null
  },
  maya: {
    label: 'Maya',
    accountName: 'Juantero\'s Staycation',
    accountNumber: 'Set this up in the admin console',
    bankName: '',
    instructions: 'Send your total balance via Maya to the number above, or scan the QR code, then upload your proof of payment below.',
    qrImage: null
  }
};

// The rate card shown on the public site and editable from the admin
// console: check-in/out times, per-pax price tiers, the excess-pax
// surcharge, and the pet fee.
const initialRates = {
  checkIn: '2:00 PM',
  checkOut: '12:00 PM',
  durationLabel: '22 hours',
  tiers: [
    { label: '1 - 2 pax', price: 2500 },
    { label: '3 - 4 pax', price: 3500 },
    { label: '5 - 6 pax', price: 4500 },
    { label: '7 - 8 pax', price: 5500 },
    { label: '9 - 10 pax', price: 6500 }
  ],
  excessPaxFee: 500,
  excessPaxLabel: 'In excess of 10 pax, add per head',
  petFee: 400,
  petFeeLabel: 'Pet Fee'
};

// Every non-room photo shown on the public site, keyed by where it's used.
// This is the full set of image slots admin.html lets you replace.
const initialSiteImages = {
  'logo':      { label: 'Site Logo (header & favicon)',                    image: 'images/logo.png' },
  'hero-bg':   { label: 'Hero Banner Background',                          image: 'images/hero-bg.jpg' },
  'gallery-1': { label: 'Gallery Photo 1',                                 image: 'images/gallery-1.jpg' },
  'gallery-2': { label: 'Gallery Photo 2 (also Facilities background)',    image: 'images/gallery-2.jpg' },
  'gallery-3': { label: 'Gallery Photo 3',                                 image: 'images/gallery-3.jpg' },
  'gallery-4': { label: 'Gallery Photo 4 (also About section photo)',      image: 'images/gallery-4.jpg' }
};

// Initial room specifications from your layout pictures
const initialRooms = [
  {
    id: "balai-ima",
    name: "Balai Ima",
    capacity: "6 - 10 pax",
    details: [
      "1 Toilet",
      "1 Bathroom",
      "Sala w/ TV",
      "1 room w/ attic",
      "1 master bedroom"
    ]
  },
  {
    id: "balai-hiraya",
    name: "Balai Hiraya",
    capacity: "10 - 15 pax",
    details: [
      "1 Family Room",
      "1 Barkada Room",
      "1 Toilet & Bath",
      "Airconditioned",
      "Smart Projector",
      "Smart TV"
    ]
  }
];

// Every "table" this app needs, its on-disk JSON filename (for local mode),
// and its default/seed value if that file doesn't exist yet.
const TABLES = {
  rooms:            { file: 'rooms.json',          default: initialRooms },
  bookings:         { file: 'bookings.json',        default: [] },
  closed_dates:     { file: 'closed-dates.json',    default: [] },
  site_images:      { file: 'site-images.json',      default: initialSiteImages },
  payment_settings: { file: 'payment-settings.json', default: initialPaymentSettings },
  rates:            { file: 'rates.json',             default: initialRates }
};

// ------------------------------------------------------------------
// Local JSON-file mode (no DATABASE_URL) - same behavior as the very
// first version of this app: each "table" is just a JSON file sitting
// in this folder, read fresh and overwritten on every save.
// ------------------------------------------------------------------
function jsonFilePath(key) {
  return path.join(__dirname, TABLES[key].file);
}

function readJsonTable(key) {
  const filePath = jsonFilePath(key);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.warn(`[db] Could not read ${TABLES[key].file}, using defaults instead:`, err.message);
  }
  return TABLES[key].default;
}

function writeJsonTable(key, value) {
  fs.writeFileSync(jsonFilePath(key), JSON.stringify(value, null, 2));
}

// ------------------------------------------------------------------
// Postgres mode (DATABASE_URL set) - everything lives in one small
// key/value table, each "file" becoming a row holding a JSONB blob.
// On first boot, seeds each row from the matching local JSON file if
// one exists (so real bookings/uploaded photos made in local mode
// aren't lost when you switch a deployment over to Postgres),
// falling back to the hardcoded defaults otherwise.
// ------------------------------------------------------------------
async function getValuePg(key) {
  const result = await pool.query('SELECT value FROM app_data WHERE key = $1', [key]);
  return result.rows.length ? result.rows[0].value : null;
}

async function saveValuePg(key, value) {
  await pool.query(
    `INSERT INTO app_data (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb`,
    [key, JSON.stringify(value)]
  );
}

let initialized = false;

async function init() {
  if (initialized) return;

  if (usePostgres) {
    console.log('[db] DATABASE_URL is set - using Postgres.');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_data (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL
      );
    `);

    for (const key of Object.keys(TABLES)) {
      const seedValue = readJsonTable(key); // existing local JSON file, or the default
      await pool.query(
        `INSERT INTO app_data (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO NOTHING`,
        [key, JSON.stringify(seedValue)]
      );
    }
  } else {
    console.log('[db] No DATABASE_URL set - running locally using JSON files in this folder.');
    console.log('[db] (Set DATABASE_URL in .env to use Postgres/Supabase instead, e.g. once deployed.)');

    // Make sure every JSON file exists on first run, so admin.html /
    // server.js always have something to read.
    for (const key of Object.keys(TABLES)) {
      if (!fs.existsSync(jsonFilePath(key))) {
        writeJsonTable(key, TABLES[key].default);
      }
    }
  }

  initialized = true;
}

async function getValue(key) {
  return usePostgres ? getValuePg(key) : readJsonTable(key);
}

async function saveValue(key, value) {
  return usePostgres ? saveValuePg(key, value) : writeJsonTable(key, value);
}

async function getRooms() {
  return getValue('rooms');
}

async function saveRooms(rooms) {
  return saveValue('rooms', rooms);
}

async function getBookings() {
  return getValue('bookings');
}

async function saveBookings(bookings) {
  return saveValue('bookings', bookings);
}

async function getClosedDates() {
  return getValue('closed_dates');
}

async function saveClosedDates(closedDates) {
  return saveValue('closed_dates', closedDates);
}

async function getSiteImages() {
  return getValue('site_images');
}

async function saveSiteImages(siteImages) {
  return saveValue('site_images', siteImages);
}

async function getPaymentSettings() {
  return getValue('payment_settings');
}

async function savePaymentSettings(paymentSettings) {
  return saveValue('payment_settings', paymentSettings);
}

async function getRates() {
  return getValue('rates');
}

async function saveRates(rates) {
  return saveValue('rates', rates);
}

module.exports = {
  init,
  getRooms,
  saveRooms,
  getBookings,
  saveBookings,
  getClosedDates,
  saveClosedDates,
  getSiteImages,
  saveSiteImages,
  getPaymentSettings,
  savePaymentSettings,
  getRates,
  saveRates
};
