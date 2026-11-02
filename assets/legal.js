// Shared behaviour for the legal pages. The theme is applied early by an inline snippet in <head>.

const THEME_KEY = 'legal-theme';
const THEMES = ['system', 'light', 'dark'];
const LABELS = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

// Theme: cycles system -> light -> dark, remembered per browser
const themeButton = document.querySelector('[data-theme-toggle]');
if (themeButton) {
    let current = document.documentElement.dataset.theme || 'system';
    const show = () => {
        themeButton.textContent = LABELS[current];
        themeButton.setAttribute('aria-label', `${LABELS[current]}. Change theme`);
    };
    themeButton.hidden = false;
    show();
    themeButton.addEventListener('click', () => {
        current = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
        if (current === 'system') delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = current;
        try {
            if (current === 'system') localStorage.removeItem(THEME_KEY);
            else localStorage.setItem(THEME_KEY, current);
        } catch { /* storage unavailable: theme lasts for this visit */ }
        show();
    });
}

// Contents: open on wide screens, and mark the section being read
const toc = document.querySelector('.toc details');
if (toc && matchMedia('(min-width: 961px)').matches) toc.open = true;

const tocLinks = new Map([...document.querySelectorAll('.toc a')].map((a) => [a.hash.slice(1), a]));
const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        tocLinks.forEach((link, id) => {
            const on = id === entry.target.id;
            link.classList.toggle('is-current', on);
            if (on) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
        });
    }
}, { rootMargin: '0px 0px -70% 0px' });
document.querySelectorAll('.doc section[id]').forEach((s) => observer.observe(s));

// Print / save as PDF
const printButton = document.querySelector('[data-print]');
if (printButton) {
    printButton.hidden = false;
    printButton.addEventListener('click', () => window.print());
}

// Backup email: stored reversed + base64 so it isn't in the page source as plain text
const reveal = document.querySelector('[data-reveal-email]');
if (reveal) {
    reveal.hidden = false;
    reveal.addEventListener('click', () => {
        const address = atob(reveal.dataset.revealEmail).split('').reverse().join('');
        const link = document.createElement('a');
        link.href = `mailto:${address}`;
        link.textContent = address;
        reveal.replaceWith(link);
        link.focus();
    });
}
