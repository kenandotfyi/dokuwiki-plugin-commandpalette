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
       // Load JS and CSS
        $controller->register_hook('TPL_METAHEADER_OUTPUT', 'BEFORE', $this, 'addAssets');
        // AJAX endpoint that renders the default page index list
        $controller->register_hook('AJAX_CALL_UNKNOWN', 'BEFORE', $this, 'ajaxIndex');
}

    public function addAssets(Event $event) {
        $event->data['script'][] = [
            'type' => 'text/javascript',
            'charset' => 'utf-8',
            '_data'   => '',
            'src'  => DOKU_PLUGIN.'commandpalette/script.js'
        ];
        $event->data['style'][] = [
            'type' => 'text/css',
            'charset' => 'utf-8',
            '_data'   => '',
            'href' => DOKU_PLUGIN.'commandpalette/style.css'
        ];
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

        // Adjust the indexmenu syntax/params below to match what you
        // already use in your sidebar (namespace, sort options, etc.)
        $renderInfo = [];
        $instructions = p_get_instructions('{{indexmenu>:}}');
        echo p_render('xhtml', $instructions, $renderInfo);
    }
}
