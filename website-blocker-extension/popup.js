// Popup script for Focus Mode extension

document.addEventListener('DOMContentLoaded', () => {
  const setupView = document.getElementById('setupView');
  const activeView = document.getElementById('activeView');
  const siteInput = document.getElementById('siteInput');
  const addSiteBtn = document.getElementById('addSiteBtn');
  const allowedSitesList = document.getElementById('allowedSitesList');
  const durationBtns = document.querySelectorAll('.duration-btn');
  const customMinutes = document.getElementById('customMinutes');
  const startBtn = document.getElementById('startBtn');
  const endBtn = document.getElementById('endBtn');
  const timerText = document.getElementById('timerText');
  const focusSitesList = document.getElementById('focusSitesList');

  let allowedSites = [];
  let selectedDuration = 60; // Default 60 minutes
  let timerInterval;

  // Check current status
  checkStatus();

  // Duration button clicks
  durationBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      durationBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedDuration = parseInt(btn.dataset.minutes);
      customMinutes.value = '';
    });
  });

  // Custom duration input
  customMinutes.addEventListener('input', () => {
    if (customMinutes.value) {
      durationBtns.forEach(b => b.classList.remove('active'));
      selectedDuration = parseInt(customMinutes.value) || 60;
    }
  });

  // Add site button
  addSiteBtn.addEventListener('click', addSite);
  siteInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addSite();
  });

  // Start focus session
  startBtn.addEventListener('click', () => {
    // Add current input if not empty
    if (siteInput.value.trim()) {
      addSite();
    }

    if (allowedSites.length === 0) {
      alert('Please add at least one website to focus on!');
      return;
    }

    chrome.runtime.sendMessage({
      action: 'startFocus',
      allowedSites: allowedSites,
      duration: selectedDuration
    }, (response) => {
      if (response && response.success) {
        checkStatus();
      }
    });
  });

  // End session early
  endBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to end your focus session early?')) {
      chrome.runtime.sendMessage({ action: 'stopFocus' }, () => {
        checkStatus();
      });
    }
  });

  function addSite() {
    let site = siteInput.value.trim().toLowerCase();
    if (!site) return;

    // Clean up the URL
    site = site.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];

    if (!allowedSites.includes(site)) {
      allowedSites.push(site);
      renderAllowedSites();
    }
    siteInput.value = '';
  }

  function removeSite(site) {
    allowedSites = allowedSites.filter(s => s !== site);
    renderAllowedSites();
  }

  function renderAllowedSites() {
    allowedSitesList.innerHTML = '';
    allowedSites.forEach(site => {
      const div = document.createElement('div');
      div.className = 'site-tag';
      div.innerHTML = `
        <span>${site}</span>
        <button class="remove-tag" data-site="${site}">×</button>
      `;
      allowedSitesList.appendChild(div);
    });

    document.querySelectorAll('.remove-tag').forEach(btn => {
      btn.addEventListener('click', (e) => {
        removeSite(e.target.dataset.site);
      });
    });
  }

  function checkStatus() {
    chrome.runtime.sendMessage({ action: 'getStatus' }, (data) => {
      if (data && data.focusMode && data.endTime > Date.now()) {
        showActiveView(data);
      } else {
        showSetupView();
      }
    });
  }

  function showSetupView() {
    setupView.style.display = 'block';
    activeView.style.display = 'none';
    allowedSites = [];
    renderAllowedSites();
    if (timerInterval) clearInterval(timerInterval);
  }

  function showActiveView(data) {
    setupView.style.display = 'none';
    activeView.style.display = 'block';

    // Show focus sites
    focusSitesList.innerHTML = '';
    (data.allowedSites || []).forEach(site => {
      const li = document.createElement('li');
      li.textContent = site;
      focusSitesList.appendChild(li);
    });

    // Start timer
    updateTimer(data.endTime);
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => updateTimer(data.endTime), 1000);
  }

  function updateTimer(endTime) {
    const remaining = Math.max(0, endTime - Date.now());
    
    if (remaining <= 0) {
      checkStatus();
      return;
    }

    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    timerText.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
});
