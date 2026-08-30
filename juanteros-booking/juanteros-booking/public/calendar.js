/* ===========================================================
   Juantero's Staycation — Airbnb-style date range calendar
   Shows two months, greys out/strikes through any date that's
   already booked (Pending or Approved) or admin-closed for the
   selected room, and only lets guests pick a range that's fully
   open the whole way through.
   =========================================================== */
(function () {
  const MS_DAY = 24 * 60 * 60 * 1000;

  const state = {
    roomId: null,
    blockedRanges: [], // [{ start: Date, end: Date }] end is exclusive (checkout day is free)
    rangeStart: null,
    rangeEnd: null,
    hoverDate: null,
    viewDate: startOfMonth(today())
  };

  const els = {};

  function today() {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }
  function addMonths(date, n) {
    return new Date(date.getFullYear(), date.getMonth() + n, 1);
  }
  function addDays(date, n) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  }
  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function parseISODate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function isDateBlocked(date) {
    return state.blockedRanges.some(r => date >= r.start && date < r.end);
  }
  function isDatePast(date) {
    return date < today();
  }
  function isDateDisabled(date) {
    return isDatePast(date) || isDateBlocked(date);
  }
  // Every night from start (inclusive) up to end (exclusive) must be open.
  function isRangeFree(start, end) {
    for (let d = new Date(start); d < end; d = addDays(d, 1)) {
      if (isDateBlocked(d)) return false;
    }
    return true;
  }

  function initEls() {
    els.trigger = document.getElementById('date-range-trigger');
    els.label = document.getElementById('date-range-label');
    els.popover = document.getElementById('calendar-popover');
    els.monthsContainer = document.getElementById('calendar-months');
    els.prevBtn = document.getElementById('calendar-prev');
    els.nextBtn = document.getElementById('calendar-next');
    els.clearBtn = document.getElementById('calendar-clear');
    els.closeBtn = document.getElementById('calendar-close');
    els.hint = document.getElementById('calendar-hint');
    els.roomSelect = document.getElementById('room-select');
    els.checkinInput = document.getElementById('checkin');
    els.checkoutInput = document.getElementById('checkout');
    els.form = document.getElementById('booking-form');
  }

  function openPopover() {
    if (els.trigger.disabled) return;
    els.popover.hidden = false;
    render();
  }
  function closePopover() {
    els.popover.hidden = true;
  }

  function updateTriggerLabel() {
    if (!state.roomId) {
      els.label.textContent = 'Select a room first';
      return;
    }
    const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (!state.rangeStart) {
      els.label.textContent = 'Add check-in and check-out dates';
    } else if (!state.rangeEnd) {
      els.label.textContent = `${fmt(state.rangeStart)} — Select checkout`;
    } else {
      els.label.textContent = `${fmt(state.rangeStart)} — ${fmt(state.rangeEnd)}`;
    }
  }

  function updateHiddenInputs() {
    els.checkinInput.value = state.rangeStart ? toISODate(state.rangeStart) : '';
    els.checkoutInput.value = state.rangeEnd ? toISODate(state.rangeEnd) : '';
  }

  function renderMonth(monthDate) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const previewEnd = state.rangeStart && !state.rangeEnd && state.hoverDate && state.hoverDate > state.rangeStart
      ? state.hoverDate
      : null;

    let cells = '';
    for (let i = 0; i < startWeekday; i++) cells += `<div class="cal-cell cal-empty"></div>`;

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const disabled = isDateDisabled(date);
      const isStart = state.rangeStart && isSameDay(date, state.rangeStart);
      const isEnd = state.rangeEnd && isSameDay(date, state.rangeEnd);
      const isHoverEnd = previewEnd && isSameDay(date, previewEnd);

      let inRange = false;
      if (state.rangeStart && state.rangeEnd) {
        inRange = date > state.rangeStart && date < state.rangeEnd;
      } else if (previewEnd) {
        inRange = date > state.rangeStart && date < previewEnd;
      }

      let cls = 'cal-cell cal-day';
      if (disabled) cls += ' disabled';
      if (isStart || isEnd) cls += ' selected';
      if (inRange) cls += ' in-range';
      if (isHoverEnd && !disabled) cls += ' hover-end';
      if (isStart) cls += ' range-start';
      if (isEnd) cls += ' range-end';

      cells += `<button type="button" class="${cls}" data-date="${toISODate(date)}" ${disabled ? 'disabled' : ''}>${day}</button>`;
    }

    return `
      <div class="cal-month">
        <div class="cal-month-title">${monthLabel}</div>
        <div class="cal-weekdays">
          <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
        </div>
        <div class="cal-grid">${cells}</div>
      </div>
    `;
  }

  function render() {
    const month1 = state.viewDate;
    const month2 = addMonths(state.viewDate, 1);
    els.monthsContainer.innerHTML = renderMonth(month1) + renderMonth(month2);

    els.monthsContainer.querySelectorAll('.cal-day:not(.disabled)').forEach(btn => {
      btn.addEventListener('click', onDayClick);
      btn.addEventListener('mouseenter', onDayHover);
    });

    const thisMonth = startOfMonth(today());
    els.prevBtn.disabled = state.viewDate.getTime() <= thisMonth.getTime();

    updateHint();
  }

  function updateHint() {
    els.hint.classList.remove('calendar-hint-error');
    if (!state.rangeStart) {
      els.hint.textContent = 'Select a check-in date';
    } else if (!state.rangeEnd) {
      els.hint.textContent = 'Select a check-out date';
    } else {
      const nights = Math.round((state.rangeEnd - state.rangeStart) / MS_DAY);
      els.hint.textContent = `${nights} night${nights === 1 ? '' : 's'} selected`;
    }
  }

  function onDayHover(e) {
    if (!state.rangeStart || state.rangeEnd) return;
    const date = parseISODate(e.currentTarget.getAttribute('data-date'));
    if (isSameDay(date, state.hoverDate || new Date(0))) return;
    state.hoverDate = date;
    render();
  }

  function onDayClick(e) {
    const date = parseISODate(e.currentTarget.getAttribute('data-date'));

    if (!state.rangeStart || (state.rangeStart && state.rangeEnd)) {
      state.rangeStart = date;
      state.rangeEnd = null;
      state.hoverDate = null;
    } else if (date <= state.rangeStart) {
      state.rangeStart = date;
      state.rangeEnd = null;
      state.hoverDate = null;
    } else {
      if (!isRangeFree(state.rangeStart, date)) {
        render();
        els.hint.textContent = 'Some nights in that range are already unavailable — pick another checkout date.';
        els.hint.classList.add('calendar-hint-error');
        return;
      }
      state.rangeEnd = date;
    }

    updateTriggerLabel();
    updateHiddenInputs();
    render();

    if (state.rangeStart && state.rangeEnd) {
      setTimeout(closePopover, 250);
    }
  }

  function resetSelection() {
    state.rangeStart = null;
    state.rangeEnd = null;
    state.hoverDate = null;
    updateTriggerLabel();
    updateHiddenInputs();
  }

  function loadBlockedDates(roomId) {
    return fetch(`/api/rooms/${roomId}/blocked-dates`)
      .then(res => res.json())
      .then(ranges => {
        state.blockedRanges = ranges.map(r => ({
          start: parseISODate(r.startDate),
          end: parseISODate(r.endDate)
        }));
      })
      .catch(() => { state.blockedRanges = []; });
  }

  function onRoomChange() {
    const roomId = els.roomSelect.value;
    resetSelection();
    closePopover();

    if (!roomId) {
      state.roomId = null;
      state.blockedRanges = [];
      els.trigger.disabled = true;
      updateTriggerLabel();
      return;
    }

    state.roomId = roomId;
    els.trigger.disabled = true;
    els.label.textContent = 'Loading availability...';

    loadBlockedDates(roomId).then(() => {
      els.trigger.disabled = false;
      state.viewDate = startOfMonth(today());
      updateTriggerLabel();
    });
  }

  // Called by app.js right after a booking is successfully submitted, so the
  // dates that were just reserved immediately show as blocked if the guest
  // (or anyone else browsing the same room) opens the calendar again.
  window.JuanterosCalendar = {
    refresh: function () {
      resetSelection();
      closePopover();
      if (state.roomId) onRoomChange();
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    initEls();
    if (!els.trigger) return;

    updateTriggerLabel();

    els.trigger.addEventListener('click', () => {
      if (els.popover.hidden) openPopover(); else closePopover();
    });
    els.prevBtn.addEventListener('click', () => { state.viewDate = addMonths(state.viewDate, -1); render(); });
    els.nextBtn.addEventListener('click', () => { state.viewDate = addMonths(state.viewDate, 1); render(); });
    els.clearBtn.addEventListener('click', () => { resetSelection(); render(); });
    els.closeBtn.addEventListener('click', closePopover);

    document.addEventListener('click', (e) => {
      if (!els.popover.hidden && !els.popover.contains(e.target) && !els.trigger.contains(e.target)) {
        closePopover();
      }
    });

    els.roomSelect.addEventListener('change', onRoomChange);

    if (els.form) {
      els.form.addEventListener('reset', () => {
        setTimeout(() => { resetSelection(); onRoomChange(); }, 0);
      });
    }
  });
})();
