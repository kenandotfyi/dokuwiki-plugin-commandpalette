<?php

use dokuwiki\Extension\ActionPlugin;
use dokuwiki\Extension\EventHandler;
use dokuwiki\Extension\Event;

/**
 * DokuWiki Plugin cmdpalette (Action Component)
 *
 * @license GPL 2 http://www.gnu.org/licenses/gpl-2.0.html
 * @author Kenan Akinci <hey@kenan.fyi>
 */
class action_plugin_commandpalette extends ActionPlugin
{
    /** @inheritDoc */
    public function register(EventHandler $controller)
    {
        // AJAX endpoint that renders the default page index list
        $controller->register_hook('AJAX_CALL_UNKNOWN', 'BEFORE', $this, 'ajaxIndex');
        $controller->register_hook('AJAX_CALL_UNKNOWN', 'BEFORE', $this, 'ajaxRecent');
}

    /**
     * AJAX endpoint (call=cmdpalette_index) that renders the same
     * {{indexmenu>...}} syntax used elsewhere on the wiki, so the
     * palette can show it as a default, browsable list.
     */
    public function ajaxIndex(Event $event) {
        if ($event->data !== 'cmdpalette_index') return;

        $event->preventDefault();
        $event->stopPropagation();

        header('Content-Type: text/html; charset=utf-8');

        // Indexmenu reads $INFO['id'] while formatting namespace headpages.
        // AJAX requests do not necessarily have pageinfo initialized, even
        // though the index itself is rendered for the current wiki page.
        global $INFO;
        if (!is_array($INFO)) {
            $INFO = pageinfo();
        }

        // Use the configured indexmenu syntax so namespace and display
        // options can be adjusted in DokuWiki's Configuration Manager.
        $renderInfo = [];
        $instructions = p_get_instructions($this->getConf('indexmenu'));
        echo p_render('xhtml', $instructions, $renderInfo);
    }

    /** Return DokuWiki's visited-page breadcrumb history for the palette. */
    public function ajaxRecent(Event $event)
    {
        if ($event->data !== 'cmdpalette_recent') return;

        $event->preventDefault();
        $event->stopPropagation();
        header('Content-Type: application/json; charset=utf-8');

        global $ID, $INFO, $INPUT;
        $requestedId = $INPUT->get->str('id');
        if ($requestedId !== '') {
            $ID = cleanID($requestedId);
            $INFO = pageinfo();
        }

        $recentPages = [];
        foreach (breadcrumbs() as $id => $title) {
            $recentPages[] = [
                'id' => $id,
                'title' => $title,
                'url' => wl($id),
            ];
        }

        echo json_encode($recentPages, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
    }
}
