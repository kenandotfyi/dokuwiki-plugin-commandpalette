console.log("cmdpalette script loaded");

// Build the modal ourselves, once, as a direct child of <body>. It used
// to be echoed as part of the page's own content (via a PHP hook), which
// meant panelnav's right panel - which fetches and extracts another full
// page's content - ended up with a second, inert copy of this same
// markup (duplicate ids) nested inside it. Creating it purely in JS means
// it's never part of any page's fetchable/extractable content at all.
function ensureModal() {
    let modal = document.getElementById('cmdp-search-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'cmdp-search-modal';
    modal.innerHTML =
        '<div id="cmdp-header">Command Palette</div>' +
        '<input id="cmdp-input" type="text" placeholder="press <Esc> to close" autocomplete="on">' +
        '<div id="cmdp-results"></div>';

    document.body.appendChild(modal);
    return modal;
}

document.addEventListener('keydown', (e) => {
    // Only activate on Ctrl + Shift + K
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'k'){
        e.preventDefault();

        const modal = ensureModal();
        const input = document.getElementById('cmdp-input');
        const results = document.getElementById('cmdp-results');

        if (!modal || !input || !results) return;

        modal.style.display = 'block';
        input.focus({ preventScroll: true });
        requestAnimationFrame(() => {
            if (modal.style.display !== 'none') {
                input.focus({ preventScroll: true });
            }
        });

        // Show the default page index when opening with an empty field
        if (!input.value.trim()) {
            loadDefaultIndex(results);
        }
    }

    // Escape closes the modal
    if (e.key === 'Escape') {
        const modal = document.getElementById('cmdp-search-modal');
        const input = document.getElementById('cmdp-input');
        const results = document.getElementById('cmdp-results');

        if (!modal || !input || !results) return;

        modal.style.display = 'none';
        input.value = '';
        results.innerHTML = '';
    }
});

async function loadDefaultIndex(results) {
    try {
        const url = DOKU_BASE + "lib/exe/ajax.php?call=cmdpalette_index";
        const response = await fetch(url, { credentials: "same-origin" });
        const html = await response.text();
        results.innerHTML = html;
        initFolderToggles(results);
    } catch (err) {
        console.error("Failed to load default index:", err);
    }
}

/**
 * Turn folder links into expand/collapse toggles instead of navigation.
 * Works structurally: any <li> that directly contains a nested <ul> is
 * treated as a folder — no dependency on indexmenu's own class names.
 */
function initFolderToggles(container) {
    const items = container.querySelectorAll('li');

    items.forEach((li) => {
        const nestedList = li.querySelector(':scope > ul');
        if (!nestedList) return; // leaf page, leave it as a normal link

        // Find the anchor that belongs to THIS li specifically — not one
        // buried inside the nested <ul> — regardless of any wrapping
        // <div class="li"> the index renderer puts around it.
        const link = Array.from(li.querySelectorAll('a')).find(
            (a) => a.closest('li') === li
        );
        if (!link) return;

        // start collapsed
        nestedList.style.display = 'none';
        li.classList.add('cmdp-folder', 'cmdp-closed');

        link.addEventListener('click', (e) => {
            e.preventDefault();
            const isOpen = li.classList.contains('cmdp-open');

            nestedList.style.display = isOpen ? 'none' : 'block';
            li.classList.toggle('cmdp-open', !isOpen);
            li.classList.toggle('cmdp-closed', isOpen);
        });
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const modalEl = ensureModal();

    const input = document.getElementById("cmdp-input");
    const results = document.getElementById("cmdp-results");

    if (!input || !results) return;

    function closePalette() {
        modalEl.style.display = 'none';
        input.value = '';
        results.innerHTML = '';
    }

    input.addEventListener("input", async () => {
        const q = input.value.trim();

        if (!q) {
            loadDefaultIndex(results);
            return;
        }

        try {
            const url = DOKU_BASE +
                "lib/exe/ajax.php?call=qsearch&q=" +
                encodeURIComponent(q);

            console.log("Searching:", url);

            const response = await fetch(url, { credentials: "same-origin" });
            const html = await response.text();

            results.innerHTML = html;
        } catch (err) {
            console.error("Search failed:", err);
        }
    });

    // Clicking a result: open it in panelnav's right panel when that
    // plugin is active, and close the palette since we've "gone" there.
    // Folder toggles (from the default index view) handle their own
    // click already, so leave those alone.
    results.addEventListener("click", (e) => {
        const a = e.target.closest('a');
        if (!a) return;

        if (a.closest('li.cmdp-folder')) return; // folder toggle, not a page link

        if (e.shiftKey) {
            e.preventDefault();
            window.location.href = a.href;
            return;
        }

        if (typeof window.panelnavOpenInRightPanel === 'function') {
            e.preventDefault();
            window.panelnavOpenInRightPanel(a.href);
            closePalette();
        }
        // else: panelnav isn't active, let the link navigate normally
    });

    // Move focus to a result only after the pointer actually moves over it.
    // Showing the modal can place a result beneath a stationary cursor and
    // fire mouseover; that must not steal focus from the search input.
    results.addEventListener("pointermove", (e) => {
        const a = e.target.closest('a');
        if (a && results.contains(a)) {
            a.focus({ preventScroll: true });
        }
    });

    // Enter always performs a full-text search for the typed query.
    // Shift+Enter opens the focused result (or the first result) as a
    // real, solo navigation instead of using the right panel.
    modalEl.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;

        if (!e.shiftKey) {
            e.preventDefault();
            const q = input.value.trim();
            if (!q) return;
            window.location.href = DOKU_BASE + "doku.php?do=search&q=" + encodeURIComponent(q);
            return;
        }

        const active = document.activeElement;
        const isResultLink = active && active.tagName === 'A' && results.contains(active);
        const target = isResultLink ? active : results.querySelector('a');

        if (!target) return;

        e.preventDefault();

        // Folder toggles: delegate to their own existing click handler
        // (re-implemented as a synthetic click) rather than treating
        // them as a page to open.
        if (target.closest('li.cmdp-folder')) {
            target.click();
            return;
        }

        window.location.href = target.href;
    });
});
