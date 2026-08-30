document.addEventListener('DOMContentLoaded', () => {
  fetchBookings();
  populateRoomOptions();
  fetchClosedDates();
  fetchRoomPhotos();
  fetchSiteImages();
  fetchRates();
  fetchPaymentSettings();

  document.getElementById('rates-add-tier-btn').addEventListener('click', () => {
    addRateTierRow({ label: '', price: '' });
  });

  document.getElementById('rates-save-btn').addEventListener('click', saveRates);

  // Logs the admin out: destroys the server-side session, then sends
  // them back to the login page. Only affects the admin session - the
  // public booking site has no login/session to begin with.
  document.getElementById('admin-logout-btn').addEventListener('click', () => {
    fetch('/api/admin/logout', { method: 'POST' })
      .finally(() => {
        window.location.href = 'admin-login.html';
      });
  });

  document.getElementById('closed-date-form').addEventListener('submit', (e) => {
    e.preventDefault();

    const payload = {
      roomId: document.getElementById('closed-room-select').value,
      startDate: document.getElementById('closed-start-date').value,
      endDate: document.getElementById('closed-end-date').value,
      reason: document.getElementById('closed-reason').value
    };

    fetch('/api/closed-dates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(async res => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add closed dates');
      return data;
    })
    .then(() => {
      document.getElementById('closed-date-form').reset();
      fetchClosedDates();
    })
    .catch(err => alert(err.message));
  });
});

/* ---------------------------------------------------------------
   ROOM PHOTOS
   --------------------------------------------------------------- */
function fetchRoomPhotos() {
  const grid = document.getElementById('room-photo-grid');
  grid.innerHTML = '';

  fetch('/api/rooms')
    .then(res => res.json())
    .then(rooms => {
      rooms.forEach(room => {
        const card = document.createElement('div');
        card.className = 'room-photo-card';
        card.id = `room-photo-card-${room.id}`;
        card.innerHTML = `
          <div class="photo-preview">
            <img src="${room.image ? room.image + '?v=' + Date.now() : ''}" alt="${escapeHTML(room.name)}"
                 onerror="this.style.display='none';">
          </div>
          <div class="photo-body">
            <p class="room-name">${escapeHTML(room.name)}</p>
            <input type="file" id="photo-input-${room.id}" accept=".jpg,.jpeg,.png,.webp">
            <button class="admin-btn admin-btn-primary" style="width:100%;" onclick="uploadRoomPhoto('${room.id}')">
              Upload New Photo
            </button>
            <div class="upload-status" id="upload-status-${room.id}"></div>
          </div>
        `;
        grid.appendChild(card);
      });
    });
}

function uploadRoomPhoto(roomId) {
  const input = document.getElementById(`photo-input-${roomId}`);
  const statusEl = document.getElementById(`upload-status-${roomId}`);
  const file = input.files[0];

  if (!file) {
    statusEl.textContent = 'Choose a photo first.';
    statusEl.className = 'upload-status error';
    return;
  }

  const formData = new FormData();
  formData.append('photo', file);

  statusEl.textContent = 'Uploading...';
  statusEl.className = 'upload-status';

  fetch(`/api/rooms/${roomId}/image`, {
    method: 'POST',
    body: formData
  })
  .then(async res => {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to upload photo');
    return data;
  })
  .then(() => {
    statusEl.textContent = 'Photo updated!';
    statusEl.className = 'upload-status success';
    input.value = '';
    fetchRoomPhotos();
  })
  .catch(err => {
    statusEl.textContent = err.message;
    statusEl.className = 'upload-status error';
  });
}

/* ---------------------------------------------------------------
   SITE PHOTOS (logo, hero background, gallery)
   --------------------------------------------------------------- */
function fetchSiteImages() {
  const grid = document.getElementById('site-image-grid');
  grid.innerHTML = '';

  fetch('/api/site-images')
    .then(res => res.json())
    .then(siteImages => {
      Object.keys(siteImages).forEach(key => {
        const entry = siteImages[key];
        const card = document.createElement('div');
        card.className = 'room-photo-card';
        card.id = `site-photo-card-${key}`;
        card.innerHTML = `
          <div class="photo-preview">
            <img src="${entry.image ? entry.image + '?v=' + Date.now() : ''}" alt="${escapeHTML(entry.label)}"
                 onerror="this.style.display='none';">
          </div>
          <div class="photo-body">
            <p class="room-name">${escapeHTML(entry.label)}</p>
            <input type="file" id="site-photo-input-${key}" accept=".jpg,.jpeg,.png,.webp">
            <button class="admin-btn admin-btn-primary" style="width:100%;" onclick="uploadSitePhoto('${key}')">
              Upload New Photo
            </button>
            <div class="upload-status" id="site-upload-status-${key}"></div>
          </div>
        `;
        grid.appendChild(card);
      });
    });
}

function uploadSitePhoto(key) {
  const input = document.getElementById(`site-photo-input-${key}`);
  const statusEl = document.getElementById(`site-upload-status-${key}`);
  const file = input.files[0];

  if (!file) {
    statusEl.textContent = 'Choose a photo first.';
    statusEl.className = 'upload-status error';
    return;
  }

  const formData = new FormData();
  formData.append('photo', file);

  statusEl.textContent = 'Uploading...';
  statusEl.className = 'upload-status';

  fetch(`/api/site-images/${key}/image`, {
    method: 'POST',
    body: formData
  })
  .then(async res => {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to upload photo');
    return data;
  })
  .then(() => {
    statusEl.textContent = 'Photo updated!';
    statusEl.className = 'upload-status success';
    input.value = '';
    fetchSiteImages();
  })
  .catch(err => {
    statusEl.textContent = err.message;
    statusEl.className = 'upload-status error';
  });
}

/* ---------------------------------------------------------------
   RATES & PRICING
   --------------------------------------------------------------- */
function fetchRates() {
  fetch('/api/rates')
    .then(res => res.json())
    .then(rates => {
      document.getElementById('rates-checkin').value = rates.checkIn || '';
      document.getElementById('rates-checkout').value = rates.checkOut || '';
      document.getElementById('rates-duration').value = rates.durationLabel || '';
      document.getElementById('rates-excess-label').value = rates.excessPaxLabel || '';
      document.getElementById('rates-excess-fee').value = rates.excessPaxFee || 0;
      document.getElementById('rates-pet-label').value = rates.petFeeLabel || '';
      document.getElementById('rates-pet-fee').value = rates.petFee || 0;

      const tbody = document.getElementById('rates-tiers-list');
      tbody.innerHTML = '';
      (rates.tiers || []).forEach(tier => addRateTierRow(tier));
    })
    .catch(() => {
      const statusEl = document.getElementById('rates-status');
      statusEl.textContent = 'Failed to load rates.';
      statusEl.className = 'upload-status error';
    });
}

// Appends one editable tier row (pax-range label + price) to the rates table.
function addRateTierRow(tier) {
  const tbody = document.getElementById('rates-tiers-list');
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input type="text" class="rate-tier-label" value="${escapeHTML(tier.label || '')}" placeholder="e.g. 1 - 2 pax"></td>
    <td><input type="number" class="rate-tier-price" min="0" step="1" value="${tier.price !== undefined && tier.price !== '' ? tier.price : ''}" placeholder="0"></td>
    <td><button type="button" class="actions-btn btn-delete" onclick="this.closest('tr').remove()">Remove</button></td>
  `;
  tbody.appendChild(row);
}

function saveRates() {
  const statusEl = document.getElementById('rates-status');

  const tierRows = [...document.querySelectorAll('#rates-tiers-list tr')];
  const tiers = tierRows.map(row => ({
    label: row.querySelector('.rate-tier-label').value.trim(),
    price: Number(row.querySelector('.rate-tier-price').value) || 0
  })).filter(t => t.label !== '');

  const payload = {
    checkIn: document.getElementById('rates-checkin').value.trim(),
    checkOut: document.getElementById('rates-checkout').value.trim(),
    durationLabel: document.getElementById('rates-duration').value.trim(),
    tiers,
    excessPaxLabel: document.getElementById('rates-excess-label').value.trim(),
    excessPaxFee: Number(document.getElementById('rates-excess-fee').value) || 0,
    petFeeLabel: document.getElementById('rates-pet-label').value.trim(),
    petFee: Number(document.getElementById('rates-pet-fee').value) || 0
  };

  statusEl.textContent = 'Saving...';
  statusEl.className = 'upload-status';

  fetch('/api/rates', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(async res => {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save rates');
    return data;
  })
  .then(() => {
    statusEl.textContent = 'Rates updated!';
    statusEl.className = 'upload-status success';
    fetchRates();
  })
  .catch(err => {
    statusEl.textContent = err.message;
    statusEl.className = 'upload-status error';
  });
}

/* ---------------------------------------------------------------
   PAYMENT SETTINGS (Bank Transfer / GCash / Maya)
   --------------------------------------------------------------- */
function fetchPaymentSettings() {
  const grid = document.getElementById('payment-settings-grid');
  grid.innerHTML = '';

  fetch('/api/payment-settings')
    .then(res => res.json())
    .then(paymentSettings => {
      Object.keys(paymentSettings).forEach(key => {
        const m = paymentSettings[key];
        const card = document.createElement('div');
        card.className = 'room-photo-card';
        card.id = `payment-card-${key}`;
        card.innerHTML = `
          <div class="photo-preview">
            <img src="${m.qrImage ? m.qrImage + '?v=' + Date.now() : ''}" alt="${escapeHTML(m.label)} QR code"
                 onerror="this.style.display='none';">
          </div>
          <div class="photo-body">
            <p class="room-name">${escapeHTML(m.label)}</p>
            <input type="file" id="payment-qr-input-${key}" accept=".jpg,.jpeg,.png,.webp">
            <button class="admin-btn" style="width:100%;margin-bottom:10px;" onclick="uploadPaymentQr('${key}')">
              Upload QR Code
            </button>
            ${key === 'bank' ? `
            <div class="admin-field" style="margin-bottom:8px;">
              <label for="payment-bankname-${key}">Bank Name</label>
              <input type="text" id="payment-bankname-${key}" value="${escapeHTML(m.bankName || '')}">
            </div>` : ''}
            <div class="admin-field" style="margin-bottom:8px;">
              <label for="payment-accname-${key}">Account Name</label>
              <input type="text" id="payment-accname-${key}" value="${escapeHTML(m.accountName || '')}">
            </div>
            <div class="admin-field" style="margin-bottom:8px;">
              <label for="payment-accnum-${key}">Account / Mobile Number</label>
              <input type="text" id="payment-accnum-${key}" value="${escapeHTML(m.accountNumber || '')}">
            </div>
            <div class="admin-field" style="margin-bottom:10px;">
              <label for="payment-instructions-${key}">Instructions</label>
              <textarea id="payment-instructions-${key}" rows="3" style="width:100%;">${escapeHTML(m.instructions || '')}</textarea>
            </div>
            <button class="admin-btn admin-btn-primary" style="width:100%;" onclick="savePaymentDetails('${key}')">
              Save Details
            </button>
            <div class="upload-status" id="payment-status-${key}"></div>
          </div>
        `;
        grid.appendChild(card);
      });
    });
}

function savePaymentDetails(key) {
  const statusEl = document.getElementById(`payment-status-${key}`);
  const payload = {
    accountName: document.getElementById(`payment-accname-${key}`).value,
    accountNumber: document.getElementById(`payment-accnum-${key}`).value,
    instructions: document.getElementById(`payment-instructions-${key}`).value
  };
  const bankNameInput = document.getElementById(`payment-bankname-${key}`);
  if (bankNameInput) payload.bankName = bankNameInput.value;

  statusEl.textContent = 'Saving...';
  statusEl.className = 'upload-status';

  fetch(`/api/payment-settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(async res => {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save payment settings');
    return data;
  })
  .then(() => {
    statusEl.textContent = 'Saved!';
    statusEl.className = 'upload-status success';
  })
  .catch(err => {
    statusEl.textContent = err.message;
    statusEl.className = 'upload-status error';
  });
}

function uploadPaymentQr(key) {
  const input = document.getElementById(`payment-qr-input-${key}`);
  const statusEl = document.getElementById(`payment-status-${key}`);
  const file = input.files[0];

  if (!file) {
    statusEl.textContent = 'Choose a QR image first.';
    statusEl.className = 'upload-status error';
    return;
  }

  const formData = new FormData();
  formData.append('photo', file);

  statusEl.textContent = 'Uploading...';
  statusEl.className = 'upload-status';

  fetch(`/api/payment-settings/${key}/image`, {
    method: 'POST',
    body: formData
  })
  .then(async res => {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to upload QR code');
    return data;
  })
  .then(() => {
    statusEl.textContent = 'QR code updated!';
    statusEl.className = 'upload-status success';
    input.value = '';
    fetchPaymentSettings();
  })
  .catch(err => {
    statusEl.textContent = err.message;
    statusEl.className = 'upload-status error';
  });
}

/* ---------------------------------------------------------------
   CLOSED DATES
   --------------------------------------------------------------- */
function populateRoomOptions() {
  fetch('/api/rooms')
    .then(res => res.json())
    .then(rooms => {
      const select = document.getElementById('closed-room-select');
      rooms.forEach(room => {
        const option = document.createElement('option');
        option.value = room.id;
        option.textContent = room.name;
        select.appendChild(option);
      });
    });
}

function fetchClosedDates() {
  const listElement = document.getElementById('closed-dates-list');
  listElement.innerHTML = '';

  fetch('/api/closed-dates')
    .then(res => res.json())
    .then(closedDates => {
      if (closedDates.length === 0) {
        listElement.innerHTML = `<tr class="empty-row"><td colspan="5">No closed dates set.</td></tr>`;
        return;
      }

      fetch('/api/rooms')
        .then(res => res.json())
        .then(rooms => {
          const roomNameById = {};
          rooms.forEach(r => { roomNameById[r.id] = r.name; });

          closedDates.forEach(closed => {
            const roomLabel = closed.roomId === 'all' ? 'All Rooms' : (roomNameById[closed.roomId] || closed.roomId);
            const row = document.createElement('tr');
            row.innerHTML = `
              <td><strong>${escapeHTML(roomLabel)}</strong></td>
              <td>${closed.startDate}</td>
              <td>${closed.endDate}</td>
              <td>${escapeHTML(closed.reason || '-')}</td>
              <td>
                <button class="actions-btn btn-delete" onclick="deleteClosedDate('${closed.id}')">Delete</button>
              </td>
            `;
            listElement.appendChild(row);
          });
        });
    });
}

function deleteClosedDate(id) {
  if (confirm('Remove this closed date range? Guests will be able to book these dates again.')) {
    fetch(`/api/closed-dates/${id}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(() => fetchClosedDates())
      .catch(err => alert(err.message));
  }
}

/* ---------------------------------------------------------------
   BOOKINGS
   --------------------------------------------------------------- */
let allBookings = []; // full list from the server, unfiltered

function fetchBookings() {
  fetch('/api/bookings')
    .then(res => res.json())
    .then(bookings => {
      allBookings = bookings;
      renderBookings(getFilteredBookings());
    });
}

// Returns allBookings, narrowed down to the selected check-in month (if any).
function getFilteredBookings() {
  const monthInput = document.getElementById('booking-month-filter');
  const monthValue = monthInput ? monthInput.value : ''; // e.g. "2026-12"
  if (!monthValue) return allBookings;
  return allBookings.filter(booking => booking.checkIn && booking.checkIn.startsWith(monthValue));
}

function renderBookings(bookings) {
  const listElement = document.getElementById('bookings-list');
  listElement.innerHTML = '';

  if (bookings.length === 0) {
    listElement.innerHTML = `<tr class="empty-row"><td colspan="9">No reservations found for this filter.</td></tr>`;
    return;
  }

  bookings.forEach(booking => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${escapeHTML(booking.name)}</strong></td>
      <td>
        Phone: ${escapeHTML(booking.phone)}<br>
        Email: ${escapeHTML(booking.email)}
      </td>
      <td>${escapeHTML(booking.roomName)}</td>
      <td>${booking.checkIn}</td>
      <td>${booking.checkOut}</td>
      <td>${booking.guests}</td>
      <td>
        <span class="status-badge status-${booking.status.toLowerCase()}">${booking.status}</span>
      </td>
      <td>${renderPaymentCell(booking)}</td>
      <td>
        ${booking.status === 'Pending' ? `
          <button class="actions-btn btn-approve" onclick="updateStatus('${booking.id}', 'Approved')">Approve</button>
          <button class="actions-btn btn-cancel" onclick="updateStatus('${booking.id}', 'Cancelled')">Cancel</button>
        ` : ''}
        <button class="actions-btn btn-delete" onclick="deleteBooking('${booking.id}')">Delete</button>
      </td>
    `;
    listElement.appendChild(row);
  });
}

// Builds the "Payment" column cell for one booking row: a status badge,
// a link to view the uploaded proof screenshot (if any), the payment
// method + reference, and Verify/Reject buttons when a proof is pending
// review.
function renderPaymentCell(booking) {
  const paymentStatus = booking.paymentStatus || 'Awaiting Payment';
  const badgeClass = 'status-' + paymentStatus.toLowerCase().replace(/\s+/g, '-');

  let html = `<span class="status-badge ${badgeClass}">${escapeHTML(paymentStatus)}</span>`;

  if (booking.paymentProofImage) {
    const methodLabel = { bank: 'Bank Transfer', gcash: 'GCash', maya: 'Maya' }[booking.paymentMethod] || booking.paymentMethod || '';
    html += `<div class="payment-cell-meta">`;
    html += `<a href="${booking.paymentProofImage}" target="_blank" rel="noopener">View Proof</a>`;
    if (methodLabel) html += ` &bull; ${escapeHTML(methodLabel)}`;
    if (booking.paymentReference) html += `<br>Ref: ${escapeHTML(booking.paymentReference)}`;
    html += `</div>`;
  }

  if (paymentStatus === 'Submitted') {
    html += `
      <div class="payment-cell-actions">
        <button class="actions-btn btn-approve" onclick="updatePaymentStatus('${booking.id}', 'Verified')">Verify</button>
        <button class="actions-btn btn-cancel" onclick="updatePaymentStatus('${booking.id}', 'Rejected')">Reject</button>
      </div>`;
  }

  return html;
}

function updatePaymentStatus(id, newPaymentStatus) {
  const confirmMsg = newPaymentStatus === 'Verified'
    ? 'Mark this proof of payment as verified? The guest will be emailed.'
    : 'Reject this proof of payment? The guest will be emailed and asked to resubmit.';

  if (!confirm(confirmMsg)) return;

  fetch(`/api/bookings/${id}/payment-status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentStatus: newPaymentStatus })
  })
  .then(async res => {
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to update payment status');
    } else {
      fetchBookings();
    }
  })
  .catch(err => alert(err.message));
}

// Builds a CSV (Name, Phone, Check-in, Check-out) from the currently
// filtered bookings and downloads it - opens directly in Excel.
function exportBookingsToExcel() {
  const bookings = getFilteredBookings();

  if (bookings.length === 0) {
    alert('No bookings to export for the current filter.');
    return;
  }

  const csvEscape = (value) => {
    const str = String(value ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const header = ['Name', 'Phone', 'Check-in', 'Check-out'];
  const rows = bookings.map(b => [b.name, b.phone, b.checkIn, b.checkOut].map(csvEscape));
  const csvContent = [header, ...rows].map(row => row.join(',')).join('\r\n');

  // Prefix with a UTF-8 BOM so Excel renders special characters correctly.
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const monthInput = document.getElementById('booking-month-filter');
  const monthValue = monthInput ? monthInput.value : '';
  const filenameSuffix = monthValue ? `-${monthValue}` : '';

  const link = document.createElement('a');
  link.href = url;
  link.download = `bookings${filenameSuffix}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', () => {
  const monthFilter = document.getElementById('booking-month-filter');
  if (monthFilter) {
    monthFilter.addEventListener('change', () => renderBookings(getFilteredBookings()));
  }

  const clearBtn = document.getElementById('clear-booking-filter');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (monthFilter) monthFilter.value = '';
      renderBookings(getFilteredBookings());
    });
  }

  const exportBtn = document.getElementById('export-bookings-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportBookingsToExcel);
  }
});

function updateStatus(id, newStatus) {
  fetch(`/api/bookings/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus })
  })
  .then(async res => {
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to update booking');
    } else {
      fetchBookings();
    }
  })
  .catch(err => alert(err.message));
}

function deleteBooking(id) {
  if (confirm('Are you sure you want to permanently delete this record?')) {
    fetch(`/api/bookings/${id}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(() => fetchBookings())
      .catch(err => alert(err.message));
  }
}

function escapeHTML(str) {
  return String(str).replace(/[&<>'"]/g,
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}
