// Year
  document.getElementById('year').textContent = new Date().getFullYear();

  // Mobile menu
  const menuToggle = document.getElementById('menuToggle');
  const mobileMenu = document.getElementById('mobileMenu');
  menuToggle.addEventListener('click', () => {
    const isOpen = mobileMenu.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', isOpen);
  });
  mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    mobileMenu.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
  }));

  // App access popup
  const appAccessModal = document.getElementById('appAccessModal');
  const appAccessTriggers = document.querySelectorAll('.js-app-access');
  const appAccessClosers = document.querySelectorAll('[data-close-app-access]');
  let lastFocusedBeforeModal = null;

  const openAppAccessModal = () => {
    if (!appAccessModal) return;
    lastFocusedBeforeModal = document.activeElement;
    appAccessModal.classList.add('open');
    appAccessModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    const firstButton = appAccessModal.querySelector('button, a');
    if (firstButton) firstButton.focus();
  };

  const closeAppAccessModal = () => {
    if (!appAccessModal) return;
    appAccessModal.classList.remove('open');
    appAccessModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function') {
      lastFocusedBeforeModal.focus();
    }
  };

  appAccessTriggers.forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      openAppAccessModal();
    });
  });

  appAccessClosers.forEach(closer => {
    closer.addEventListener('click', closeAppAccessModal);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && appAccessModal && appAccessModal.classList.contains('open')) {
      closeAppAccessModal();
    }
  });

  // Respect reduced-motion preference throughout
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Scroll reveal — animates each element only the first time it enters view
  const revealEls = document.querySelectorAll('.reveal, .fx-rise, .fx-clip, .fx-scale-in');
  if (prefersReduced) {
    revealEls.forEach(el => el.classList.add('in'));
  } else if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('in'));
  }

  // Hero: load-in sequence (background fade+scale, then staggered text/panel reveal)
  const heroBg = document.getElementById('heroBg');
  const heroFxEls = document.querySelectorAll('.hero .fx-rise');
  if (prefersReduced) {
    if (heroBg) heroBg.classList.add('in');
    heroFxEls.forEach(el => el.classList.add('in'));
  } else {
    requestAnimationFrame(() => {
      if (heroBg) heroBg.classList.add('in');
      heroFxEls.forEach(el => {
        const delay = 300 + (parseInt(el.dataset.d || '0', 10) * 100);
        setTimeout(() => el.classList.add('in'), delay);
      });
    });
  }

  // Tender checklist: sequential stagger reveal, once, on scroll into view
  const checklist = document.getElementById('tenderChecklist');
  if (checklist) {
    const items = checklist.querySelectorAll('li');
    const revealChecklist = () => {
      items.forEach((li, i) => setTimeout(() => li.classList.add('in'), prefersReduced ? 0 : i * 75));
    };
    if (prefersReduced) {
      revealChecklist();
    } else if ('IntersectionObserver' in window) {
      const cio = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting) { revealChecklist(); cio.unobserve(e.target); } });
      }, { threshold: 0.3 });
      cio.observe(checklist);
    } else {
      revealChecklist();
    }
  }

  // Scorecard metrics: bars fill + numbers count up once, on scroll into view
  const scMetrics = document.getElementById('scMetrics');
  if (scMetrics) {
    const animateMetrics = () => {
      scMetrics.querySelectorAll('.bar-fill').forEach(bar => {
        bar.style.width = bar.dataset.target + '%';
      });
      scMetrics.querySelectorAll('.sm-value').forEach(val => {
        const target = parseFloat(val.dataset.target || '0');
        const suffix = val.dataset.suffix || '';
        const decimals = parseInt(val.dataset.decimal || '0', 10);
        if (prefersReduced) { val.textContent = target.toFixed(decimals) + suffix; return; }
        const duration = 700, start = performance.now();
        const step = (now) => {
          const p = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          val.textContent = (target * eased).toFixed(decimals) + suffix;
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    };
    if ('IntersectionObserver' in window) {
      const mio = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting) { animateMetrics(); mio.unobserve(e.target); } });
      }, { threshold: 0.3 });
      mio.observe(scMetrics);
    } else {
      animateMetrics();
    }
  }

  // Walkthrough tabs
  const tabs = document.querySelectorAll('.walk-tab');
  const panels = document.querySelectorAll('.walk-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    });
  });

  // Beta form validation + submission
  const form = document.getElementById('beta-form');
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    let valid = true;
    const fields = form.querySelectorAll('.f-field');
    const status = document.getElementById('formStatus');
    const submitButton = form.querySelector('button[type="submit"]');

    if (status) {
      status.textContent = '';
      status.classList.remove('error', 'success');
    }

    fields.forEach(f => {
      const input = f.querySelector('input, select, textarea');
      if (!input) return;
      if (input.hasAttribute('required')) {
        const val = (input.value || '').trim();
        let ok = val.length > 0;
        if (input.type === 'email' && ok) {
          ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
        }
        f.classList.toggle('invalid', !ok);
        if (!ok) valid = false;
      }
    });
    const consent = document.getElementById('consent');
    if (!consent.checked) { valid = false; consent.focus(); }

    if (!valid) return;

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Sending...';
    }

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' }
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        throw new Error(result.message || 'We could not send your request. Please try again.');
      }

      document.getElementById('formFields').style.display = 'none';
      document.getElementById('formSuccess').classList.add('show');
    } catch (error) {
      if (status) {
        status.textContent = error.message || 'We could not send your request. Please try again using the contact button.';
        status.classList.add('error');
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Request beta access';
      }
    }
  });
