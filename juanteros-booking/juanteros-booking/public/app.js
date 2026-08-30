// Escape special HTML characters so room data (name, capacity, details, etc.)
// can never break out of the markup we build below - e.g. an apostrophe in
// "guest's bath" used to close the onclick='...' attribute early and leave
// the rest of the card (photo, title, details) unrendered.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', () => {
  // Apply any admin-uploaded site photos (logo, hero background, gallery, etc.)
  // over the template defaults baked into the HTML.
  fetch('/api/site-images')
    .then(res => res.json())
    .then(siteImages => {
      Object.keys(siteImages).forEach(key => {
        const src = siteImages[key].image;
        if (!src) return;
        const bustedSrc = `${src}?v=${Date.now()}`;

        document.querySelectorAll(`[data-site-img="${key}"]`).forEach(el => {
          el.src = bustedSrc;
        });
        document.querySelectorAll(`[data-site-bg="${key}"]`).forEach(el => {
          el.style.backgroundImage = `url("${bustedSrc}")`;
        });

        if (key === 'logo') {
          const favicon = document.getElementById('site-favicon');
          if (favicon) favicon.href = bustedSrc;
        }
      });
    })
    .catch(() => {
      // If this fails, the template's default images already rendered - no harm done.
    });

  const roomsGrid = document.getElementById('rooms-grid');
  const roomSelect = document.getElementById('room-select');
  const bookingForm = document.getElementById('booking-form');
  const statusBox = document.getElementById('booking-status');

  // Load the Rates & Pricing card (check-in/out, per-pax tiers, excess-pax
  // and pet fees) set by the admin console.
  fetch('/api/rates')
    .then(res => res.json())
    .then(rates => {
      const wrap = document.getElementById('rates-card');
      if (!wrap) return;

      const rows = (rates.tiers || []).map(tier => `
        <tr>
          <td>${escapeHtml(tier.label)}</td>
          <td>&#8369;${Number(tier.price).toLocaleString()}</td>
        </tr>
      `).join('');

      wrap.innerHTML = `
        <div class="rates-meta">
          <span><strong>Check-in:</strong> ${escapeHtml(rates.checkIn || '')}</span>
          <span><strong>Check-out:</strong> ${escapeHtml(rates.checkOut || '')}</span>
          ${rates.durationLabel ? `<span><strong>Duration:</strong> ${escapeHtml(rates.durationLabel)}</span>` : ''}
        </div>
        <table class="rates-table">
          <thead>
            <tr><th>Pax</th><th>Rate</th></tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="2">Rates coming soon.</td></tr>'}
          </tbody>
        </table>
        <ul class="rates-fees">
          ${rates.excessPaxLabel ? `<li>${escapeHtml(rates.excessPaxLabel)}: &#8369;${Number(rates.excessPaxFee || 0).toLocaleString()}</li>` : ''}
          ${rates.petFeeLabel ? `<li>${escapeHtml(rates.petFeeLabel)}: &#8369;${Number(rates.petFee || 0).toLocaleString()}</li>` : ''}
        </ul>
      `;
    })
    .catch(() => {
      const wrap = document.getElementById('rates-card');
      if (wrap) wrap.innerHTML = '<p>Rates are temporarily unavailable. Please contact us directly.</p>';
    });

  // Load Rooms onto screen
  fetch('/api/rooms')
    .then(res => res.json())
    .then(rooms => {
      rooms.forEach(room => {
        // Append selector options
        const option = document.createElement('option');
        option.value = room.id;
        option.textContent = `${room.name} (${room.capacity})`;
        roomSelect.appendChild(option);

        // Build room visual cards, styled to match the template's
        // accomodation_item / hotel_img markup
        const safeId = escapeHtml(room.id);
        const safeName = escapeHtml(room.name);
        const safeCapacity = escapeHtml(room.capacity);
        const safeImage = room.image ? escapeHtml(room.image) : '';

        const col = document.createElement('div');
        col.className = 'col-lg-4 col-sm-6';
        col.innerHTML = `
          <div class="accomodation_item text-center">
            <div class="hotel_img">
              ${safeImage ? `<img src="${safeImage}" alt="${safeName}">` : ''}
            </div>
            <a href="#book" onclick="selectRoomForBooking('${safeId}')"><h4 class="sec_h4">${safeName}</h4></a>
            <span class="capacity-badge">Capacity: ${safeCapacity}</span>
            <ul class="room-details">
              ${room.details.map(detail => `<li>${escapeHtml(detail)}</li>`).join('')}
            </ul>
            <a href="#book" onclick="selectRoomForBooking('${safeId}')" class="btn theme_btn button_hover room-reserve-btn">Reserve Room</a>
          </div>
        `;
        roomsGrid.appendChild(col);
      });
    });

  // Handle Booking form submission
  bookingForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const bookingData = {
      roomId: roomSelect.value,
      checkIn: document.getElementById('checkin').value,
      checkOut: document.getElementById('checkout').value,
      name: document.getElementById('guest-name').value,
      guests: parseInt(document.getElementById('guest-count').value),
      email: document.getElementById('guest-email').value,
      phone: document.getElementById('guest-phone').value
    };

    if (!bookingData.checkIn || !bookingData.checkOut) {
      statusBox.className = 'message-box error';
      statusBox.textContent = 'Please pick your check-in and check-out dates on the calendar.';
      return;
    }

    fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingData)
    })
    .then(async res => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit booking');
      return data;
    })
    .then(data => {
      statusBox.className = 'message-box success';
      statusBox.innerHTML = '';
      statusBox.appendChild(document.createTextNode(data.message + ' '));
      if (data.paymentUrl) {
        const payLink = document.createElement('a');
        payLink.href = data.paymentUrl;
        payLink.className = 'pay-now-link';
        payLink.textContent = 'Proceed to Payment \u2192';
        statusBox.appendChild(payLink);
        statusBox.appendChild(document.createElement('br'));
        statusBox.appendChild(document.createTextNode('We also emailed you this link.'));
      }
      bookingForm.reset();
    })
    .catch(err => {
      statusBox.className = 'message-box error';
      statusBox.textContent = err.message;
    });
  });
});

// Helper: Jump down to the booking form when a room's "Reserve" button is clicked
function selectRoomForBooking(id) {
  const roomSelect = document.getElementById('room-select');
  roomSelect.value = id;
  roomSelect.dispatchEvent(new Event('change'));
  document.getElementById('book').scrollIntoView({ behavior: 'smooth' });
}
