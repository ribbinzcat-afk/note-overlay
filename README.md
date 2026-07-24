# Note Overlay

A small scratchpad that sits directly above the SillyTavern chat input, for outlining a
reply before writing it out. Built for narrow screens first.

Tested against SillyTavern **1.18.0**.

## What it does

- A thin bar above the message box showing a note icon and the first line of the note.
- Tap the bar to expand a textarea in place; tap again (or the ✕) to collapse.
- The note is saved automatically as you type.
- Each chat keeps its own note.
- Buttons to copy the note, push it into the chat input, or clear it (with a confirmation).
- `/chatnote` reads the current note, `/chatnote your text` overwrites it.
  (Deliberately not `/note` — SillyTavern's Author's Note already owns that name, and a
  duplicate registration only logs a warning before one silently overwrites the other.)

## Where notes are stored

Notes live in `chat_metadata` under the key `note_overlay_content`, the same mechanism
SillyTavern uses for the Author's Note. That means:

- the note is written into the chat's `.jsonl` header, so it survives a restart;
- exporting or backing up a chat carries the note with it;
- deleting a chat deletes its note — nothing accumulates in `settings.json`.

Saving goes through `saveMetadataDebounced()`, which batches writes (1 s) and refuses to
save if you switched character or group in the meantime.

## Layout notes

The bar is a normal child of `#send_form` and is ordered with CSS (`order: 2`), sitting
between the Quick Replies bar (`order: 1`) and the input row (`order: 25`). Because
`#sheld` is a fixed-height flex column and `#chat` grows to fill it, expanding the note
shrinks the chat log by itself — there is no fixed positioning, no backdrop, and nothing
that a mobile soft keyboard can push out of place.

## Installation

In SillyTavern: **Extensions → Install extension**, then paste:

```
https://github.com/ribbinzcat-afk/note-overlay.git
```

Reload the page afterwards.

Or install manually by copying the whole folder into your user extensions directory:

```
<SillyTavern>/data/<your-user>/extensions/note-overlay/
```

Either way the folder must end up named `note-overlay`, because that has to match
`extensionName` in `index.js`. SillyTavern derives the folder name from the repository
name, so the repo cannot be renamed without also editing `index.js`.

`auto_update` is enabled, so SillyTavern will pull new commits on startup.

## Settings

Extensions → right panel → **Note Overlay**

- Show the note bar
- Show a preview of the first line on the collapsed bar
- Maximum height when expanded (20–60% of the screen)

## Troubleshooting

Open the browser console (F12) and look for lines prefixed with `[note-overlay]`.

| Symptom | Likely cause |
| --- | --- |
| `#send_form not found` in the console | SillyTavern changed its DOM; the bar is not mounted. |
| Bar is greyed out and does not open | No chat is open. Pick a character or group first. |
| Note does not persist | Check the console for metadata save warnings; switching character within 1 s of typing cancels the save by design. |
