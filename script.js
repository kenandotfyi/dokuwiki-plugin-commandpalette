console.log("cmdpalette script loaded");

let cmdpResultsRequest = 0;
let cmdpSearchTimer = null;
let cmdpResultsController = null;

function cancelPendingCmdpResults() {
    if (cmdpSearchTimer !== null) {
        window.clearTimeout(cmdpSearchTimer);
        cmdpSearchTimer = null;
    }

    if (cmdpResultsController) {
        cmdpResultsController.abort();
        cmdpResultsController = null;
    }

    cmdpResultsRequest += 1;
    return cmdpResultsRequest;
}

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
        '<div id="cmdp-dialog" role="dialog" aria-modal="true" aria-label="Command palette">' +
            '<div id="cmdp-search-row">' +
                '<a id="cmdp-home-button" href="' + DOKU_BASE + '" aria-label="Home" title="Home"></a>' +
                '<svg id="cmdp-search-icon" viewBox="0 0 24 24" aria-hidden="true">' +
                    '<circle cx="11" cy="11" r="7"></circle>' +
                    '<path d="m20 20-4-4"></path>' +
                '</svg>' +
                '<input id="cmdp-input" type="text" placeholder="Search pages and actions..." autocomplete="on" aria-label="Search pages and actions">' +
                '<kbd id="cmdp-escape-hint">esc</kbd>' +
            '</div>' +
            '<div id="cmdp-actions" aria-label="Page actions"></div>' +
            '<section id="cmdp-recents" aria-label="Recent pages" hidden>' +
                '<div id="cmdp-recents-heading">Recents</div>' +
                '<div id="cmdp-recents-links"></div>' +
            '</section>' +
            '<div id="cmdp-results"></div>' +
        '</div>';

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

        modal.style.display = 'flex';
        document.dispatchEvent(new Event('cmdpalette:open'));
        const actions = document.getElementById('cmdp-actions');
        if (actions) actions.hidden = Boolean(input.value.trim());
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
        const actions = document.getElementById('cmdp-actions');
        const recents = document.getElementById('cmdp-recents');

        if (!modal || !input || !results) return;

        cancelPendingCmdpResults();
        modal.style.display = 'none';
        input.value = '';
        if (actions) actions.hidden = false;
        if (recents) recents.hidden = true;
        results.innerHTML = '';
        results.removeAttribute('aria-busy');
    }
});

async function loadDefaultIndex(results) {
    const requestId = cancelPendingCmdpResults();
    const controller = new AbortController();
    cmdpResultsController = controller;

    try {
        const currentPageId = window.JSINFO && JSINFO.id;
        const url = DOKU_BASE + "lib/exe/ajax.php?call=cmdpalette_index" +
            (currentPageId ? "&id=" + encodeURIComponent(currentPageId) : "");
        const response = await fetch(url, {
            credentials: "same-origin",
            signal: controller.signal
        });
        const html = await response.text();
        if (requestId !== cmdpResultsRequest) return;
        results.innerHTML = html;
        initFolderToggles(results);
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error("Failed to load default index:", err);
        }
    } finally {
        if (cmdpResultsController === controller) {
            cmdpResultsController = null;
        }
    }
}

/** Render DokuWiki's full search results inside the palette instead of
 * navigating away from the current page. */
async function loadFullSearchResults(query, namespace = '') {
    const results = document.getElementById('cmdp-results');
    if (!results || !query) return;

    const requestId = cancelPendingCmdpResults();
    const controller = new AbortController();
    cmdpResultsController = controller;
    results.setAttribute('aria-busy', 'true');
    results.innerHTML = '<div class="cmdp-search-state">Searching the wiki…</div>';

    try {
        const url = new URL(DOKU_BASE + 'doku.php', window.location.origin);
        url.searchParams.set('do', 'search');
        url.searchParams.set('q', query);
        if (namespace) url.searchParams.set('id', namespace);

        const response = await fetch(url.href, {
            credentials: 'same-origin',
            signal: controller.signal
        });
        if (!response.ok) throw new Error('Search request failed (' + response.status + ')');

        const html = await response.text();
        if (requestId !== cmdpResultsRequest) return;

        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const fullTextMatches = parsed.querySelector('.search_fulltextresult');
        const noResults = parsed.querySelector('.nothing');
        results.replaceChildren();

        const appendSection = (title, source) => {
            if (!source) return;
            const section = document.createElement('section');
            section.className = 'cmdp-search-section';
            const heading = document.createElement('h2');
            heading.className = 'cmdp-search-section-title';
            heading.textContent = title;
            section.appendChild(heading);

            const content = document.importNode(source, true);
            // Resolve relative DokuWiki links against the search response URL
            // because these nodes are moved into a document fragment.
            content.querySelectorAll('[href]').forEach((link) => {
                try {
                    link.href = new URL(link.getAttribute('href'), response.url || url.href).href;
                } catch (_error) {
                    // Keep malformed or special links as rendered by DokuWiki.
                }
            });
            content.querySelectorAll('script, form.search-results-form').forEach((node) => node.remove());
            section.appendChild(content);
            results.appendChild(section);
        };

        appendSection('Full text results', fullTextMatches);

        if (!results.childElementCount && noResults) {
            const message = document.createElement('div');
            message.className = 'cmdp-search-state';
            message.textContent = noResults.textContent.trim();
            results.appendChild(message);
        } else if (!results.childElementCount) {
            const message = document.createElement('div');
            message.className = 'cmdp-search-state';
            message.textContent = 'No search results were returned.';
            results.appendChild(message);
        }
    } catch (error) {
        if (error.name !== 'AbortError' && requestId === cmdpResultsRequest) {
            console.error('Full wiki search failed:', error);
            results.innerHTML = '<div class="cmdp-search-state">Could not load search results.</div>';
        }
    } finally {
        if (requestId === cmdpResultsRequest) results.removeAttribute('aria-busy');
        if (cmdpResultsController === controller) cmdpResultsController = null;
    }
}

/**
 * Add a separate disclosure control to each namespace row. The namespace
 * link stays a normal link, while the adjacent button expands its children.
 */
function initFolderToggles(container) {
    const items = container.querySelectorAll('li');

    items.forEach((li) => {
        const nestedList = li.querySelector(':scope > ul');
        // Find the anchor that belongs to THIS li specifically — not one
        // buried inside the nested <ul> — regardless of any wrapping
        // <div class="li"> the index renderer puts around it.
        const link = Array.from(li.querySelectorAll('a')).find(
            (a) => a.closest('li') === li
        );
        if (!link || link.classList.contains('cmdp-tree-link')) return;

        link.classList.add('cmdp-tree-link');
        const row = document.createElement('div');
        row.className = 'cmdp-tree-row';
        link.parentNode.insertBefore(row, link);

        if (nestedList) {
            nestedList.style.display = 'none';
            li.classList.add('cmdp-folder', 'cmdp-closed');

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'cmdp-folder-toggle';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-label', 'Expand ' + link.textContent.trim());
            toggle.addEventListener('click', () => {
                const isOpen = li.classList.contains('cmdp-open');
                nestedList.style.display = isOpen ? 'none' : 'block';
                li.classList.toggle('cmdp-open', !isOpen);
                li.classList.toggle('cmdp-closed', isOpen);
                toggle.setAttribute('aria-expanded', String(!isOpen));
                toggle.setAttribute(
                    'aria-label',
                    (isOpen ? 'Expand ' : 'Collapse ') + link.textContent.trim()
                );
            });
            row.appendChild(toggle);
        } else {
            const gutter = document.createElement('span');
            gutter.className = 'cmdp-tree-gutter';
            gutter.setAttribute('aria-hidden', 'true');
            row.appendChild(gutter);
        }

        row.appendChild(link);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const modalEl = ensureModal();

    const input = document.getElementById("cmdp-input");
    const actions = document.getElementById("cmdp-actions");
    const recents = document.getElementById("cmdp-recents");
    const recentLinks = document.getElementById("cmdp-recents-links");
    const results = document.getElementById("cmdp-results");

    if (!input || !actions || !recents || !recentLinks || !results) return;

    function closePalette() {
        cancelPendingCmdpResults();
        modalEl.style.display = 'none';
        input.value = '';
        actions.hidden = false;
        recents.hidden = true;
        results.innerHTML = '';
        results.removeAttribute('aria-busy');
    }

    modalEl.addEventListener('click', (event) => {
        if (event.target === modalEl) closePalette();
    });

    const actionIcons = {
        home: '<path d="m3 10 9-7 9 7"></path><path d="M5 9v11h14V9M9 20v-6h6v6"></path>',
        edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"></path>',
        admin: '<path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6Z"></path><path d="m9 12 2 2 4-4"></path>',
        extensions: '<path d="M8 7V3m8 4V3M7 7h10v4a5 5 0 0 1-10 0V7ZM12 16v5m-4 0h8"></path>',
        config: '<path d="M4 6h6m4 0h6M4 12h3m4 0h9M4 18h8m4 0h4"></path><circle cx="12" cy="6" r="2"></circle><circle cx="9" cy="12" r="2"></circle><circle cx="14" cy="18" r="2"></circle>',
        annotations: '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.5-.8L4 20l1.8-4.3A7.5 7.5 0 1 1 20 11.5Z"></path><path d="M8 11h.01M12 11h.01M16 11h.01"></path>',
        logs: '<path d="M8 6h13M8 12h13M8 18h13"></path><path d="M3 6h.01M3 12h.01M3 18h.01"></path>',
        newPage: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6M12 12v6M9 15h6"></path>',
        delete: '<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6"></path><path d="M10 11v5m4-5v5"></path>',
        media: '<rect x="3" y="3" width="18" height="14" rx="0"></rect><circle cx="8.5" cy="8" r="1.5"></circle><path d="m21 13-5-5L5 17m4 4h12V9"></path>',
        swap: '<path d="M17 3l4 4-4 4"></path><path d="M3 7h18M7 21l-4-4 4-4"></path><path d="M21 17H3"></path>',
        closeAll: '<rect x="3" y="3" width="8" height="8"></rect><rect x="13" y="13" width="8" height="8"></rect><path d="m15 5 4 4m0-4-4 4M5 15l4 4m0-4-4 4"></path>'
    };

    const homeButton = document.getElementById('cmdp-home-button');
    if (homeButton) {
        const homeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        homeIcon.setAttribute('viewBox', '0 0 24 24');
        homeIcon.setAttribute('aria-hidden', 'true');
        homeIcon.setAttribute('focusable', 'false');
        homeIcon.innerHTML = actionIcons.home;
        homeButton.appendChild(homeIcon);
    }

    const actionGroups = new Map();
    let recentRequest = 0;

    function getActionGroup(category) {
        if (!category) return actions;

        if (actionGroups.has(category.id)) return actionGroups.get(category.id);

        const group = document.createElement('div');
        group.className = 'cmdp-action-group cmdp-action-group--' + category.id;
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', category.title || (category.id === 'page' ? 'Page actions' : 'Actions'));

        if (category.title) {
            const heading = document.createElement('span');
            heading.className = 'cmdp-action-group-title';
            heading.textContent = category.title;
            group.appendChild(heading);
        }
        actions.appendChild(group);
        actionGroups.set(category.id, group);
        return group;
    }

    function addAction(label, iconName, sourceLink, href, onClick, category, iconOnly = false) {
        if (!sourceLink && !href && !onClick) return;

        const link = document.createElement('a');
        link.className = 'cmdp-action';
        if (iconOnly) link.classList.add('cmdp-action--icon-only');
        link.href = sourceLink?.href || href || '#';
        link.setAttribute('aria-label', label);
        link.title = label;

        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('aria-hidden', 'true');
        icon.setAttribute('focusable', 'false');
        icon.innerHTML = actionIcons[iconName];
        link.appendChild(icon);

        if (!iconOnly) {
            const text = document.createElement('span');
            text.textContent = label;
            link.appendChild(text);
        }

        link.addEventListener('click', (event) => {
            event.preventDefault();
            closePalette();

            if (onClick) {
                onClick();
            } else if (sourceLink) {
                // Reuse the original menu item so its own permission checks,
                // prompt, and confirmation behavior remain in effect.
                sourceLink.click();
            } else {
                window.location.href = link.href;
            }
        });
        getActionGroup(category).appendChild(link);
    }

    function buildActions() {
        recentRequest += 1;
        actions.replaceChildren();
        recentLinks.replaceChildren();
        recents.hidden = true;
        actionGroups.clear();

        const editLink = document.querySelector(
            '#dokuwiki__pagetools .action.edit a, #dokuwiki__pagetools a[href*="do=edit"]'
        );
        const adminLink = document.querySelector(
            '.simpl-toolbar .action.admin a, .simpl-toolbar a[href*="do=admin"]'
        );
        const newPageLink = document.querySelector(
            '#dokuwiki__pagetools a.plugin_pagebuttons_newpage, a.plugin_pagebuttons_newpage'
        );
        const deleteLink = document.querySelector(
            '#dokuwiki__pagetools a.plugin_pagebuttons_deletepage, a.plugin_pagebuttons_deletepage'
        );
        const homeLink = document.querySelector(
            '.simpl-toolbar .logo a, .simpl-toolbar a[accesskey="h"]'
        );
        const mediaLink = document.querySelector(
            '.simpl-toolbar .action.media a, .simpl-toolbar a[href*="do=media"]'
        );
        const currentNamespace = (window.JSINFO && JSINFO.namespace) || '';
        const mediaHref = DOKU_BASE + 'doku.php?do=media' + (currentNamespace
            ? '&ns=' + encodeURIComponent(currentNamespace)
            : '');
        const adminBase = DOKU_BASE + 'doku.php?do=admin&page=';

        const pageActions = { id: 'page', title: 'Page' };
        const siteActions = { id: 'site', title: 'Wiki' };
        const panelActions = { id: 'panel', title: 'Panel' };

        if (homeButton) {
            homeButton.href = homeLink?.href || DOKU_BASE;
            homeButton.onclick = (event) => {
                event.preventDefault();
                closePalette();
                if (homeLink) homeLink.click();
                else window.location.href = homeButton.href;
            };
        }

        addAction('Edit page', 'edit', editLink, null, null, pageActions);
        addAction('Delete page', 'delete', deleteLink, null, null, pageActions);
        addAction('New page', 'newPage', newPageLink, null, newPageLink ? null : () => {
            const title = window.prompt('New page name:');
            if (!title || !title.trim()) return;

            const pageId = currentNamespace ? currentNamespace + ':' + title.trim() : title.trim();
            window.location.href = DOKU_BASE + 'doku.php?id=' +
                encodeURIComponent(pageId) + '&do=edit';
        }, pageActions);
        addAction('Admin', 'admin', adminLink, DOKU_BASE + 'doku.php?do=admin', null, siteActions);
        addAction('Media', 'media', mediaLink, mediaHref, null, siteActions);
        addAction('Extensions', 'extensions', null, adminBase + 'extension', null, siteActions);
        addAction('Config', 'config', null, adminBase + 'config', null, siteActions);
        addAction('Annotations', 'annotations', null, adminBase + 'annotations', null, siteActions);
        addAction('Logs', 'logs', null, adminBase + 'logviewer', null, siteActions);

        const currentPageId = (window.JSINFO && JSINFO.id) || '';
        const currentUrl = new URL(window.location.href);
        const openPanelIds = currentUrl.searchParams.getAll('p').filter(Boolean);
        const firstPanelId = openPanelIds[0];
        const hasOnePanel = openPanelIds.length === 1;
        const panelCount = openPanelIds.length;
        if (panelCount > 0 && typeof window.infinitePanelsCloseAllAdditionalPanes === 'function') {
            addAction('Close all panes', 'closeAll', null, null, () => {
                window.infinitePanelsCloseAllAdditionalPanes();
            }, panelActions);
        }
        if (currentPageId && firstPanelId && hasOnePanel) {
            addAction('Swap panels', 'swap', null, null, () => {
                const nextUrl = new URL(window.location.href);
                const baseUrl = new URL(DOKU_BASE, window.location.origin);
                const basePath = baseUrl.pathname.endsWith('/') ? baseUrl.pathname : `${baseUrl.pathname}/`;
                nextUrl.pathname = `${basePath}${encodeURIComponent(firstPanelId).replace(/%3A/gi, ':')}`;
                nextUrl.searchParams.delete('p');
                nextUrl.searchParams.append('p', currentPageId);
                const query = nextUrl.searchParams.toString().replace(/(^|&)p=([^&]*)/g, (_match, prefix, value) => {
                    return `${prefix}p=${value.replace(/%3A/gi, ':')}`;
                });
                window.location.href = `${nextUrl.origin}${nextUrl.pathname}${query ? `?${query}` : ''}${nextUrl.hash}`;
            }, panelActions);
        }

        actions.hidden = actions.childElementCount === 0;
    }

    async function loadRecentTrace() {
        const requestId = ++recentRequest;
        const currentPageId = (window.JSINFO && JSINFO.id) || '';

        try {
            const url = DOKU_BASE + 'lib/exe/ajax.php?call=cmdpalette_recent' +
                (currentPageId ? '&id=' + encodeURIComponent(currentPageId) : '');
            const response = await fetch(url, { credentials: 'same-origin' });
            if (!response.ok) throw new Error('Recent page request failed (' + response.status + ')');
            const recentPages = await response.json();
            if (requestId !== recentRequest || !Array.isArray(recentPages) || !recentPages.length) return;

            recentPages.forEach((page) => {
                if (!page.url || !page.title) return;
                const link = document.createElement('a');
                link.className = 'cmdp-recent-link';
                link.href = page.url;
                link.textContent = page.title;
                link.title = page.id || page.title;
                link.setAttribute('aria-label', page.title);
                link.addEventListener('click', (event) => {
                    event.preventDefault();
                    closePalette();
                    if (event.shiftKey) {
                        window.location.href = link.href;
                        return;
                    }

                    const openInPanel = window.infinitepanelsOpenPage;
                    if (typeof openInPanel === 'function') openInPanel(link.href);
                    else window.location.href = link.href;
                });
                recentLinks.appendChild(link);
            });
            recents.hidden = recentLinks.childElementCount === 0 || Boolean(input.value.trim());
        } catch (error) {
            console.error('Failed to load recent pages:', error);
        }
    }

    buildActions();
    document.addEventListener('cmdpalette:open', () => {
        buildActions();
        loadRecentTrace();
    });

    input.addEventListener("input", () => {
        const q = input.value.trim();
        actions.hidden = q.length > 0;
        recents.hidden = q.length > 0 || recentLinks.childElementCount === 0;
        const requestId = cancelPendingCmdpResults();
        results.removeAttribute('aria-busy');

        if (!q) {
            loadDefaultIndex(results);
            return;
        }

        cmdpSearchTimer = window.setTimeout(async () => {
            cmdpSearchTimer = null;
            const controller = new AbortController();
            cmdpResultsController = controller;

            try {
                const url = DOKU_BASE +
                    "lib/exe/ajax.php?call=qsearch&q=" +
                    encodeURIComponent(q);

                const response = await fetch(url, {
                    credentials: "same-origin",
                    signal: controller.signal
                });
                const html = await response.text();

                if (requestId !== cmdpResultsRequest || input.value.trim() !== q) return;
                results.innerHTML = html;
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error("Search failed:", err);
                }
            } finally {
                if (cmdpResultsController === controller) {
                    cmdpResultsController = null;
                }
            }
        }, 200);
    });

    // Clicking a result: open it in InfinitePanels when that
    // plugin is active, and close the palette since we've "gone" there.
    // Folder disclosure buttons are separate controls, so every page link
    // in the tree follows the same navigation behavior as search results.
    results.addEventListener("click", (e) => {
        const a = e.target.closest('a');
        if (!a) return;

        if (e.shiftKey) {
            e.preventDefault();
            window.location.href = a.href;
            return;
        }

        const resultUrl = new URL(a.href, window.location.href);
        if (resultUrl.searchParams.get('do') === 'search') {
            e.preventDefault();
            const nextQuery = resultUrl.searchParams.get('q') || input.value.trim();
            const namespace = resultUrl.searchParams.get('id') || '';
            if (nextQuery) loadFullSearchResults(nextQuery, namespace);
            return;
        }

        const openInPanel = window.infinitepanelsOpenPage;
        if (typeof openInPanel === 'function') {
            e.preventDefault();
            openInPanel(a.href);
            closePalette();
        }
        // else: no panel plugin is active, so let the link navigate normally
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

    // Enter always performs a full-text search for the typed query and shows
    // DokuWiki's results inside the palette.
    // Shift+Enter opens the focused result (or the first result) as a
    // real, solo navigation instead of using the right panel.
    modalEl.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;

        const active = document.activeElement;
        if (active?.classList.contains('cmdp-recent-link')) {
            if (e.shiftKey) {
                e.preventDefault();
                closePalette();
                window.location.href = active.href;
            }
            return;
        }
        const isFolderToggle = active && active.classList.contains('cmdp-folder-toggle');
        if (!e.shiftKey && isFolderToggle) return; // Let the button's native Enter activate it.

        if (!e.shiftKey) {
            e.preventDefault();
            const q = input.value.trim();
            if (!q) return;
            loadFullSearchResults(q);
            return;
        }

        const isResultLink = active && active.tagName === 'A' && results.contains(active);
        const toggleLink = isFolderToggle
            ? active.closest('.cmdp-tree-row')?.querySelector('a')
            : null;
        const target = isResultLink ? active : (toggleLink || results.querySelector('a'));

        if (!target) return;

        e.preventDefault();
        window.location.href = target.href;
    });
});
