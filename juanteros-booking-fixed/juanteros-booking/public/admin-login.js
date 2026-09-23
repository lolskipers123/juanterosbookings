;(function ($) {
  'use strict';

  var $form = $('#admin-login-form');
  var $btn = $('#admin-login-btn');
  var $message = $('#admin-login-message');

  // If already logged in, skip straight to the dashboard.
  fetch('/api/admin/session')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data && data.isAdmin) {
        window.location.replace('admin.html');
      }
    })
    .catch(function () { /* ignore - just show the login form */ });

  $form.on('submit', function (e) {
    e.preventDefault();

    var username = $('#login-username').val().trim();
    var password = $('#login-password').val();

    $message.removeClass('success error').hide();
    $btn.prop('disabled', true).text('Logging in...');

    fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok) {
          window.location.href = 'admin.html';
          return;
        }
        $message.addClass('error').text(result.data.error || 'Login failed.').show();
        $btn.prop('disabled', false).text('Log In');
      })
      .catch(function () {
        $message.addClass('error').text('Could not reach the server. Please try again.').show();
        $btn.prop('disabled', false).text('Log In');
      });
  });

})(jQuery);
