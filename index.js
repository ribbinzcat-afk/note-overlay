import { extension_settings, getContext, saveMetadataDebounced } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { debounce, resetScrollHeight } from '../../../utils.js';
import { debounce_timeout } from '../../../constants.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
import { t } from '../../../i18n.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../slash-commands/SlashCommandArgument.js';

// Must match the folder name exactly.
const extensionName = 'note-overlay';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

/**
 * Key inside `chat_metadata`. Notes live with the chat file, so they are exported,
 * imported and deleted along with the chat - same approach as Author's Note.
 * @see public/scripts/authors-note.js
 */
const METADATA_KEY = 'note_overlay_content';
const STORAGE_EXPANDED = 'NoteOverlay_expanded';

const defaultSettings = {
    enabled: true,
    showPreview: true,
    maxHeightVh: 40,
};

/** @type {HTMLElement} */ let root = null;
/** @type {HTMLTextAreaElement} */ let textarea = null;
/** @type {HTMLElement} */ let preview = null;

function settings() {
    return extension_settings[extensionName];
}

/**
 * `chat_metadata` is reassigned wholesale by ST whenever the chat changes
 * (public/script.js:7598), so the object reference must never be cached.
 * @returns {object} The metadata object of the chat that is open right now.
 */
function metadata() {
    return getContext().chatMetadata;
}

function hasChat() {
    return Boolean(getContext().getCurrentChatId());
}

function getNote() {
    return String(metadata()?.[METADATA_KEY] ?? '');
}

function setNote(value) {
    const meta = metadata();
    if (!meta) return;
    meta[METADATA_KEY] = value;
    // Already debounced at 1000ms and guarded against a mid-flight chat switch.
    saveMetadataDebounced();
}

// ---------------------------------------------------------------- UI

function updatePreview() {
    if (!preview) return;
    const note = getNote();
    const firstLine = note.split('\n').find(line => line.trim().length > 0) ?? '';
    preview.textContent = firstLine || t`Tap to write a note for this chat`;
    preview.classList.toggle('note-overlay-empty', !firstLine);
    root.classList.toggle('note-overlay-has-content', note.trim().length > 0);
}

const updatePreviewDebounced = debounce(updatePreview, debounce_timeout.short);

function isExpanded() {
    return root?.classList.contains('note-overlay-expanded');
}

function storedExpanded() {
    return getContext().accountStorage.getItem(STORAGE_EXPANDED) === 'true';
}

function setExpanded(expanded, { persist = true, focus = true } = {}) {
    if (!root) return;
    root.classList.toggle('note-overlay-expanded', expanded);
    root.querySelector('.note-overlay-caret')?.classList.toggle('fa-chevron-down', expanded);
    root.querySelector('.note-overlay-caret')?.classList.toggle('fa-chevron-up', !expanded);

    if (persist) {
        getContext().accountStorage.setItem(STORAGE_EXPANDED, String(expanded));
    }

    if (expanded) {
        resetScrollHeight(textarea);
        // Do not steal focus on touch devices - the soft keyboard would cover the note.
        if (focus && !getContext().isMobile()) {
            textarea.focus();
        }
    }
}

function applySettings() {
    if (!root) return;
    root.classList.toggle('note-overlay-hidden', !settings().enabled);
    root.classList.toggle('note-overlay-no-preview', !settings().showPreview);
    root.style.setProperty('--note-overlay-max-height', `${settings().maxHeightVh}dvh`);
}

/** Reloads the note for the chat that is currently open. */
function reload() {
    if (!root) return;

    const enabled = hasChat();
    root.classList.toggle('note-overlay-disabled', !enabled);
    textarea.disabled = !enabled;

    textarea.value = enabled ? getNote() : '';
    updatePreview();

    if (!enabled) {
        // Collapse without persisting - "no chat open" is not a user preference.
        setExpanded(false, { persist: false });
        return;
    }

    // Re-apply the user's remembered choice. Never focus here: reload() also runs on
    // CHAT_CHANGED, and grabbing focus on every chat switch would be hostile.
    setExpanded(storedExpanded(), { persist: false, focus: false });
}

function onInput() {
    setNote(textarea.value);
    resetScrollHeight(textarea);
    updatePreviewDebounced();
}

async function onClear() {
    if (!getNote()) {
        return;
    }

    const confirmed = await callGenericPopup(
        t`Clear the note for this chat? This cannot be undone.`,
        POPUP_TYPE.CONFIRM,
    );

    if (!confirmed) return;

    textarea.value = '';
    setNote('');
    updatePreview();
    resetScrollHeight(textarea);
}

function onCopy() {
    const note = getNote();
    if (!note) return;
    navigator.clipboard.writeText(note)
        .then(() => toastr.success(t`Note copied.`, 'Note Overlay'))
        .catch(err => {
            console.error(`[${extensionName}] Copy failed:`, err);
            toastr.error(t`Could not copy the note.`, 'Note Overlay');
        });
}

/** Moves the note text into the chat input so it can be edited into a real message. */
function onPushToInput() {
    const note = getNote();
    if (!note) return;

    const sendTextarea = /** @type {HTMLTextAreaElement} */ (document.getElementById('send_textarea'));
    if (!sendTextarea) return;

    const existing = sendTextarea.value;
    sendTextarea.value = existing ? `${existing}\n${note}` : note;
    // ST syncs the chat input (and auto-resizes it) off the `input` event.
    // @see public/scripts/RossAscends-mods.js autoFitSendTextArea
    sendTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    sendTextarea.focus();
    sendTextarea.selectionStart = sendTextarea.selectionEnd = sendTextarea.value.length;
}

function buildBar() {
    const el = document.createElement('div');
    el.id = 'noteOverlay';
    el.className = 'note-overlay';
    el.innerHTML = `
        <div class="note-overlay-bar interactable" tabindex="0" role="button">
            <div class="note-overlay-icon fa-solid fa-note-sticky"></div>
            <div class="note-overlay-preview"></div>
            <div class="note-overlay-caret fa-solid fa-chevron-up"></div>
        </div>
        <div class="note-overlay-body">
            <textarea class="note-overlay-textarea" rows="3" autocomplete="off"></textarea>
            <div class="note-overlay-actions">
                <div class="note-overlay-btn interactable fa-solid fa-copy" tabindex="0" data-action="copy"></div>
                <div class="note-overlay-btn interactable fa-solid fa-arrow-down" tabindex="0" data-action="push"></div>
                <div class="note-overlay-btn interactable fa-solid fa-trash-can" tabindex="0" data-action="clear"></div>
                <div class="note-overlay-btn interactable fa-solid fa-xmark" tabindex="0" data-action="close"></div>
            </div>
        </div>`;
    return el;
}

function localizeBar() {
    root.querySelector('.note-overlay-textarea')
        .setAttribute('placeholder', t`Outline your reply here. Saved with this chat.`);
    root.querySelector('.note-overlay-bar')
        .setAttribute('title', t`Chat note`);

    const titles = {
        copy: t`Copy note`,
        push: t`Move note to the chat input`,
        clear: t`Clear note`,
        close: t`Collapse`,
    };
    for (const [action, title] of Object.entries(titles)) {
        root.querySelector(`[data-action="${action}"]`)?.setAttribute('title', title);
    }
}

function mountBar() {
    const sendForm = document.getElementById('send_form');
    if (!sendForm) {
        console.error(`[${extensionName}] #send_form not found - the note bar was not mounted.`);
        return false;
    }

    root = buildBar();
    textarea = root.querySelector('.note-overlay-textarea');
    preview = root.querySelector('.note-overlay-preview');
    localizeBar();

    // Same anchoring as the Quick Replies bar; final ordering is done in CSS via `order`.
    // @see public/scripts/extensions/quick-reply/src/ui/ButtonUi.js
    if (sendForm.children.length > 0) {
        sendForm.children[0].insertAdjacentElement('beforebegin', root);
    } else {
        sendForm.append(root);
    }

    root.querySelector('.note-overlay-bar').addEventListener('click', () => {
        if (!hasChat()) {
            toastr.info(t`Open a chat first.`, 'Note Overlay');
            return;
        }
        setExpanded(!isExpanded());
    });

    root.querySelector('.note-overlay-bar').addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') {
            evt.preventDefault();
            evt.currentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
    });

    textarea.addEventListener('input', onInput);

    root.querySelector('.note-overlay-actions').addEventListener('click', (evt) => {
        const action = evt.target instanceof HTMLElement ? evt.target.dataset.action : null;
        switch (action) {
            case 'copy': onCopy(); break;
            case 'push': onPushToInput(); break;
            case 'clear': onClear(); break;
            case 'close': setExpanded(false); break;
        }
    });

    return true;
}

// ---------------------------------------------------------------- Settings

function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const stored = extension_settings[extensionName];

    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!Object.hasOwn(stored, key)) {
            stored[key] = value;
        }
    }

    $('#note_overlay_enabled').prop('checked', stored.enabled);
    $('#note_overlay_preview').prop('checked', stored.showPreview);
    $('#note_overlay_height').val(stored.maxHeightVh);
    $('#note_overlay_height_value').text(`${stored.maxHeightVh}%`);
}

function bindSettings() {
    $('#note_overlay_enabled').on('input', function () {
        settings().enabled = Boolean($(this).prop('checked'));
        saveSettingsDebounced();
        applySettings();
    });

    $('#note_overlay_preview').on('input', function () {
        settings().showPreview = Boolean($(this).prop('checked'));
        saveSettingsDebounced();
        applySettings();
    });

    $('#note_overlay_height').on('input', function () {
        const value = Number($(this).val());
        settings().maxHeightVh = value;
        $('#note_overlay_height_value').text(`${value}%`);
        saveSettingsDebounced();
        applySettings();
    });
}

// ---------------------------------------------------------------- Slash command

function registerSlashCommand() {
    // NOT `/note` - SillyTavern's Author's Note already owns that name
    // (public/scripts/authors-note.js). Duplicate registration only logs a warning and
    // silently overwrites one of the two, so the name has to be distinct.
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'chatnote',
        callback: (_args, value) => {
            if (!hasChat()) {
                return '';
            }
            const text = String(value ?? '');
            if (text.length === 0) {
                return getNote();
            }
            setNote(text);
            if (textarea) {
                textarea.value = text;
                updatePreview();
            }
            return text;
        },
        returns: 'the note of the current chat',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'text to store as the chat note (omit to read the current note)',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: false,
            }),
        ],
        helpString: 'Reads or writes the Note Overlay note of the current chat.',
    }));
}

// ---------------------------------------------------------------- Init

jQuery(async () => {
    console.log(`[${extensionName}] Loading...`);

    try {
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $('#extensions_settings2').append(settingsHtml);

        loadSettings();
        bindSettings();

        if (!mountBar()) {
            return;
        }

        applySettings();

        // reload() applies the remembered expand state, so no separate call is needed here.
        // CHAT_CHANGED fires after chat_metadata has been replaced (public/script.js:7641),
        // but it may already have fired before this extension finished loading - hence the
        // explicit reload() below.
        eventSource.on(event_types.CHAT_CHANGED, reload);
        reload();

        registerSlashCommand();

        console.log(`[${extensionName}] Loaded successfully`);
    } catch (error) {
        console.error(`[${extensionName}] Failed to load:`, error);
    }
});
