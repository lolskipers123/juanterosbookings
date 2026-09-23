require('dotenv').config();
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

// Nighttime property photo used as a dimmed background behind the booking
// confirmation/update email. Embedded as base64 (like the QR code below)
// so it always renders regardless of where the site ends up being hosted.
const EMAIL_BG_PATH = path.join(__dirname, 'public', 'images', 'email-bg.jpg');
let EMAIL_BG_DATA_URL = null;
try {
  const bgBuffer = fs.readFileSync(EMAIL_BG_PATH);
  EMAIL_BG_DATA_URL = `data:image/jpeg;base64,${bgBuffer.toString('base64')}`;
} catch (err) {
  console.warn('[notifier] Could not load email background photo:', err.message);
}

// --- Config (fill these into your .env file, never commit real values) ---
const {
  GMAIL_USER,          // e.g. lolskipers1@gmail.com (sends the email)
  GMAIL_APP_PASSWORD,  // 16-char Gmail App Password (NOT your normal password)
  ADMIN_EMAIL          // where the notification should land, e.g. lolskipers1@gmail.com
} = process.env;

let transporter = null;

function getTransporter() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD
      }
    });
  }
  return transporter;
}

/**
 * Sends a notification email to the admin.
 */
async function sendAdminSms(message, subject) {
  const t = getTransporter();

  if (!t) {
    console.warn('[notifier] Skipping email: GMAIL_USER / GMAIL_APP_PASSWORD not set in .env');
    return { sent: false, reason: 'missing_email_credentials' };
  }

  const to = ADMIN_EMAIL || GMAIL_USER;

  try {
    await t.sendMail({
      from: GMAIL_USER,
      to,
      subject: subject || 'New Reservation Request - Juantero\'s Staycation',
      text: message
    });
    return { sent: true };
  } catch (err) {
    console.error('[notifier] Failed to send email notification:', err.message);
    return { sent: false, reason: 'send_error', error: err.message };
  }
}

// Dark overlay layered on top of the photo (via a stacked gradient) so it
// reads as "dimmed" rather than a bright distracting backdrop, with a
// plain dark-navy fallback for email clients that ignore background
// images entirely (older Outlook desktop) or if the photo failed to load
// above. Shared by every HTML email template so the branding/background
// stays consistent across guest and admin emails alike.
function emailBgStyle() {
  return EMAIL_BG_DATA_URL
    ? `background-color:#04091e;background-image:linear-gradient(rgba(4,9,30,0.35),rgba(4,9,30,0.35)),url('${EMAIL_BG_DATA_URL}');background-size:cover;background-position:center;`
    : `background-color:#04091e;`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Shared row for the booking-details table in the email
function detailRow(label, value) {
  return `
    <tr>
      <td style="padding:8px 0;color:#6b7280;font-size:14px;width:140px;">${label}</td>
      <td style="padding:8px 0;color:#222222;font-size:14px;font-weight:600;">${value}</td>
    </tr>`;
}

// Builds the full HTML email body. `qrDataUrl` is only passed in for
// Approved bookings - it's a data:image/png;base64 QR code the guest can
// show or scan at check-in. `paymentUrl` is only passed in for Pending
// bookings - it links to the public payment page for this booking.
function buildBookingEmailHtml(booking, status, qrDataUrl, paymentUrl) {
  const isApproved = status === 'Approved';
  const isPending = status === 'Pending';
  const bannerColor = isApproved ? '#1e7e34' : (isPending ? '#916b00' : '#b02a2a');
  const bannerBg = isApproved ? '#eaf7ea' : (isPending ? '#fff5da' : '#fdeaea');
  const headline = isApproved
    ? 'Your Booking is Confirmed!'
    : (isPending ? 'Booking Request Received' : 'Update on Your Booking Request');
  const introText = isApproved
    ? 'Good news! Your reservation has been approved. Here are your stay details:'
    : (isPending
      ? 'Thanks for booking with us! Your request is now pending approval. Here\'s what you sent us:'
      : 'We\'re sorry - we\'re unable to accommodate this reservation request. Here are the details of the request:');

  const detailsRows = [
    detailRow('Booking ID', booking.id),
    detailRow('Guest Name', booking.name),
    detailRow('Balai', booking.roomName),
    detailRow('Check-in', formatDate(booking.checkIn)),
    detailRow('Check-out', formatDate(booking.checkOut)),
    detailRow('Guests', booking.guests)
  ].join('');

  const qrSection = isApproved && qrDataUrl ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:28px 0 8px;text-align:center;">
          <p style="margin:0 0 14px;color:#222222;font-size:14px;font-weight:600;">
            Show this QR code when you arrive
          </p>
          <img src="${qrDataUrl}" alt="Booking confirmation QR code" width="180" height="180"
               style="display:inline-block;border:8px solid #ffffff;box-shadow:0 2px 10px rgba(0,0,0,0.12);border-radius:8px;">
        </td>
      </tr>
    </table>` : '';

  // Pending bookings get a "Pay Now" button linking to the public payment
  // page for this booking, where the guest picks Bank Transfer / GCash /
  // Maya, sees the account details or QR code, and uploads their proof
  // of payment for the admin to verify.
  const paymentSection = isPending && paymentUrl ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:26px 0 8px;text-align:center;">
          <p style="margin:0 0 16px;color:#444444;font-size:14px;line-height:1.6;">
            To secure your dates, please settle payment and upload your proof of payment.
          </p>
          <a href="${paymentUrl}"
             style="display:inline-block;background:#f3c300;color:#222222;font-weight:700;font-size:14px;
                    padding:14px 30px;border-radius:8px;text-decoration:none;">
            Proceed to Payment
          </a>
        </td>
      </tr>
    </table>` : '';

  return `
  <!DOCTYPE html>
  <html>
  <body style="margin:0;padding:0;background:#04091e;font-family:'Poppins',Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${emailBgStyle()}padding:10px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:0;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">

            <!-- Header -->
            <tr>
              <td style="background:#222222;padding:24px 28px;text-align:center;">
                <p style="margin:0;color:#f3c300;font-family:Georgia,'Playfair Display',serif;font-size:22px;font-weight:700;">
                  Juantero's Staycation
                </p>
              </td>
            </tr>

            <!-- Status banner -->
            <tr>
              <td style="background:${bannerBg};padding:16px 28px;text-align:center;">
                <p style="margin:0;color:${bannerColor};font-size:16px;font-weight:700;">
                  ${headline}
                </p>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 20px;color:#444444;font-size:14px;line-height:1.6;">
                  Hi ${booking.name}, ${introText}
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
                  ${detailsRows}
                </table>
                ${qrSection}
                ${paymentSection}
                ${isApproved ? `
                <p style="margin:22px 0 0;color:#6b7280;font-size:13px;line-height:1.6;text-align:center;">
                  We're looking forward to hosting you. If anything about your stay needs to change, just reply to this email.
                </p>` : (isPending ? `
                <p style="margin:22px 0 0;color:#6b7280;font-size:13px;line-height:1.6;text-align:center;">
                  We'll review your payment and confirm your booking as soon as possible. If anything needs to change, just reply to this email.
                </p>` : `
                <p style="margin:22px 0 0;color:#6b7280;font-size:13px;line-height:1.6;text-align:center;">
                  Feel free to reach out or submit a new request for different dates - we'd still love to host you.
                </p>`)}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:18px 28px;background:#f7f7f9;text-align:center;">
                <p style="margin:0;color:#9ca3af;font-size:12px;">
                  Juantero's Staycation &bull; This is an automated message.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>`;
}

// Builds the HTML for the admin "new booking request" notice - a compact
// status card (same branding as the guest emails) showing who booked,
// what, and when, plus a button straight into the admin dashboard.
function buildAdminBookingNoticeHtml(booking, adminUrl) {
  const detailsRows = [
    detailRow('Booking ID', booking.id),
    detailRow('Guest Name', booking.name),
    detailRow('Email', booking.email),
    detailRow('Phone', booking.phone),
    detailRow('Balai', booking.roomName),
    detailRow('Check-in', formatDate(booking.checkIn)),
    detailRow('Check-out', formatDate(booking.checkOut)),
    detailRow('Guests', booking.guests)
  ].join('');

  return `
  <!DOCTYPE html>
  <html>
  <body style="margin:0;padding:0;background:#04091e;font-family:'Poppins',Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${emailBgStyle()}padding:10px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:0;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">

            <!-- Header -->
            <tr>
              <td style="background:#222222;padding:24px 28px;text-align:center;">
                <p style="margin:0;color:#f3c300;font-family:Georgia,'Playfair Display',serif;font-size:22px;font-weight:700;">
                  Juantero's Staycation
                </p>
              </td>
            </tr>

            <!-- Status banner -->
            <tr>
              <td style="background:#fff5da;padding:16px 28px;text-align:center;">
                <p style="margin:0;color:#916b00;font-size:16px;font-weight:700;">
                  New Booking Request
                </p>
                <p style="margin:6px 0 0;">
                  <span style="display:inline-block;background:#916b00;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;padding:4px 12px;border-radius:999px;">
                    Pending
                  </span>
                </p>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 20px;color:#444444;font-size:14px;line-height:1.6;">
                  A new reservation request just came in. Review the details below and approve or decline it from your admin dashboard.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
                  ${detailsRows}
                </table>
                ${adminUrl ? `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:26px 0 8px;text-align:center;">
                      <a href="${adminUrl}"
                         style="display:inline-block;background:#f3c300;color:#222222;font-weight:700;font-size:14px;
                                padding:14px 30px;border-radius:8px;text-decoration:none;">
                        View in Admin Dashboard
                      </a>
                    </td>
                  </tr>
                </table>` : ''}
                <p style="margin:22px 0 0;color:#6b7280;font-size:13px;line-height:1.6;text-align:center;">
                  This request holds the dates until it's approved or declined.
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:18px 28px;background:#f7f7f9;text-align:center;">
                <p style="margin:0;color:#9ca3af;font-size:12px;">
                  Juantero's Staycation &bull; This is an automated message.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>`;
}

/**
 * Emails the ADMIN when a new booking request comes in, with a styled
 * status card (Pending badge, full details, link to the admin dashboard)
 * instead of a plain text message.
 */
async function sendAdminBookingNotice(booking, adminUrl) {
  const t = getTransporter();

  if (!t) {
    console.warn('[notifier] Skipping admin email: GMAIL_USER / GMAIL_APP_PASSWORD not set in .env');
    return { sent: false, reason: 'missing_email_credentials' };
  }

  const to = ADMIN_EMAIL || GMAIL_USER;

  try {
    await t.sendMail({
      from: `"Juantero's Staycation" <${GMAIL_USER}>`,
      to,
      subject: `New Reservation Request - ${booking.roomName} - Juantero's Staycation`,
      html: buildAdminBookingNoticeHtml(booking, adminUrl)
    });
    return { sent: true };
  } catch (err) {
    console.error('[notifier] Failed to send admin booking notice:', err.message);
    return { sent: false, reason: 'send_error', error: err.message };
  }
}

/**
 * Emails the GUEST (booking.email) right after they submit a new booking
 * request - confirms it's Pending and gives them a link to the public
 * payment page (Bank Transfer / GCash / Maya + proof-of-payment upload).
 */
async function sendBookingPendingEmail(booking, paymentUrl) {
  const t = getTransporter();

  if (!t) {
    console.warn('[notifier] Skipping guest email: GMAIL_USER / GMAIL_APP_PASSWORD not set in .env');
    return { sent: false, reason: 'missing_email_credentials' };
  }

  if (!booking.email) {
    console.warn('[notifier] Skipping guest email: booking has no email address on file.');
    return { sent: false, reason: 'missing_recipient' };
  }

  try {
    await t.sendMail({
      from: `"Juantero's Staycation" <${GMAIL_USER}>`,
      to: booking.email,
      subject: `Booking Request Received - ${booking.roomName} - Juantero's Staycation`,
      html: buildBookingEmailHtml(booking, 'Pending', null, paymentUrl)
    });
    return { sent: true };
  } catch (err) {
    console.error('[notifier] Failed to send guest pending email:', err.message);
    return { sent: false, reason: 'send_error', error: err.message };
  }
}

/**
 * Emails the ADMIN when a guest uploads proof of payment, so it can be
 * reviewed and verified/rejected from the admin console.
 */
async function sendPaymentProofAdminNotice(booking) {
  const message = [
    'A guest has submitted proof of payment for a booking.',
    '',
    `Guest: ${booking.name}`,
    `Balai: ${booking.roomName}`,
    `Check-in: ${booking.checkIn}`,
    `Check-out: ${booking.checkOut}`,
    `Payment method: ${booking.paymentMethod || 'Not specified'}`,
    `Reference number: ${booking.paymentReference || 'Not provided'}`,
    '',
    'Review and verify it from the admin console under All Booking Requests.'
  ].join('\n');

  return sendAdminSms(message, 'New Payment Proof Submitted - Juantero\'s Staycation');
}

/**
 * Emails the GUEST after the admin verifies or rejects their submitted
 * proof of payment (separate from the overall booking Approve/Cancel).
 */
async function sendPaymentReviewEmail(booking, paymentStatus, paymentUrl) {
  const t = getTransporter();

  if (!t) {
    console.warn('[notifier] Skipping guest email: GMAIL_USER / GMAIL_APP_PASSWORD not set in .env');
    return { sent: false, reason: 'missing_email_credentials' };
  }

  if (!booking.email) {
    console.warn('[notifier] Skipping guest email: booking has no email address on file.');
    return { sent: false, reason: 'missing_recipient' };
  }

  const isVerified = paymentStatus === 'Verified';
  const bannerColor = isVerified ? '#1e7e34' : '#b02a2a';
  const bannerBg = isVerified ? '#eaf7ea' : '#fdeaea';
  const headline = isVerified ? 'Payment Verified!' : 'We Couldn\'t Verify Your Payment';
  const bodyText = isVerified
    ? 'We\'ve verified your payment. We\'ll confirm your booking shortly - keep an eye on your inbox.'
    : 'We weren\'t able to verify the proof of payment you submitted. Please double-check the details and try again.';

  const retrySection = !isVerified && paymentUrl ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:22px 0 0;text-align:center;">
          <a href="${paymentUrl}"
             style="display:inline-block;background:#f3c300;color:#222222;font-weight:700;font-size:14px;
                    padding:14px 30px;border-radius:8px;text-decoration:none;">
            Resubmit Payment
          </a>
        </td>
      </tr>
    </table>` : '';

  const html = `
  <!DOCTYPE html>
  <html>
  <body style="margin:0;padding:0;background:#04091e;font-family:'Poppins',Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${emailBgStyle()}padding:10px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:0;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">
            <tr>
              <td style="background:#222222;padding:24px 28px;text-align:center;">
                <p style="margin:0;color:#f3c300;font-family:Georgia,'Playfair Display',serif;font-size:22px;font-weight:700;">
                  Juantero's Staycation
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:${bannerBg};padding:16px 28px;text-align:center;">
                <p style="margin:0;color:${bannerColor};font-size:16px;font-weight:700;">
                  ${headline}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0;color:#444444;font-size:14px;line-height:1.6;">
                  Hi ${booking.name}, ${bodyText}
                </p>
                ${retrySection}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#f7f7f9;text-align:center;">
                <p style="margin:0;color:#9ca3af;font-size:12px;">
                  Juantero's Staycation &bull; This is an automated message.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>`;

  try {
    await t.sendMail({
      from: `"Juantero's Staycation" <${GMAIL_USER}>`,
      to: booking.email,
      subject: isVerified
        ? `Payment Verified - ${booking.roomName} - Juantero's Staycation`
        : `Payment Not Verified - ${booking.roomName} - Juantero's Staycation`,
      html
    });
    return { sent: true };
  } catch (err) {
    console.error('[notifier] Failed to send guest payment-review email:', err.message);
    return { sent: false, reason: 'send_error', error: err.message };
  }
}

/**
 * Emails the GUEST (booking.email, the address they entered when
 * booking) after the admin accepts or denies their request.
 * - Approved -> confirmation email with a QR code they can show at check-in.
 * - Cancelled -> polite decline email, no QR code.
 */
async function sendBookingStatusEmail(booking, status) {
  const t = getTransporter();

  if (!t) {
    console.warn('[notifier] Skipping guest email: GMAIL_USER / GMAIL_APP_PASSWORD not set in .env');
    return { sent: false, reason: 'missing_email_credentials' };
  }

  if (!booking.email) {
    console.warn('[notifier] Skipping guest email: booking has no email address on file.');
    return { sent: false, reason: 'missing_recipient' };
  }

  let qrDataUrl = null;
  if (status === 'Approved') {
    const qrPayload = [
      'Juantero\'s Staycation - Booking Confirmation',
      `Booking ID: ${booking.id}`,
      `Guest: ${booking.name}`,
      `Balai: ${booking.roomName}`,
      `Check-in: ${booking.checkIn}`,
      `Check-out: ${booking.checkOut}`,
      `Guests: ${booking.guests}`
    ].join('\n');

    try {
      qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 360, margin: 1 });
    } catch (err) {
      console.error('[notifier] Failed to generate QR code:', err.message);
      // Still send the email, just without a QR code
    }
  }

  const subject = status === 'Approved'
    ? `Booking Confirmed - ${booking.roomName} - Juantero's Staycation`
    : `Booking Update - ${booking.roomName} - Juantero's Staycation`;

  try {
    await t.sendMail({
      from: `"Juantero's Staycation" <${GMAIL_USER}>`,
      to: booking.email,
      subject,
      html: buildBookingEmailHtml(booking, status, qrDataUrl)
    });
    return { sent: true };
  } catch (err) {
    console.error('[notifier] Failed to send guest status email:', err.message);
    return { sent: false, reason: 'send_error', error: err.message };
  }
}

module.exports = {
  sendAdminSms,
  sendAdminBookingNotice,
  sendBookingStatusEmail,
  sendBookingPendingEmail,
  sendPaymentProofAdminNotice,
  sendPaymentReviewEmail
};
