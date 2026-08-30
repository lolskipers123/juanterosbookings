document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const bookingId = params.get('bookingId');

  const loadingEl = document.getElementById('pay-loading');
  const notFoundEl = document.getElementById('pay-not-found');
  const contentEl = document.getElementById('pay-content');

  if (!bookingId) {
    loadingEl.style.display = 'none';
    notFoundEl.style.display = 'block';
    return;
  }

  let paymentSettings = null;
  let activeMethod = 'bank';

  // Load payment method details (bank/gcash/maya account info + QR codes)
  fetch('/api/payment-settings')
    .then(res => res.json())
    .then(settings => {
      paymentSettings = settings;
      renderMethodPanel(activeMethod);
    });

  // Load this booking's public details
  fetch(`/api/bookings/${encodeURIComponent(bookingId)}/public`)
    .then(async res => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Booking not found.');
      return data;
    })
    .then(booking => {
      loadingEl.style.display = 'none';
      contentEl.style.display = 'block';
      renderBooking(booking);
    })
    .catch(() => {
      loadingEl.style.display = 'none';
      notFoundEl.style.display = 'block';
    });

  function statusClass(value) {
    return 'status-' + String(value).toLowerCase().replace(/\s+/g, '-');
  }

  function renderBooking(booking) {
    document.getElementById('sum-name').textContent = booking.name;
    document.getElementById('sum-room').textContent = booking.roomName;
    document.getElementById('sum-checkin').textContent = booking.checkIn;
    document.getElementById('sum-checkout').textContent = booking.checkOut;
    document.getElementById('sum-guests').textContent = booking.guests;

    const statusBadge = document.getElementById('sum-status');
    statusBadge.textContent = booking.status;
    statusBadge.className = 'status-badge ' + statusClass(booking.status);

    const paymentBadge = document.getElementById('sum-payment-status');
    paymentBadge.textContent = booking.paymentStatus;
    paymentBadge.className = 'status-badge ' + statusClass(booking.paymentStatus);

    // Hide all banners first, then show whichever applies
    ['cancelled', 'submitted', 'verified', 'rejected'].forEach(key => {
      document.getElementById(`pay-banner-${key}`).style.display = 'none';
    });

    if (booking.status === 'Cancelled') {
      document.getElementById('pay-banner-cancelled').style.display = 'block';
      document.getElementById('pay-form-card').style.display = 'none';
      return;
    }

    if (booking.paymentStatus === 'Submitted') {
      document.getElementById('pay-banner-submitted').style.display = 'block';
    } else if (booking.paymentStatus === 'Verified') {
      document.getElementById('pay-banner-verified').style.display = 'block';
    } else if (booking.paymentStatus === 'Rejected') {
      document.getElementById('pay-banner-rejected').style.display = 'block';
    }

    // Pre-select whichever method they last used, if any
    if (booking.paymentMethod) {
      activeMethod = booking.paymentMethod;
      document.querySelectorAll('.pay-method-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.method === activeMethod);
      });
      if (paymentSettings) renderMethodPanel(activeMethod);
    }
    if (booking.paymentReference) {
      document.getElementById('proof-reference').value = booking.paymentReference;
    }
  }

  function renderMethodPanel(method) {
    const panel = document.getElementById('pay-method-panel');
    if (!paymentSettings || !paymentSettings[method]) {
      panel.innerHTML = '';
      return;
    }
    const m = paymentSettings[method];
    panel.innerHTML = `
      ${m.bankName ? `<div class="pmp-row"><span>Bank</span><strong>${escapeHTML(m.bankName)}</strong></div>` : ''}
      <div class="pmp-row"><span>Account Name</span><strong>${escapeHTML(m.accountName || '')}</strong></div>
      <div class="pmp-row"><span>Account / Mobile Number</span><strong>${escapeHTML(m.accountNumber || '')}</strong></div>
      ${m.qrImage ? `<img class="pmp-qr" src="${m.qrImage}" alt="${escapeHTML(m.label)} QR code">` : ''}
      ${m.instructions ? `<p class="pmp-instructions">${escapeHTML(m.instructions)}</p>` : ''}
    `;
  }

  document.getElementById('pay-method-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.pay-method-tab');
    if (!tab) return;
    activeMethod = tab.dataset.method;
    document.querySelectorAll('.pay-method-tab').forEach(t => t.classList.toggle('active', t === tab));
    renderMethodPanel(activeMethod);
  });

  document.getElementById('proof-form').addEventListener('submit', (e) => {
    e.preventDefault();

    const fileInput = document.getElementById('proof-image');
    const statusEl = document.getElementById('proof-status');
    const submitBtn = document.getElementById('proof-submit-btn');

    if (!fileInput.files[0]) {
      statusEl.textContent = 'Please attach a screenshot of your payment.';
      statusEl.className = 'upload-status error';
      return;
    }

    const formData = new FormData();
    formData.append('method', activeMethod);
    formData.append('reference', document.getElementById('proof-reference').value);
    formData.append('proofImage', fileInput.files[0]);

    submitBtn.disabled = true;
    statusEl.textContent = 'Submitting...';
    statusEl.className = 'upload-status';

    fetch(`/api/bookings/${encodeURIComponent(bookingId)}/payment-proof`, {
      method: 'POST',
      body: formData
    })
    .then(async res => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit proof of payment.');
      return data;
    })
    .then(data => {
      statusEl.textContent = data.message;
      statusEl.className = 'upload-status success';
      submitBtn.disabled = false;
      fileInput.value = '';
      if (data.booking) renderBooking(data.booking);
    })
    .catch(err => {
      statusEl.textContent = err.message;
      statusEl.className = 'upload-status error';
      submitBtn.disabled = false;
    });
  });

  function escapeHTML(str) {
    return String(str).replace(/[&<>'"]/g,
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }
});
